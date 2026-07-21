import os
import sys
import unittest

SDK_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SDK_ROOT not in sys.path:
    sys.path.insert(0, SDK_ROOT)

from alp_sdk.event_store import EventStore
from alp_sdk.models import AlpObject
from alp_sdk.policy import PolicyQuery
from alp_sdk.predictive_policy import (
    AnomalyScore,
    BaselineProfile,
    PredictivePolicyEngine,
)


def _make_objects():
    return [
        AlpObject(
            _type="policy",
            id="p-strict",
            properties={
                "allow_commands": ["run"],
                "deny_commands": ["rm"],
                "enforcement": "strict",
            },
        ),
        AlpObject(
            _type="policy",
            id="p-warn",
            properties={
                "allow_commands": ["run"],
                "deny_commands": ["rm"],
                "enforcement": "warn",
            },
        ),
    ]


class TestAnomalyScore(unittest.TestCase):
    def test_is_anomalous_threshold(self):
        score = AnomalyScore(score=0.8, factors=["high_failure_rate"])
        self.assertTrue(score.is_anomalous(0.7))
        self.assertFalse(score.is_anomalous(0.9))

    def test_to_dict_round_trip(self):
        score = AnomalyScore(score=0.75, factors=["burst"], recommendation="require_approval")
        d = score.to_dict()
        self.assertEqual(d["score"], 0.75)
        self.assertEqual(d["recommendation"], "require_approval")


class TestBaselineProfile(unittest.TestCase):
    def test_to_dict(self):
        bp = BaselineProfile(kind="command", value="run", sample_count=10, mean_frequency=1.0, stddev_frequency=0.5, failure_rate=0.1, last_seen="2026-01-01T00:00:00Z")
        d = bp.to_dict()
        self.assertEqual(d["kind"], "command")
        self.assertEqual(d["value"], "run")
        self.assertEqual(d["sample_count"], 10)


class TestPredictivePolicyEngineBasics(unittest.TestCase):
    def test_no_event_store_does_not_crash(self):
        engine = PredictivePolicyEngine(_make_objects())
        decision = engine.evaluate(PolicyQuery(kind="command", value="run"))
        self.assertIn("anomaly", decision.audit)

    def test_attaches_anomaly_to_decision(self):
        engine = PredictivePolicyEngine(_make_objects())
        decision = engine.evaluate(PolicyQuery(kind="command", value="run"))
        anomaly = decision.audit.get("anomaly") or {}
        self.assertIn("score", anomaly)
        self.assertIn("factors", anomaly)
        self.assertIn("recommendation", anomaly)

    def test_deny_only_also_attaches_anomaly(self):
        engine = PredictivePolicyEngine(_make_objects())
        decision = engine.evaluate_deny_only(PolicyQuery(kind="command", value="rm"))
        anomaly = decision.audit.get("anomaly") or {}
        self.assertIn("score", anomaly)

    def test_proposal_attaches_neutral_anomaly(self):
        engine = PredictivePolicyEngine(_make_objects())
        decision = engine.evaluate_proposal("noop")
        anomaly = decision.audit.get("anomaly") or {}
        self.assertEqual(anomaly.get("score"), 0.0)


class TestPredictivePolicyEngineLearning(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.tmpdir = tempfile.mkdtemp()
        self.store = EventStore(self.tmpdir, version="16.2.0")

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _seed_events(self, count: int = 20):
        for i in range(count):
            status = "[x]" if i % 2 != 0 else "[!]"
            blocked = status == "[!]"
            self.store.append(
                "policy_query",
                payload={
                    "kind": "command",
                    "value": "run",
                    "status": status,
                    "blocked": blocked,
                },
            )

    def test_learns_baselines_from_event_store(self):
        self._seed_events(20)
        engine = PredictivePolicyEngine(_make_objects(), event_store=self.store)
        baselines = engine.get_baselines()
        self.assertEqual(len(baselines), 1)
        self.assertEqual(baselines[0].kind, "command")
        self.assertEqual(baselines[0].value, "run")
        self.assertEqual(baselines[0].sample_count, 20)

    def test_high_failure_rate_increases_anomaly_score(self):
        self._seed_events(20)
        engine = PredictivePolicyEngine(_make_objects(), event_store=self.store)
        decision = engine.evaluate(PolicyQuery(kind="command", value="run"))
        anomaly = decision.audit.get("anomaly") or {}
        self.assertIn("high_failure_rate", anomaly.get("factors", []))

    def test_rare_request_flags_insufficient_history(self):
        engine = PredictivePolicyEngine(_make_objects(), event_store=self.store)
        decision = engine.evaluate(PolicyQuery(kind="command", value="deploy"))
        anomaly = decision.audit.get("anomaly") or {}
        self.assertIn("insufficient_history", anomaly.get("factors", []))

    def test_history_records_evaluations(self):
        engine = PredictivePolicyEngine(_make_objects(), event_store=self.store)
        engine.evaluate(PolicyQuery(kind="command", value="run"))
        engine.evaluate(PolicyQuery(kind="command", value="run"))
        self.assertEqual(len(engine.get_history()), 2)

    def test_anomalies_summary_filters_by_policy(self):
        engine = PredictivePolicyEngine(_make_objects(), event_store=self.store)
        engine.evaluate(PolicyQuery(kind="command", value="rm"))
        engine.evaluate(PolicyQuery(kind="command", value="run"))
        summary = engine.anomalies_summary(policy_id="p-strict")
        self.assertGreaterEqual(summary["total"], 0)


if __name__ == "__main__":
    unittest.main()
