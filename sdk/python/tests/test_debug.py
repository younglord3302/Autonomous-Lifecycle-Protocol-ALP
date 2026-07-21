import os
import sys
import shutil
import tempfile
import unittest

SDK_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SDK_ROOT not in sys.path:
    sys.path.insert(0, SDK_ROOT)

from alp_sdk.debug import EngineSnapshot, SnapshotStore, DebugSession


def _snap(sid, run_id, stage, state):
    return EngineSnapshot(
        id=sid,
        run_id=run_id,
        stage=stage,
        timestamp="2026-01-01T00:00:00Z",
        state=state,
        event_ids=[sid],
    )


class TestSnapshotStore(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.alp_dir = os.path.join(self.root, ".alp")
        os.makedirs(self.alp_dir, exist_ok=True)
        self.store = SnapshotStore(self.alp_dir)

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_save_and_load(self):
        self.store.save(_snap("s1", "run-1", "init", {"x": 1}))
        self.store.save(_snap("s2", "run-1", "parse", {"x": 2}))
        self.store.save(_snap("s3", "run-2", "init", {"x": 3}))
        loaded = self.store.load_for_run("run-1")
        self.assertEqual(len(loaded), 2)
        self.assertEqual(loaded[0].id, "s1")
        self.assertEqual(loaded[1].stage, "parse")

    def test_load_empty(self):
        loaded = self.store.load_for_run("run-1")
        self.assertEqual(loaded, [])

    def test_skips_malformed(self):
        p = os.path.join(self.alp_dir, ".runtime", "snapshots.jsonl")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8") as f:
            f.write('{"run_id":"run-1"}\n')
            f.write("not json\n")
            f.write('{"run_id":"run-1"}\n')
        loaded = self.store.load_for_run("run-1")
        self.assertEqual(len(loaded), 2)

    def test_creates_directory(self):
        self.store.save(_snap("s1", "run-1", "init", {"a": 1}))
        self.assertTrue(os.path.isdir(os.path.join(self.alp_dir, ".runtime")))


class TestDebugSession(unittest.TestCase):
    def test_step_forward(self):
        session = DebugSession([_snap("s1", "r1", "init", {"x": 1}), _snap("s2", "r1", "parse", {"x": 2})])
        first = session.step_forward()
        self.assertIsNotNone(first)
        self.assertEqual(first.id, "s1")

    def test_step_forward_empty(self):
        session = DebugSession([])
        self.assertIsNone(session.step_forward())

    def test_step_backward(self):
        session = DebugSession([_snap("s1", "r1", "init", {"x": 1}), _snap("s2", "r1", "parse", {"x": 2})])
        last = session.step_backward()
        self.assertIsNotNone(last)
        self.assertEqual(last.id, "s2")

    def test_step_backward_empty(self):
        session = DebugSession([])
        self.assertIsNone(session.step_backward())

    def test_to_stage(self):
        session = DebugSession([_snap("s1", "r1", "init", {"x": 1}), _snap("s2", "r1", "parse", {"x": 2})])
        found = session.to_stage("parse")
        self.assertIsNotNone(found)
        self.assertEqual(found.id, "s2")

    def test_to_stage_missing(self):
        session = DebugSession([_snap("s1", "r1", "init", {"x": 1})])
        self.assertIsNone(session.to_stage("missing"))

    def test_diff_added(self):
        session = DebugSession([])
        a = _snap("s1", "r1", "init", {"x": 1})
        b = _snap("s2", "r1", "parse", {"x": 1, "y": 2})
        diff = session.diff_snapshots(a, b)
        self.assertEqual(diff.added, {"y": 2})
        self.assertEqual(diff.removed, {})
        self.assertEqual(diff.changed, [])

    def test_diff_removed(self):
        session = DebugSession([])
        a = _snap("s1", "r1", "init", {"x": 1, "y": 2})
        b = _snap("s2", "r1", "parse", {"x": 1})
        diff = session.diff_snapshots(a, b)
        self.assertEqual(diff.removed, {"y": 2})
        self.assertEqual(diff.added, {})
        self.assertEqual(diff.changed, [])

    def test_diff_changed(self):
        session = DebugSession([])
        a = _snap("s1", "r1", "init", {"x": 1})
        b = _snap("s2", "r1", "parse", {"x": 2})
        diff = session.diff_snapshots(a, b)
        self.assertEqual(len(diff.changed), 1)
        self.assertEqual(diff.changed[0]["key"], "x")
        self.assertEqual(diff.changed[0]["from"], 1)
        self.assertEqual(diff.changed[0]["to"], 2)

    def test_diff_identical(self):
        session = DebugSession([])
        a = _snap("s1", "r1", "init", {"x": 1})
        diff = session.diff_snapshots(a, a)
        self.assertEqual(diff.added, {})
        self.assertEqual(diff.removed, {})
        self.assertEqual(diff.changed, [])


if __name__ == "__main__":
    unittest.main()
