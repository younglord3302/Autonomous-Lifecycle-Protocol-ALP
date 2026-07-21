import os
import sys
import unittest

SDK_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SDK_ROOT not in sys.path:
    sys.path.insert(0, SDK_ROOT)

from alp_sdk import WorkflowMutator, AdaptiveEngine, AutonomyController, EditProposal


class FakePolicyEngine:
    def evaluate_proposal(self, proposal_id, context):
        pass


class TestWorkflowMutator(unittest.TestCase):
    def test_propose_edit_creates_proposal(self):
        mutator = WorkflowMutator()
        proposal = mutator.propose_edit("wf-1", [{"op": "add_step", "value": {"id": "s1"}}], "add step")
        self.assertEqual(proposal.workflow_id, "wf-1")
        self.assertEqual(proposal.status, "pending")
        self.assertEqual(len(proposal.edits), 1)

    def test_approve_applies_edits(self):
        mutator = WorkflowMutator()
        proposal = mutator.propose_edit("wf-1", [{"op": "add_step", "value": {"id": "s1"}}], "add step")
        wf = {"steps": []}
        updated = mutator.approve(proposal.proposal_id, wf)
        self.assertEqual(len(updated["steps"]), 1)
        self.assertEqual(proposal.status, "approved")

    def test_approve_denies_on_policy_failure(self):
        class BadPolicy:
            def evaluate_proposal(self, pid, ctx):
                raise PermissionError("denied")
        mutator = WorkflowMutator(BadPolicy())
        proposal = mutator.propose_edit("wf-1", [{"op": "add_step"}], "bad")
        with self.assertRaises(PermissionError):
            mutator.approve(proposal.proposal_id, {})
        self.assertEqual(proposal.status, "denied")

    def test_rollback_restores_snapshot(self):
        mutator = WorkflowMutator()
        proposal = mutator.propose_edit("wf-1", [{"op": "add_step", "value": {"id": "s1"}}], "add")
        original = {"steps": [{"id": "s0"}]}
        mutator.approve(proposal.proposal_id, original)
        restored = mutator.rollback(proposal.proposal_id)
        self.assertEqual(restored["steps"], [{"id": "s0"}])


class TestAdaptiveEngine(unittest.TestCase):
    def test_observe_latency_signal(self):
        engine = AdaptiveEngine()
        engine.observe({"kind": "latency", "p99": 1500})
        self.assertEqual(engine.get_tuning("retry.max_attempts"), 4)

    def test_observe_error_rate_signal(self):
        engine = AdaptiveEngine()
        engine.observe({"kind": "error_rate", "rate": 0.3})
        threshold = engine.get_tuning("circuit_breaker.threshold")
        self.assertIsNotNone(threshold)
        self.assertGreater(threshold, 0)

    def test_observe_throughput_signal(self):
        engine = AdaptiveEngine()
        engine.observe({"kind": "throughput", "rps": 150})
        self.assertEqual(engine.get_tuning("pool.size"), 15)


class TestAutonomyController(unittest.TestCase):
    def test_start_swarm_creates_run(self):
        controller = AutonomyController()
        run = controller.start_swarm("swarm-1", {"steps": []})
        self.assertEqual(run["swarm_id"], "swarm-1")
        self.assertEqual(run["status"], "running")

    def test_propose_and_apply_mutation(self):
        controller = AutonomyController()
        controller.start_swarm("swarm-1", {"steps": []})
        proposal = controller.propose_mutation("swarm-1", [{"op": "add_step", "value": {"id": "s1"}}], "add")
        self.assertIsNotNone(proposal)
        updated = controller.apply_mutation("swarm-1", proposal.proposal_id)
        self.assertEqual(len(updated["steps"]), 1)

    def test_rollback_mutation(self):
        controller = AutonomyController()
        controller.start_swarm("swarm-1", {"steps": [{"id": "s0"}]})
        proposal = controller.propose_mutation("swarm-1", [{"op": "add_step", "value": {"id": "s1"}}], "add")
        controller.apply_mutation("swarm-1", proposal.proposal_id)
        restored = controller.rollback_mutation("swarm-1", proposal.proposal_id)
        self.assertEqual(restored["steps"], [{"id": "s0"}])

    def test_observe_signal_updates_adaptive(self):
        controller = AutonomyController()
        controller.start_swarm("swarm-1", {"steps": []})
        controller.observe_signal("swarm-1", {"kind": "latency", "p99": 2000})
        self.assertEqual(controller.adaptive.get_tuning("retry.max_attempts"), 5)

    def test_get_decisions_filters_by_swarm(self):
        controller = AutonomyController()
        controller.start_swarm("swarm-1", {"steps": []})
        controller.start_swarm("swarm-2", {"steps": []})
        controller.propose_mutation("swarm-1", [], "a")
        controller.propose_mutation("swarm-2", [], "b")
        self.assertEqual(len(controller.get_decisions("swarm-1")), 1)
        self.assertEqual(len(controller.get_decisions("swarm-2")), 1)
        self.assertEqual(len(controller.get_decisions()), 2)
