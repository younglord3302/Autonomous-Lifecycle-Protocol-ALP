import unittest
from alp_sdk.macro import MacroEngine


class TestMacroEngine(unittest.TestCase):
    def test_expand_list_items(self):
        engine = MacroEngine()
        macro = {
            "id": "gen-tasks",
            "iterate_over": "['auth', 'billing', 'notifications']",
            "as": "svc",
            "template": {
                "_type": "task",
                "id": "task-deploy-${svc}",
                "name": "Deploy ${svc} service",
                "owner": "agent-devops",
            },
        }

        expanded = engine.expand(macro)
        self.assertEqual(len(expanded), 3)
        self.assertEqual(expanded[0]["id"], "task-deploy-auth")
        self.assertEqual(expanded[0]["name"], "Deploy auth service")
        self.assertEqual(expanded[1]["id"], "task-deploy-billing")

    def test_expand_all_objects(self):
        engine = MacroEngine()
        objects = [
            {"_type": "agent", "id": "agent-1"},
            {
                "_type": "macro",
                "id": "m1",
                "iterate_over": "['x', 'y']",
                "as": "var",
                "template": {"_type": "task", "id": "t-${var}"},
            },
        ]

        result = engine.expand_all(objects)
        self.assertEqual(len(result), 3)
        self.assertEqual(result[0]["_type"], "agent")
        self.assertEqual(result[1]["id"], "t-x")
        self.assertEqual(result[2]["id"], "t-y")

    def test_missing_iterate_over_raises(self):
        engine = MacroEngine()
        with self.assertRaises(ValueError):
            engine.expand({"id": "bad"})
