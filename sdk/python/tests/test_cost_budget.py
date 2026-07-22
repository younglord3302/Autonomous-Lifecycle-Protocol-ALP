import unittest
from alp_sdk.cost_budget import CostBudgetEngine

class TestCostBudget(unittest.TestCase):
    def test_create_and_track_budget(self):
        engine = CostBudgetEngine()
        b = engine.create_budget("task-1", 5000, 0.02)

        self.assertEqual(b.id, "budget-task-1")
        self.assertEqual(b.max_tokens, 5000)

        res = engine.track_usage(b.id, 1000, 0.005)
        self.assertEqual(res["remaining_tokens"], 4000)
        self.assertFalse(res["is_exceeded"])

    def test_model_selection_router(self):
        engine = CostBudgetEngine()
        route = engine.select_optimal_model("high", 0.20)
        self.assertEqual(route["model"], "claude-3-5-sonnet")

if __name__ == "__main__":
    unittest.main()
