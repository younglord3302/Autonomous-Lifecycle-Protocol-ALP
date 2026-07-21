import os
import sys
import unittest

SDK_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SDK_ROOT not in sys.path:
    sys.path.insert(0, SDK_ROOT)

from alp_sdk import LWWRegister, ORSet, EdgeRuntime


class TestLWWRegister(unittest.TestCase):
    def test_set_updates_value(self):
        reg = LWWRegister("node-1")
        entry = reg.set("hello")
        self.assertEqual(reg.get(), "hello")
        self.assertEqual(entry["value"], "hello")

    def test_merge_newer_wins(self):
        reg = LWWRegister("node-1")
        reg.value = "old"
        reg.timestamp = 1000
        reg.merge({"value": "new", "timestamp": 2000})
        self.assertEqual(reg.get(), "new")

    def test_merge_older_loses(self):
        reg = LWWRegister("node-1")
        reg.value = "current"
        reg.timestamp = 2000
        reg.merge({"value": "old", "timestamp": 1000})
        self.assertEqual(reg.get(), "current")

    def test_to_dict_round_trip(self):
        reg = LWWRegister("node-1")
        reg.value = "v"
        reg.timestamp = 1234
        d = reg.to_dict()
        self.assertEqual(d["value"], "v")
        self.assertEqual(d["node_id"], "node-1")


class TestORSet(unittest.TestCase):
    def test_add_and_has(self):
        s = ORSet("node-1")
        s.add("a")
        self.assertTrue(s.has("a"))

    def test_remove(self):
        s = ORSet("node-1")
        s.add("a")
        s.remove("a")
        self.assertFalse(s.has("a"))

    def test_values(self):
        s = ORSet("node-1")
        s.add("a")
        s.add("b")
        self.assertEqual(set(s.values()), {"a", "b"})

    def test_merge_adds_missing(self):
        s1 = ORSet("node-1")
        s2 = ORSet("node-2")
        s1.add("a")
        s2.add("b")
        s1.merge(s2.to_dict())
        self.assertTrue(s1.has("b"))


class TestEdgeRuntime(unittest.TestCase):
    def test_set_and_get_state(self):
        runtime = EdgeRuntime("edge-1", "us-east")
        runtime.set_state("key", "value")
        self.assertEqual(runtime.get_state("key"), "value")

    def test_queue_task_offline(self):
        runtime = EdgeRuntime("edge-1")
        runtime.go_offline()
        runtime.queue_task({"id": "t1"})
        self.assertEqual(len(runtime.pending), 1)

    def test_resync_applies_pending(self):
        runtime = EdgeRuntime("edge-1")
        runtime.go_offline()
        runtime.queue_task({"id": "t1"})
        result = runtime.resync()
        self.assertEqual(result["applied"], 1)
        self.assertEqual(result["remaining"], 0)

    def test_nearest_peer(self):
        runtime = EdgeRuntime("edge-1")
        runtime.register_peer({"node_id": "p1", "region": "us-east", "online": True, "latency_ms": 50})
        runtime.register_peer({"node_id": "p2", "region": "us-west", "online": True, "latency_ms": 150})
        peer = runtime.nearest_peer({})
        self.assertEqual(peer["node_id"], "p1")
