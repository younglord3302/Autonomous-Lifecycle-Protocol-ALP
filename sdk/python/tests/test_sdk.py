import os
import sys
import unittest

# Make the sdk package importable when run from this directory.
SDK_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SDK_ROOT not in sys.path:
    sys.path.insert(0, SDK_ROOT)

from alp_sdk import load_workspace, validate_object, compute_analytics, verify_workspace
from alp_sdk.reader import AlpReader

REPO_ROOT = os.path.dirname(os.path.dirname(SDK_ROOT))
EXAMPLE_DIR = os.path.join(REPO_ROOT, 'examples', 'todo-app')


class TestLoadWorkspace(unittest.TestCase):
    def test_loads_nested_objects_recursively(self):
        # Regression: load_workspace must recurse into features/, workflows/,
        # rules/, etc. -- not just top-level .alp files.
        objects = load_workspace(EXAMPLE_DIR)
        self.assertGreater(len(objects), 0)

        ids = {obj.id for obj in objects}
        # Nested feature file must be discovered.
        self.assertIn('feat-user-auth', ids)
        self.assertIn('feat-task-management', ids)
        self.assertIn('todo-app', ids)

    def test_loads_all_expected_object_types(self):
        objects = load_workspace(EXAMPLE_DIR)
        types = {obj._type for obj in objects}
        for expected in ('project', 'feature', 'task', 'agent',
                         'decision', 'rule', 'memory', 'state', 'workflow'):
            self.assertIn(expected, types)


class TestValidation(unittest.TestCase):
    def test_all_example_objects_validate(self):
        objects = load_workspace(EXAMPLE_DIR)
        for obj in objects:
            # Should not raise.
            validate_object(obj._type, obj.properties)

    def test_invalid_object_raises(self):
        reader = AlpReader()
        # A task without an id is invalid.
        with self.assertRaises(Exception):
            objs = reader.parse("""
@task
  description: "Task without an ID"
""")
            for obj in objs:
                validate_object(obj._type, obj.properties)


class TestVerifyWorkspace(unittest.TestCase):
    def test_example_tasks_all_pass(self):
        report = verify_workspace(EXAMPLE_DIR)
        self.assertTrue(report["passed"])
        self.assertGreater(len(report["tasks"]), 0)
        for task in report["tasks"]:
            self.assertTrue(task["verified"], msg=f"task {task['id']} failed")
            self.assertEqual(task["failed_gate"], None)
            self.assertEqual(task["error"], None)

    def test_failing_gate_is_reported(self):
        import tempfile
        import shutil

        tmp = tempfile.mkdtemp()
        try:
            alp_dir = os.path.join(tmp, ".alp")
            os.makedirs(alp_dir)
            with open(os.path.join(alp_dir, "broken.alp"), "w", encoding="utf-8") as f:
                f.write('@task\n  id: task-broken\n  verify:\n    - "exit 3"\n')

            report = verify_workspace(tmp)
            self.assertFalse(report["passed"])
            broken = next(t for t in report["tasks"] if t["id"] == "task-broken")
            self.assertFalse(broken["verified"])
            self.assertEqual(broken["failed_gate"], 1)
            self.assertIsNotNone(broken["error"])
        finally:
            shutil.rmtree(tmp)


class TestAnalytics(unittest.TestCase):
    def test_cycle_time_and_hotspots(self):
        events = [
            {"timestamp": "2026-01-01T00:00:00Z", "type": "run_start"},
            {"timestamp": "2026-01-01T00:00:00Z", "type": "task_claim", "task_id": "T1", "agent": "a1"},
            {"timestamp": "2026-01-01T00:00:10Z", "type": "task_status", "task_id": "T1", "status": "[x]", "agent": "a1"},
            {"timestamp": "2026-01-01T00:00:01Z", "type": "task_claim", "task_id": "T2"},
            {"timestamp": "2026-01-01T00:00:02Z", "type": "task_status", "task_id": "T2", "status": "[!]"},
            {"timestamp": "2026-01-01T00:00:03Z", "type": "task_status", "task_id": "T2", "status": "[!]"},
            {"timestamp": "2026-01-01T00:00:04Z", "type": "human_handoff", "task_id": "T3"},
        ]
        a = compute_analytics(events)
        self.assertEqual(a["total_events"], 7)
        self.assertEqual(a["runs"], 1)
        self.assertEqual(a["avg_cycle_time_ms"], 10000)
        self.assertEqual(a["failure_hotspots"][0]["task_id"], "T2")
        self.assertEqual(a["failure_hotspots"][0]["failures"], 2)
        self.assertIn("T3", [h["task_id"] for h in a["failure_hotspots"]])


if __name__ == '__main__':
    unittest.main()
