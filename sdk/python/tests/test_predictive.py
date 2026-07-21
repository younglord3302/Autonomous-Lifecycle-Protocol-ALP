import os
import sys
import unittest

SDK_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SDK_ROOT not in sys.path:
    sys.path.insert(0, SDK_ROOT)

from alp_sdk import compute_analytics, PredictiveEstimator


class TestPredictiveEstimator(unittest.TestCase):
    def _events(self):
        return [
            {"timestamp": "2026-01-01T00:00:00Z", "type": "run_start", "task_id": "t1", "agent": "a1"},
            {"timestamp": "2026-01-01T00:00:01Z", "type": "task_claim", "task_id": "t1", "agent": "a1"},
            {"timestamp": "2026-01-01T00:00:02Z", "type": "task_status", "task_id": "t1", "status": "[x]", "agent": "a1"},
            {"timestamp": "2026-01-01T00:00:03Z", "type": "run_start", "task_id": "t2", "agent": "a2"},
            {"timestamp": "2026-01-01T00:00:04Z", "type": "task_claim", "task_id": "t2", "agent": "a2"},
            {"timestamp": "2026-01-01T00:00:05Z", "type": "task_status", "task_id": "t2", "status": "[!]", "agent": "a2"},
        ]

    def test_estimate_returns_prediction(self):
        est = PredictiveEstimator(self._events())
        pred = est.estimate("t-new", agent="a1")
        self.assertEqual(pred["task_id"], "t-new")
        self.assertEqual(pred["agent"], "a1")
        self.assertIn(pred["confidence"], ("low", "medium", "high"))

    def test_empty_events_low_confidence(self):
        est = PredictiveEstimator([])
        pred = est.estimate("t-new")
        self.assertIsNone(pred["completion_probability"])
        self.assertEqual(pred["confidence"], "low")
        self.assertEqual(pred["sample_size"], 0)

    def test_estimate_batch(self):
        est = PredictiveEstimator(self._events())
        preds = est.estimate_batch([
            {"task_id": "t-a", "agent": "a1"},
            {"task_id": "t-b", "agent": "a2"},
        ])
        self.assertEqual(len(preds), 2)
        self.assertEqual(preds[0]["task_id"], "t-a")
        self.assertEqual(preds[1]["task_id"], "t-b")
