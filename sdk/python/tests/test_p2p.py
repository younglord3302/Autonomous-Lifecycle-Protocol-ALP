import json
import os
import sys
import unittest

SDK_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SDK_ROOT not in sys.path:
    sys.path.insert(0, SDK_ROOT)

from alp_sdk.p2p import (
    DHT,
    GossipMessage,
    GossipProtocol,
    P2PNode,
    P2PReport,
    P2PSwarm,
    p2p_dir,
    peers_path,
    swarm_state_path,
)


class TestP2PNode(unittest.TestCase):
    def test_defaults(self):
        node = P2PNode("n1", "agent-1", capabilities=["build"])
        self.assertEqual(node.node_id, "n1")
        self.assertEqual(node.agent_id, "agent-1")
        self.assertIsNotNone(node.last_seen)

    def test_to_dict_round_trip(self):
        node = P2PNode("n1", "agent-1", capabilities=["build"], address="addr", metadata={"region": "us"})
        d = node.to_dict()
        restored = P2PNode.from_dict(d)
        self.assertEqual(restored.node_id, "n1")
        self.assertEqual(restored.metadata["region"], "us")


class TestDHT(unittest.TestCase):
    def test_register_and_resolve(self):
        dht = DHT()
        node = P2PNode("n1", "agent-1", capabilities=["build"])
        dht.register(node)
        resolved = dht.resolve("agent-1")
        self.assertIsNotNone(resolved)
        self.assertEqual(resolved.agent_id, "agent-1")

    def test_remove(self):
        dht = DHT()
        dht.register(P2PNode("n1", "agent-1"))
        dht.remove("agent-1")
        self.assertIsNone(dht.resolve("agent-1"))

    def test_find_by_capability(self):
        dht = DHT()
        dht.register(P2PNode("n1", "agent-1", capabilities=["build"]))
        dht.register(P2PNode("n2", "agent-2", capabilities=["test"]))
        results = dht.find_by_capability("build")
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].agent_id, "agent-1")

    def test_all_nodes(self):
        dht = DHT()
        dht.register(P2PNode("n1", "agent-1"))
        dht.register(P2PNode("n2", "agent-2"))
        self.assertEqual(len(dht.all_nodes()), 2)


class TestGossipProtocol(unittest.TestCase):
    def test_spread_forwards_to_fanout(self):
        gossip = GossipProtocol(fanout=2)
        peers = [P2PNode(f"n{i}", f"agent-{i}") for i in range(5)]
        msg = GossipMessage("task.assign", {"task_id": "t1"}, "n0", ttl=3)
        forwarded = gossip.spread(msg, peers)
        self.assertEqual(len(forwarded), 2)
        self.assertEqual(forwarded[0].topic, "task.assign")
        self.assertEqual(forwarded[0].ttl, 2)

    def test_spread_deduplicates(self):
        gossip = GossipProtocol(fanout=2)
        peers = [P2PNode("n1", "agent-1")]
        msg = GossipMessage("task.assign", {"task_id": "t1"}, "n0", ttl=3)
        gossip.spread(msg, peers)
        again = gossip.spread(msg, peers)
        self.assertEqual(len(again), 0)

    def test_spread_stops_at_ttl_zero(self):
        gossip = GossipProtocol(fanout=2)
        peers = [P2PNode("n1", "agent-1")]
        msg = GossipMessage("task.assign", {"task_id": "t1"}, "n0", ttl=0)
        forwarded = gossip.spread(msg, peers)
        self.assertEqual(len(forwarded), 0)


class TestP2PSwarm(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.tmpdir = tempfile.mkdtemp()
        self.swarm = P2PSwarm(self.tmpdir, fanout=2, heartbeat_timeout=60.0)

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_join_and_discover(self):
        self.swarm.join(P2PNode("n1", "agent-1", capabilities=["build"]))
        self.swarm.join(P2PNode("n2", "agent-2", capabilities=["test"]))
        self.assertEqual(len(self.swarm.dht.all_nodes()), 2)
        builders = self.swarm.discover("build")
        self.assertEqual(len(builders), 1)

    def test_leave_removes_node(self):
        self.swarm.join(P2PNode("n1", "agent-1"))
        self.swarm.leave("agent-1")
        self.assertEqual(len(self.swarm.dht.all_nodes()), 0)

    def test_gossip_spreads(self):
        self.swarm.join(P2PNode("n1", "agent-1"))
        self.swarm.join(P2PNode("n2", "agent-2"))
        msg = GossipMessage("task.assign", {"task_id": "t1"}, "n1", ttl=2)
        forwarded = self.swarm.gossip(msg)
        self.assertGreater(len(forwarded), 0)
        self.assertEqual(len(self.swarm._messages), 1 + len(forwarded))

    def test_assign_task(self):
        self.swarm.join(P2PNode("n1", "agent-1"))
        assignment = self.swarm.assign_task("t1", "agent-1", "wf1")
        self.assertIsNotNone(assignment)
        self.assertEqual(assignment.agent_id, "agent-1")
        self.assertEqual(len(self.swarm._assignments), 1)

    def test_run_executes_tasks(self):
        self.swarm.join(P2PNode("n1", "agent-1"))
        self.swarm.assign_task("t1", "agent-1", "wf1")
        executed = []

        def executor(task_id, agent_id):
            executed.append((task_id, agent_id))
            return "ok"

        report = self.swarm.run(executor, [{"task_id": "t1"}], workflow_id="wf1")
        self.assertEqual(executed, [("t1", "agent-1")])
        self.assertEqual(report.to_dict()["completed"], 1)
        self.assertEqual(report.to_dict()["failed"], 0)

    def test_run_retries_on_failure(self):
        self.swarm = P2PSwarm(self.tmpdir, fanout=2, max_retries=1)
        self.swarm.join(P2PNode("n1", "agent-1"))
        self.swarm.assign_task("t1", "agent-1", "wf1")
        calls = []

        def executor(task_id, agent_id):
            calls.append(1)
            raise RuntimeError("fail")

        report = self.swarm.run(executor, [{"task_id": "t1"}], workflow_id="wf1")
        self.assertEqual(report.to_dict()["failed"], 1)

    def test_persists_peers(self):
        self.swarm.join(P2PNode("n1", "agent-1"))
        p = peers_path(self.tmpdir)
        self.assertTrue(os.path.exists(p))
        with open(p, "r", encoding="utf-8") as f:
            lines = [l.strip() for l in f if l.strip()]
        self.assertEqual(len(lines), 1)
        entry = json.loads(lines[0])
        self.assertEqual(entry["node_id"], "n1")

    def test_get_report(self):
        report = self.swarm.get_report("missing")
        self.assertIsNone(report)
        self.swarm.run(lambda t, a: None, [], workflow_id="wf1")
        fetched = self.swarm.get_report("wf1")
        self.assertIsNotNone(fetched)
        self.assertIsNotNone(fetched.to_dict())


if __name__ == "__main__":
    unittest.main()
