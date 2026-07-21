import os
import sys
import shutil
import tempfile
import unittest

SDK_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SDK_ROOT not in sys.path:
    sys.path.insert(0, SDK_ROOT)

from alp_sdk import EventStore, WorkflowVisualizer, AlpObject


class TestEventStore(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.alp_dir = os.path.join(self.root, ".alp")
        os.makedirs(self.alp_dir, exist_ok=True)
        self.store = EventStore(self.alp_dir)

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def test_append_and_read(self):
        self.store.append("object_created", {"object_id": "task-1", "type": "task"})
        self.store.append("status_changed", {"object_id": "task-1", "status": "[x]"})
        events = self.store.read_all()
        self.assertEqual(len(events), 2)
        self.assertEqual(events[0].type, "object_created")
        self.assertEqual(events[0].schema_version, 1)

    def test_replay_filter_by_type(self):
        self.store.append("object_created", {"object_id": "task-1"})
        self.store.append("status_changed", {"object_id": "task-1"})
        self.store.append("file_mutated", {"object_id": "task-2"})
        r = self.store.replay(types=["status_changed", "object_created"])
        self.assertEqual(r["applied"], 2)
        self.assertEqual(r["skipped"], 1)

    def test_replay_filter_by_object_id(self):
        self.store.append("object_created", {"object_id": "task-1"})
        self.store.append("status_changed", {"object_id": "task-2"})
        r = self.store.replay(object_id="task-1")
        self.assertEqual(r["applied"], 1)
        self.assertEqual(r["events"][0]["payload"]["object_id"], "task-1")


class TestWorkflowVisualizer(unittest.TestCase):
    def _obj(self, wid):
        return AlpObject.from_dict({
            "_type": "workflow",
            "id": wid,
            "name": f"Workflow {wid}",
            "steps": [
                {"name": "Step A", "task": "-> task-a", "agent": "-> agent-x"},
                {"name": "Step B", "task": "-> task-b", "parallel_group": "impl"},
                {"name": "Step C", "task": "-> task-c", "parallel_group": "impl"},
                {"name": "Step D", "wait_for": "impl"},
            ],
        })

    def test_parses_workflows(self):
        v = WorkflowVisualizer()
        wfs = v.parse_workflows([self._obj("wf-1"), AlpObject.from_dict({"_type": "task", "id": "t1"})])
        self.assertEqual(len(wfs), 1)
        self.assertEqual(len(wfs[0].steps), 4)

    def test_mermaid(self):
        v = WorkflowVisualizer()
        out = v.to_mermaid(v.parse_workflows([self._obj("wf-1")]))
        self.assertIn("flowchart TD", out)
        self.assertIn("subgraph", out)
        self.assertIn("grp_impl", out)

    def test_dot(self):
        v = WorkflowVisualizer()
        out = v.to_dot(v.parse_workflows([self._obj("wf-1")]))
        self.assertIn("digraph ALP", out)
        self.assertIn("cluster_", out)

    def test_json(self):
        v = WorkflowVisualizer()
        out = v.to_json(v.parse_workflows([self._obj("wf-1")]))
        self.assertIn('"id": "wf-1"', out)


if __name__ == "__main__":
    unittest.main()
