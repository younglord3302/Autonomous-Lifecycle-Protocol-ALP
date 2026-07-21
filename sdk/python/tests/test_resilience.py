import os
import sys
import unittest

SDK_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SDK_ROOT not in sys.path:
    sys.path.insert(0, SDK_ROOT)

from alp_sdk.resilience import (
    AgentNode,
    AgentStatus,
    QuorumConsensus,
    ResilientSwarm,
    ResilienceReport,
    TaskAssignment,
)


class TestAgentNode(unittest.TestCase):
    def test_defaults(self):
        node = AgentNode("a1", capabilities=["build"])
        self.assertEqual(node.status, AgentStatus.ACTIVE)
        self.assertEqual(node.capabilities, ["build"])
        self.assertIsNotNone(node.last_heartbeat)

    def test_to_dict(self):
        node = AgentNode("a1", capabilities=["build"], status=AgentStatus.STANDBY)
        d = node.to_dict()
        self.assertEqual(d["agent_id"], "a1")
        self.assertEqual(d["status"], "standby")
        self.assertIn("build", d["capabilities"])


class TestTaskAssignment(unittest.TestCase):
    def test_defaults(self):
        ta = TaskAssignment("t1", "a1", "wf1")
        self.assertEqual(ta.task_id, "t1")
        self.assertEqual(ta.status, "assigned")
        self.assertEqual(ta.retries, 0)
        self.assertIsNotNone(ta.assigned_at)

    def test_to_dict(self):
        ta = TaskAssignment("t1", "a1", "wf1", status="completed", retries=1)
        d = ta.to_dict()
        self.assertEqual(d["status"], "completed")
        self.assertEqual(d["retries"], 1)


class TestQuorumConsensus(unittest.TestCase):
    def test_propose_creates_decision(self):
        q = QuorumConsensus(quorum_size=2)
        decision = q.propose("d1", "a1", {"action": "migrate"})
        self.assertFalse(decision["accepted"])
        self.assertFalse(decision["rejected"])

    def test_vote_reaches_quorum_and_accepts(self):
        q = QuorumConsensus(quorum_size=2)
        decision = q.propose("d1", "a1", {})
        q.vote(decision, "a1", True)
        q.vote(decision, "a2", True)
        self.assertTrue(decision["accepted"])
        self.assertFalse(decision["rejected"])

    def test_vote_rejects_when_majority_no(self):
        q = QuorumConsensus(quorum_size=3)
        decision = q.propose("d1", "a1", {})
        q.vote(decision, "a1", False)
        q.vote(decision, "a2", False)
        q.vote(decision, "a3", True)
        self.assertTrue(decision["rejected"])
        self.assertFalse(decision["accepted"])

    def test_insufficient_quorum_undecided(self):
        q = QuorumConsensus(quorum_size=3)
        decision = q.propose("d1", "a1", {})
        q.vote(decision, "a1", True)
        self.assertFalse(q.is_decided(decision))


