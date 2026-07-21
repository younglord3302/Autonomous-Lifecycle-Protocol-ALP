import os
import sys
import unittest

SDK_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SDK_ROOT not in sys.path:
    sys.path.insert(0, SDK_ROOT)

from alp_sdk.cost_optimizer import (
    AutoScaleRecommendation,
    CostEstimator,
    CostOptimizer,
    OptimizationPlan,
    OptimizationSuggestion,
)


class FakeMeteringLog:
    def __init__(self, entries):
        self._entries = entries

    def read_all(self):
        return list(self._entries)

    def cost_estimate(self, task_id):
        entries = [e for e in self._entries if e.get("task_id") == task_id]
        tokens = sum(int(e.get("input_tokens", 0)) + int(e.get("output_tokens", 0)) for e in entries)
        operations = sum(int(e.get("operations", 0)) for e in entries)
        return {"tokens": tokens, "operations": operations}


class TestCostEstimator(unittest.TestCase):
    def test_estimate_workflow(self):
        metering = FakeMeteringLog([])
        est = CostEstimator(metering)
        wf = {
            "id": "wf-1",
            "steps": [
                {"id": "s1", "name": "build", "estimated_tokens": 2000, "estimated_operations": 20},
                {"id": "s2", "name": "test", "estimated_tokens": 1000, "estimated_operations": 10},
            ],
        }
        result = est.estimate_workflow(wf)
        self.assertEqual(result["workflow_id"], "wf-1")
        self.assertEqual(result["total_tokens"], 3000)
        self.assertEqual(result["total_operations"], 30)
        self.assertGreater(result["estimated_cost"], 0)
        self.assertEqual(len(result["step_estimates"]), 2)

    def test_estimate_task_with_history(self):
        metering = FakeMeteringLog([
            {"task_id": "t1", "input_tokens": 500, "output_tokens": 500, "operations": 5},
        ])
        est = CostEstimator(metering)
        result = est.estimate_task("t1")
        self.assertEqual(result["tokens"], 1000)
        self.assertEqual(result["operations"], 5)
        self.assertGreater(result["estimated_cost"], 0)

    def test_estimate_task_fallback(self):
        metering = FakeMeteringLog([])
        est = CostEstimator(metering)
        result = est.estimate_task("missing")
        self.assertEqual(result["tokens"], 0)
        self.assertEqual(result["operations"], 0)


class TestOptimizationSuggestion(unittest.TestCase):
    def test_to_dict(self):
        s = OptimizationSuggestion(kind="caching", description="Cache build", estimated_savings=0.01, confidence=0.7)
        d = s.to_dict()
        self.assertEqual(d["kind"], "caching")
        self.assertEqual(d["estimated_savings"], 0.01)


class TestOptimizationPlan(unittest.TestCase):
    def test_summary(self):
        plan = OptimizationPlan(
            workflow_id="wf-1",
            current_estimated_cost=0.05,
            optimized_estimated_cost=0.03,
            suggestions=[OptimizationSuggestion("parallelization", "Run in parallel", 0.02, 0.8)],
        )
        s = plan.summary()
        self.assertIn("wf-1", s)
        self.assertIn("savings=", s)

    def test_to_dict_savings(self):
        plan = OptimizationPlan(workflow_id="wf-1", current_estimated_cost=0.10, optimized_estimated_cost=0.06)
        d = plan.to_dict()
        self.assertAlmostEqual(d["savings"], 0.04, places=6)
        self.assertAlmostEqual(d["savings_percent"], 40.0, places=2)


class TestCostOptimizer(unittest.TestCase):
    def test_optimize_empty_workflow(self):
        metering = FakeMeteringLog([])
        optimizer = CostOptimizer(metering)
        plan = optimizer.optimize({"id": "wf-empty", "steps": []})
        self.assertEqual(plan.current_estimated_cost, 0.0)
        self.assertEqual(plan.optimized_estimated_cost, 0.0)
        self.assertEqual(len(plan.suggestions), 0)

    def test_optimize_parallelization(self):
        metering = FakeMeteringLog([])
        optimizer = CostOptimizer(metering)
        wf = {
            "id": "wf-1",
            "steps": [
                {"id": "s1", "name": "build", "estimated_tokens": 1000, "estimated_operations": 10},
                {"id": "s2", "name": "lint", "estimated_tokens": 500, "estimated_operations": 5},
                {"id": "s3", "name": "test", "estimated_tokens": 800, "estimated_operations": 8, "depends_on": ["s1"]},
            ],
        }
        plan = optimizer.optimize(wf)
        self.assertGreater(plan.current_estimated_cost, 0)
        kinds = [s.kind for s in plan.suggestions]
        self.assertIn("parallelization", kinds)

    def test_optimize_caching(self):
        metering = FakeMeteringLog([])
        optimizer = CostOptimizer(metering)
        wf = {
            "id": "wf-1",
            "steps": [
                {"id": "s1", "name": "build", "estimated_tokens": 1000, "estimated_operations": 10, "cache": True},
            ],
        }
        plan = optimizer.optimize(wf)
        kinds = [s.kind for s in plan.suggestions]
        self.assertIn("caching", kinds)

    def test_optimize_agent_reassignment(self):
        metering = FakeMeteringLog([])
        optimizer = CostOptimizer(metering, agent_costs={"a1": 0.10, "a2": 0.04})
        wf = {
            "id": "wf-1",
            "steps": [
                {"id": "s1", "name": "build", "agent": "a1", "estimated_tokens": 1000, "estimated_operations": 10},
            ],
        }
        plan = optimizer.optimize(wf)
        kinds = [s.kind for s in plan.suggestions]
        self.assertIn("agent_reassignment", kinds)

    def test_optimize_reduces_cost(self):
        metering = FakeMeteringLog([])
        optimizer = CostOptimizer(metering)
        wf = {
            "id": "wf-1",
            "steps": [
                {"id": "s1", "name": "a", "estimated_tokens": 1000, "estimated_operations": 10},
                {"id": "s2", "name": "b", "estimated_tokens": 1000, "estimated_operations": 10},
            ],
        }
        plan = optimizer.optimize(wf)
        self.assertLessEqual(plan.optimized_estimated_cost, plan.current_estimated_cost)


class TestAutoScaleRecommendation(unittest.TestCase):
    def test_recommend_when_no_runs(self):
        metering = FakeMeteringLog([])
        optimizer = CostOptimizer(metering)
        recs = optimizer.recommend_auto_scale("wf-1", [])
        self.assertEqual(len(recs), 1)
        self.assertEqual(recs[0].metric, "concurrency")
        self.assertEqual(recs[0].recommended_value, 2.0)

    def test_recommend_from_throughput(self):
        metering = FakeMeteringLog([])
        optimizer = CostOptimizer(metering)
        recent_runs = [
            {"duration_ms": 1000, "tasks_completed": 5, "concurrency": 1},
            {"duration_ms": 1000, "tasks_completed": 5, "concurrency": 1},
        ]
        recs = optimizer.recommend_auto_scale("wf-1", recent_runs)
        self.assertGreaterEqual(len(recs), 1)
        self.assertEqual(recs[0].metric, "concurrency")


if __name__ == "__main__":
    unittest.main()
