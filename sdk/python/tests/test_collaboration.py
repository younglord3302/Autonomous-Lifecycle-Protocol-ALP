import unittest
from alp_sdk.collaboration import CollaborationEngine


class TestCollaborationEngine(unittest.TestCase):
    def test_session_presence(self):
        engine = CollaborationEngine()
        session = engine.create_session("doc-1")
        self.assertEqual(session.doc_id, "doc-1")

        p1 = engine.join_session("doc-1", "agent-a")
        self.assertIsNotNone(p1)
        self.assertEqual(p1.agent_id, "agent-a")

        presence = engine.get_presence("doc-1")
        self.assertEqual(len(presence), 1)

        left = engine.leave_session("doc-1", "agent-a")
        self.assertTrue(left)

    def test_apply_operations_and_snapshot(self):
        engine = CollaborationEngine()
        engine.create_session("doc-state")
        engine.join_session("doc-state", "agent-1")

        op1 = engine.apply_operation("doc-state", "insert", "title", "agent-1", "Initial Title")
        self.assertIsNotNone(op1)
        self.assertEqual(engine.get_snapshot("doc-state")["title"], "Initial Title")

        engine.apply_operation("doc-state", "update", "title", "agent-1", "Updated Title")
        self.assertEqual(engine.get_snapshot("doc-state")["title"], "Updated Title")
        self.assertEqual(len(engine.get_operation_log("doc-state")), 2)

    def test_fork_and_merge_branch(self):
        engine = CollaborationEngine()
        engine.create_session("doc-main", {"status": "draft"})

        branch = engine.fork("doc-main", "feature-branch")
        self.assertIsNotNone(branch)
        branch.state["status"] = "review"

        result = engine.merge_branch("doc-main", "feature-branch")
        self.assertIsNotNone(result)
        self.assertEqual(result["merged"]["status"], "review")
