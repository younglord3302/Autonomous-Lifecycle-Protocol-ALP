import os
import sys
import unittest

SDK_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SDK_ROOT not in sys.path:
    sys.path.insert(0, SDK_ROOT)

from alp_sdk import PolicyEngine, PolicyQuery, PolicySuggestion, PolicyVersion, PolicyRollback
from alp_sdk.models import AlpObject


class FakePolicy:
    def __init__(self, pid, props):
        self.id = pid
        self._type = "policy"
        self.properties = props


class TestPolicySuggestion(unittest.TestCase):
    def test_suggestion_attributes(self):
        s = PolicySuggestion(
            suggestion_id="s1",
            policy_id="p1",
            action_kind="path",
            action_value="/tmp",
            reason="denied by policy",
            confidence=0.7,
        )
        self.assertEqual(s.suggestion_id, "s1")
        self.assertEqual(s.policy_id, "p1")
        self.assertEqual(s.confidence, 0.7)
        self.assertIn("s1", repr(s))

    def test_to_dict_round_trip(self):
        s = PolicySuggestion("s1", "p1", "path", "/tmp", "denied", 0.8)
        d = s.to_dict()
        self.assertEqual(d["suggestion_id"], "s1")
        self.assertEqual(d["confidence"], 0.8)
        self.assertIn("created_at", d)

    def test_confidence_clamped(self):
        s = PolicySuggestion("s1", "p1", "path", "/tmp", "denied", confidence=1.5)
        self.assertEqual(s.confidence, 1.0)
        s2 = PolicySuggestion("s1", "p1", "path", "/tmp", "denied", confidence=-0.5)
        self.assertEqual(s2.confidence, 0.0)


class TestPolicyVersioning(unittest.TestCase):
    def _engine(self):
        return PolicyEngine([
            FakePolicy("p1", {"enforcement": "strict", "deny_paths": ["/tmp"]}),
        ])

    def test_version_policy_snapshots(self):
        engine = self._engine()
        v1 = engine.version_policy("p1", "1.0.0")
        self.assertIsNotNone(v1)
        self.assertEqual(v1.version, "1.0.0")
        versions = engine.get_versions("p1")
        self.assertEqual(len(versions), 1)
        self.assertEqual(versions[0].version, "1.0.0")

    def test_rollback_restores_snapshot(self):
        engine = self._engine()
        engine.version_policy("p1", "1.0.0")
        engine.policies[0].properties["deny_paths"] = ["/secret"]
        engine.version_policy("p1", "2.0.0")
        result = engine.rollback("p1", "1.0.0")
        self.assertIsNotNone(result)
        self.assertEqual(result.to_version, "1.0.0")
        self.assertEqual(engine.policies[0].properties.get("deny_paths"), ["/tmp"])

    def test_rollback_unknown_version_returns_none(self):
        engine = self._engine()
        result = engine.rollback("p1", "99.0.0")
        self.assertIsNone(result)


class TestPolicySuggest(unittest.TestCase):
    def _engine(self):
        return PolicyEngine([
            FakePolicy("p1", {"enforcement": "warn", "deny_paths": ["/tmp"]}),
        ])

    def test_suggest_returns_suggestions_for_warn(self):
        engine = self._engine()
        suggestions = engine.suggest(PolicyQuery("path", "/tmp"))
        self.assertEqual(len(suggestions), 1)
        self.assertEqual(suggestions[0].policy_id, "p1")
        self.assertEqual(suggestions[0].action_kind, "path")

    def test_suggest_empty_for_strict(self):
        engine = PolicyEngine([
            FakePolicy("p1", {"enforcement": "strict", "deny_paths": ["/tmp"]}),
        ])
        suggestions = engine.suggest(PolicyQuery("path", "/tmp"))
        self.assertEqual(len(suggestions), 0)
