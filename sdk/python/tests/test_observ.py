import json
import os
import shutil
import sys
import tempfile
import unittest

SDK_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SDK_ROOT not in sys.path:
    sys.path.insert(0, SDK_ROOT)

from alp_sdk import RuntimeLog, StateStore, RUNTIME_EVENT_TYPES


class TestRuntimeLog(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def test_event_types_constant(self):
        self.assertIn("task_claim", RUNTIME_EVENT_TYPES)
        self.assertIn("run_start", RUNTIME_EVENT_TYPES)
        self.assertIn("checkpoint", RUNTIME_EVENT_TYPES)

    def test_log_and_read_event(self):
        rl = RuntimeLog(self.tmp)
        rl.log_event("task_claim", {"task_id": "t1", "agent": "a1"})
        events = rl.read_events()
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["type"], "task_claim")
        self.assertEqual(events[0]["task_id"], "t1")
        self.assertIn("timestamp", events[0])
        self.assertIn("pid", events[0])

    def test_multiple_events_in_order(self):
        rl = RuntimeLog(self.tmp)
        rl.log_event("run_start")
        rl.log_event("task_status", {"task_id": "t1", "status": "[x]"})
        rl.log_event("run_end")
        events = rl.read_events()
        self.assertEqual([e["type"] for e in events], ["run_start", "task_status", "run_end"])

    def test_creates_runtime_dir(self):
        rl = RuntimeLog(self.tmp)
        rl.log_event("checkpoint", {"iteration": 1})
        self.assertTrue(os.path.isdir(os.path.join(self.tmp, ".runtime")))
        self.assertTrue(os.path.exists(os.path.join(self.tmp, ".runtime", "log.jsonl")))

    def test_read_events_empty(self):
        rl = RuntimeLog(self.tmp)
        self.assertEqual(rl.read_events(), [])

    def test_skips_malformed_lines(self):
        os.makedirs(os.path.join(self.tmp, ".runtime"), exist_ok=True)
        with open(os.path.join(self.tmp, ".runtime", "log.jsonl"), "w", encoding="utf-8") as f:
            f.write('{"type":"ok"}\n')
            f.write("not json\n")
            f.write('{"type":"ok2"}\n')
        rl = RuntimeLog(self.tmp)
        events = rl.read_events()
        self.assertEqual([e["type"] for e in events], ["ok", "ok2"])


class TestStateStore(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def _sample_events(self):
        return [
            {"timestamp": "2026-01-01T00:00:00Z", "type": "run_start"},
            {"timestamp": "2026-01-01T00:00:01Z", "type": "task_claim", "task_id": "t1", "agent": "a1"},
            {"timestamp": "2026-01-01T00:05:00Z", "type": "task_status", "task_id": "t1", "status": "[x]", "agent": "a1"},
            {"timestamp": "2026-01-01T00:10:00Z", "type": "task_claim", "task_id": "t2", "agent": "a2"},
            {"timestamp": "2026-01-01T00:11:00Z", "type": "task_status", "task_id": "t2", "status": "[!]", "agent": "a2"},
        ]

    def test_ingest_and_analytics(self):
        store = StateStore(self.tmp)
        added = store.ingest(self._sample_events())
        self.assertEqual(added, 5)
        store.save()
        a = store.analytics()
        self.assertEqual(a["total_events"], 5)
        self.assertEqual(a["runs"], 1)
        # t1 completed ~5 minutes later (claim ts vs done ts, in ms).
        t1 = next(t for t in a["tasks"] if t["task_id"] == "t1")
        self.assertTrue(t1["completed"])
        self.assertEqual(t1["cycle_time_ms"], 299000)
        # t2 failed.
        t2 = next(t for t in a["tasks"] if t["task_id"] == "t2")
        self.assertEqual(t2["failures"], 1)
        # avg cycle over the one completed task.
        self.assertEqual(a["avg_cycle_time_ms"], 299000)
        # failure hotspot = t2.
        self.assertEqual(a["failure_hotspots"][0]["task_id"], "t2")

    def test_ingest_dedup(self):
        store = StateStore(self.tmp)
        store.ingest(self._sample_events())
        # Re-ingest identical events -> none new.
        added = store.ingest(self._sample_events())
        self.assertEqual(added, 0)
        self.assertEqual(store.size, 5)

    def test_persistence_across_restart(self):
        store = StateStore(self.tmp)
        store.ingest(self._sample_events())
        store.save()
        # New instance reads the snapshot back.
        store2 = StateStore(self.tmp)
        self.assertEqual(store2.size, 5)
        self.assertEqual(store2.analytics()["total_events"], 5)

    def test_size_property(self):
        store = StateStore(self.tmp)
        self.assertEqual(store.size, 0)
        store.ingest(self._sample_events()[:2])
        self.assertEqual(store.size, 2)


class TestObservabilityIntegration(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def test_runtime_log_feeds_state_store(self):
        rl = RuntimeLog(self.tmp)
        rl.log_event("run_start")
        rl.log_event("task_claim", {"task_id": "t1", "agent": "a1"})
        rl.log_event("task_status", {"task_id": "t1", "status": "[x]", "agent": "a1"})
        store = StateStore(self.tmp)
        added = store.ingest(rl.read_events())
        self.assertEqual(added, 3)
        a = store.analytics()
        self.assertEqual(a["total_events"], 3)
        self.assertEqual(a["tasks"][0]["completed"], True)


if __name__ == "__main__":
    unittest.main()
