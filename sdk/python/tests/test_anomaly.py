import os
import sys
import unittest

SDK_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SDK_ROOT not in sys.path:
    sys.path.insert(0, SDK_ROOT)

from alp_sdk.anomaly import AnomalyDetector


class TestAnomalyDetector(unittest.TestCase):
    def _events(self):
        return [
            {"timestamp": "2026-01-01T00:00:00Z", "type": "run_start", "task_id": "t1", "agent": "a1"},
            {"timestamp": "2026-01-01T00:00:01Z", "type": "task_claim", "task_id": "t1", "agent": "a1"},
            {"timestamp": "2026-01-01T00:00:02Z", "type": "task_status", "task_id": "t1", "status": "[x]", "agent": "a1"},
            {"timestamp": "2026-01-01T00:00:03Z", "type": "run_start", "task_id": "t2", "agent": "a1"},
            {"timestamp": "2026-01-01T00:00:04Z", "type": "task_claim", "task_id": "t2", "agent": "a1"},
            {"timestamp": "2026-01-01T00:00:05Z", "type": "task_status", "task_id": "t2", "status": "[x]", "agent": "a1"},
        ]

    def test_no_anomaly_on_normal_event(self):
        det = AnomalyDetector(self._events())
        event = {"timestamp": "2026-01-01T00:00:06Z", "type": "task_status", "task_id": "t3", "status": "[x]", "agent": "a1"}
        self.assertIsNone(det.detect(event))

    def test_detect_failure_spike(self):
        events = [
            {"timestamp": "2026-01-01T00:00:00Z", "type": "task_status", "task_id": "t1", "status": "[x]", "agent": "a1"},
            {"timestamp": "2026-01-01T00:00:01Z", "type": "task_status", "task_id": "t2", "status": "[x]", "agent": "a1"},
        ]
        det = AnomalyDetector(events)
        event = {"timestamp": "2026-01-01T00:00:02Z", "type": "task_status", "task_id": "t3", "status": "[!]", "agent": "a1"}
        result = det.detect(event)
        self.assertIsNotNone(result)
        self.assertIn("failure_spike", result["anomalies"])

    def test_update_threshold(self):
        det = AnomalyDetector(self._events(), z_threshold=2.0)
        det.update_threshold(5.0)
        self.assertEqual(det.z_threshold, 5.0)

    def test_detect_batch_empty(self):
        det = AnomalyDetector(self._events())
        self.assertEqual(det.detect_batch([]), [])
