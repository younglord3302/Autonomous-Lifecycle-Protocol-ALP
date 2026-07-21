import os
import sys
import unittest

SDK_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SDK_ROOT not in sys.path:
    sys.path.insert(0, SDK_ROOT)

from alp_sdk import WorkflowAuthor
from alp_sdk.author import AuthoringError


class TestWorkflowAuthor(unittest.TestCase):
    def test_rule_based_decomposes_goal(self):
        author = WorkflowAuthor()
        result = author.author("Deploy feature X to staging")
        self.assertEqual(result["id"], "deploy-feature-x-to-staging")
        self.assertGreaterEqual(len(result["steps"]), 1)

    def test_empty_goal_raises(self):
        author = WorkflowAuthor()
        with self.assertRaises(AuthoringError):
            author.author("")

    def test_llm_endpoint_flag(self):
        author = WorkflowAuthor(llm_endpoint="http://localhost:11434")
        result = author.author("Do something")
        self.assertTrue(result["steps"][0].get("llm", False))

    def test_out_prefix_defaults(self):
        author = WorkflowAuthor()
        result = author.author("Build and test")
        self.assertEqual(result["out_prefix"], ".alp/tmp/")
