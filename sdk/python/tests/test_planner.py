import os
import sys
import unittest

SDK_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SDK_ROOT not in sys.path:
    sys.path.insert(0, SDK_ROOT)

from alp_sdk import GoalDecomposer, Planner, Reflector, Plan, PlanNode, Lesson, PredictiveEstimator


class FakeEstimator:
    def estimate(self, plan_id):
        return {"failure_risk": 0.1, "confidence": "high"}


class TestGoalDecomposer(unittest.TestCase):
    def test_decompose_returns_plan(self):
        gd = GoalDecomposer()
        plan = gd.decompose("Build and test and deploy")
        self.assertIsInstance(plan, Plan)
        self.assertGreaterEqual(len(plan.nodes), 1)

    def test_decompose_empty_raises(self):
        gd = GoalDecomposer()
        with self.assertRaises(ValueError):
            gd.decompose("")

    def test_to_workflow_round_trip(self):
        gd = GoalDecomposer()
        plan = gd.decompose("Ship feature X")
        wf = gd.to_workflow(plan)
        self.assertEqual(wf["plan_id"], plan.plan_id)
        self.assertEqual(wf["goal"], "Ship feature X")


class TestPlanner(unittest.TestCase):
    def test_rank_sorts_by_score(self):
        planner = Planner()
        p1 = Plan("p1", "Goal A", [PlanNode("s1", "task", "A")])
        p2 = Plan("p2", "Goal B", [PlanNode("s1", "task", "B"), PlanNode("s2", "task", "C", ["s1"])])
        ranked = planner.rank([p1, p2])
        self.assertEqual(len(ranked), 2)
        self.assertEqual(ranked[0]["plan"]["plan_id"], "p1")

    def test_rank_with_estimator(self):
        planner = Planner(estimator=FakeEstimator())
        p1 = Plan("p1", "Goal A", [PlanNode("s1", "task", "A")])
        ranked = planner.rank([p1])
        self.assertEqual(ranked[0]["rank"], 1)
        self.assertEqual(ranked[0]["score"]["confidence"], "high")

    def test_score_fields(self):
        planner = Planner()
        p = Plan("p1", "Goal", [PlanNode("s1", "task", "A")])
        ranked = planner.rank([p])
        score = ranked[0]["score"]
        self.assertIn("composite", score)
        self.assertIn("risk", score)
        self.assertIn("depth", score)


class TestReflector(unittest.TestCase):
    def _events(self):
        return [
            {"type": "task_status", "task_id": "t1", "status": "[!]", "timestamp": "2026-01-01T00:00:00Z"},
            {"type": "task_status", "task_id": "t1", "status": "[!]", "timestamp": "2026-01-01T00:00:01Z"},
            {"type": "task_claim", "task_id": "t1", "timestamp": "2026-01-01T00:00:02Z"},
            {"type": "human_handoff", "task_id": "t1", "status": "[?]", "timestamp": "2026-01-01T00:00:03Z"},
            {"type": "human_handoff", "task_id": "t2", "status": "[?]", "timestamp": "2026-01-01T00:00:04Z"},
        ]

    def test_reflect_detects_failure(self):
        ref = Reflector(self._events())
        lessons = ref.reflect("run-1")
        failure_lessons = [l for l in lessons if "failed" in l.insight]
        self.assertTrue(len(failure_lessons) >= 1)

    def test_reflect_detects_handoffs(self):
        ref = Reflector(self._events())
        lessons = ref.reflect("run-1")
        handoff_lessons = [l for l in lessons if "handoffs" in l.insight]
        self.assertTrue(len(handoff_lessons) >= 1)

    def test_reflect_empty_events(self):
        ref = Reflector([])
        lessons = ref.reflect("run-1")
        self.assertEqual(lessons, [])

    def test_lesson_to_dict(self):
        lesson = Lesson("l1", "run-1", "insight", "warn", ["tag1"])
        d = lesson.to_dict()
        self.assertEqual(d["lesson_id"], "l1")
        self.assertEqual(d["severity"], "warn")
        self.assertIn("tag1", d["tags"])
