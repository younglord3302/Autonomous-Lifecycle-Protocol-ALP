import json
import os
import shutil
import sys
import tempfile
import unittest

SDK_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SDK_ROOT not in sys.path:
    sys.path.insert(0, SDK_ROOT)

from alp_sdk import MeteringLog, CostAnalyzer


class TestMeteringLog(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def _ml(self):
        return MeteringLog(self.tmp)

    def test_append_creates_file(self):
        ml = self._ml()
        ml.append("T1", "a1", input_tokens=10, output_tokens=20, operations=3, duration_ms=150)
        self.assertTrue(os.path.exists(os.path.join(self.tmp, ".runtime", "metering.jsonl")))

    def test_append_writes_valid_json(self):
        ml = self._ml()
        ml.append("T1", "a1", input_tokens=10, output_tokens=20, operations=3, duration_ms=150)
        with open(os.path.join(self.tmp, ".runtime", "metering.jsonl"), "r", encoding="utf-8") as f:
            line = f.readline().strip()
        parsed = json.loads(line)
        self.assertEqual(parsed["task_id"], "T1")
        self.assertEqual(parsed["input_tokens"], 10)
        self.assertEqual(parsed["output_tokens"], 20)
        self.assertEqual(parsed["operations"], 3)
        self.assertEqual(parsed["duration_ms"], 150)
        self.assertIn("timestamp", parsed)

    def test_read_all_empty(self):
        ml = self._ml()
        self.assertEqual(ml.read_all(), [])

    def test_read_all_multiple(self):
        ml = self._ml()
        ml.append("T1", "a1", input_tokens=100, output_tokens=50, operations=5, duration_ms=500)
        ml.append("T2", "a2", input_tokens=30, output_tokens=10, operations=2, duration_ms=120)
        entries = ml.read_all()
        self.assertEqual(len(entries), 2)
        self.assertEqual(entries[0]["task_id"], "T1")
        self.assertEqual(entries[1]["task_id"], "T2")

    def test_skips_malformed_lines(self):
        p = os.path.join(self.tmp, ".runtime", "metering.jsonl")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8") as f:
            f.write('{"task_id":"T1"}\n')
            f.write("not json\n")
            f.write('{"task_id":"T2"}\n')
        ml = self._ml()
        self.assertEqual(len(ml.read_all()), 2)

    def test_cost_estimate(self):
        ml = self._ml()
        ml.append("T1", "a1", input_tokens=100, output_tokens=200, operations=4, duration_ms=300)
        ml.append("T1", "a1", input_tokens=50, output_tokens=50, operations=1, duration_ms=100)
        est = ml.cost_estimate("T1")
        self.assertEqual(est["tokens"], 400)
        self.assertEqual(est["operations"], 5)
        self.assertAlmostEqual(est["estimated_cost"], 0.0058, places=6)

    def test_cost_estimate_ignores_other_tasks(self):
        ml = self._ml()
        ml.append("T2", "a2", input_tokens=999, output_tokens=999, operations=99, duration_ms=999)
        est = ml.cost_estimate("T1")
        self.assertEqual(est["tokens"], 0)
        self.assertEqual(est["operations"], 0)
        self.assertEqual(est["estimated_cost"], 0.0)

    def test_cost_estimate_empty(self):
        ml = self._ml()
        est = ml.cost_estimate("T1")
        self.assertEqual(est["tokens"], 0)
        self.assertEqual(est["operations"], 0)
        self.assertEqual(est["estimated_cost"], 0.0)

    def test_rate_limiter(self):
        ml = self._ml()
        rl = ml.rate_limiter("my-project")
        self.assertEqual(rl["remaining"], 100)
        self.assertIn("resetAt", rl)

    def test_cost_analyzer_estimate(self):
        ml = self._ml()
        ml.append("T1", "a1", input_tokens=1000, output_tokens=2000, operations=100, duration_ms=1000)
        analyzer = CostAnalyzer(ml)
        est = analyzer.estimate("T1")
        self.assertEqual(est["tokens"], 3000)
        self.assertEqual(est["operations"], 100)

    def test_cost_analyzer_top_cost_tasks(self):
        ml = self._ml()
        ml.append("T1", "a1", input_tokens=100, output_tokens=50, operations=5, duration_ms=500)
        ml.append("T2", "a2", input_tokens=5000, output_tokens=2000, operations=50, duration_ms=2000)
        analyzer = CostAnalyzer(ml)
        top = analyzer.top_cost_tasks(limit=1)
        self.assertEqual(len(top), 1)
        self.assertEqual(top[0]["task_id"], "T2")

    def test_persistence_across_restart(self):
        ml = self._ml()
        ml.append("T1", "a1", input_tokens=10, output_tokens=5, operations=1, duration_ms=100)
        ml2 = MeteringLog(self.tmp)
        entries = ml2.read_all()
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["task_id"], "T1")


if __name__ == "__main__":
    unittest.main()