class TestResilientSwarm(unittest.TestCase):
    def setUp(self):
        self.swarm = ResilientSwarm(swarm_id="swarm-1", quorum_size=2, heartbeat_timeout=60.0)

    def test_register_and_list_agents(self):
        self.swarm.register_agent(AgentNode("a1", capabilities=["build"]))
        self.swarm.register_agent(AgentNode("a2", capabilities=["test"]), standby=True)
        self.assertEqual(len(self.swarm.agents), 2)
        self.assertEqual(len(self.swarm.active_agents()), 1)
        self.assertEqual(len(self.swarm._standby), 1)

    def test_assign_task(self):
        self.swarm.register_agent(AgentNode("a1"))
        assignment = self.swarm.assign_task("task-1", "a1", "wf-1")
        self.assertIsNotNone(assignment)
        self.assertEqual(assignment.agent_id, "a1")
        self.assertEqual(len(self.swarm.assignments), 1)

    def test_record_heartbeat(self):
        self.swarm.register_agent(AgentNode("a1"))
        self.assertTrue(self.swarm.record_heartbeat("a1"))

    def test_detect_failures_by_timeout(self):
        node = AgentNode("a1")
        node.last_heartbeat = "2000-01-01T00:00:00Z"
        self.swarm.register_agent(node)
        failed = self.swarm.detect_failures()
        self.assertIn("a1", failed)
        self.assertEqual(node.status, AgentStatus.FAILED)

    def test_detect_no_failures_when_recent(self):
        self.swarm.register_agent(AgentNode("a1"))
        self.swarm.record_heartbeat("a1")
        failed = self.swarm.detect_failures()
        self.assertEqual(failed, [])

    def test_promote_standby_replaces_failed(self):
        active = AgentNode("a1", capabilities=["build"])
        standby = AgentNode("a2", capabilities=["test"])
        self.swarm.register_agent(active)
        self.swarm.register_agent(standby, standby=True)
        active.status = AgentStatus.FAILED
        replacement = self.swarm._promote_standby("a1")
        self.assertIsNotNone(replacement)
        self.assertEqual(replacement.agent_id, "a2")
        self.assertEqual(replacement.status, AgentStatus.ACTIVE)
        self.assertEqual(len(self.swarm._standby), 0)

    def test_redistribute_tasks_to_replacement(self):
        self.swarm.register_agent(AgentNode("a1"))
        standby = AgentNode("a2")
        self.swarm.register_agent(standby, standby=True)
        self.swarm.assign_task("t1", "a1", "wf1")
        redistributed = self.swarm._redistribute_tasks("a1", "a2")
        self.assertEqual(len(redistributed), 1)
        self.assertEqual(redistributed[0].agent_id, "a2")

    def test_run_executes_tasks(self):
        self.swarm.register_agent(AgentNode("a1"))
        self.swarm.assign_task("t1", "a1", "wf1")
        executed = []

        def executor(task_id, agent_id):
            executed.append((task_id, agent_id))
            return "ok"

        report = self.swarm.run(executor, [{"task_id": "t1"}], workflow_id="wf1")
        self.assertEqual(executed, [("t1", "a1")])
        self.assertEqual(report.swarm_id, "swarm-1")
        self.assertTrue(any(a["type"] == "consensus" for a in report.actions))

    def test_run_retries_on_failure(self):
        self.swarm.register_agent(AgentNode("a1"))
        self.swarm.assign_task("t1", "a1", "wf1")
        calls = []

        def executor(task_id, agent_id):
            calls.append(1)
            if len(calls) < 2:
                raise RuntimeError("transient")
            return "ok"

        report = self.swarm.run(executor, [{"task_id": "t1"}], workflow_id="wf1")
        self.assertEqual(len(calls), 2)
        self.assertTrue(any(a["type"] == "task_retry" for a in report.actions))

    def test_run_marks_failed_after_max_retries(self):
        self.swarm.register_agent(AgentNode("a1"))
        self.swarm.assign_task("t1", "a1", "wf1")

        def executor(task_id, agent_id):
            raise RuntimeError("always fails")

        report = self.swarm.run(executor, [{"task_id": "t1"}], workflow_id="wf1")
        self.assertTrue(any(a["type"] == "task_failed" for a in report.actions))
        self.assertEqual(self.swarm.agents["a1"].status, AgentStatus.FAILED)

    def test_get_report(self):
        report = self.swarm.get_report("missing")
        self.assertIsNone(report)
        self.swarm.run(lambda t, a: None, [], workflow_id="wf1")
        fetched = self.swarm.get_report("swarm-1")
        self.assertIsNotNone(fetched)
        self.assertIsNotNone(fetched.to_dict())

    def test_consensus_in_run(self):
        self.swarm.register_agent(AgentNode("a1"))
        self.swarm.register_agent(AgentNode("a2"))
        self.swarm.assign_task("t1", "a1", "wf1")
        report = self.swarm.run(lambda t, a: None, [{"task_id": "t1"}], workflow_id="wf1")
        consensus_actions = [a for a in report.actions if a["type"] == "consensus"]
        self.assertEqual(len(consensus_actions), 1)
        self.assertTrue(consensus_actions[0]["accepted"])

    def test_active_agents_after_failure(self):
        a1 = AgentNode("a1")
        a2 = AgentNode("a2")
        self.swarm.register_agent(a1)
        self.swarm.register_agent(a2)
        a1.status = AgentStatus.FAILED
        active = self.swarm.active_agents()
        self.assertEqual(len(active), 1)
        self.assertEqual(active[0].agent_id, "a2")


if __name__ == "__main__":
    unittest.main()
