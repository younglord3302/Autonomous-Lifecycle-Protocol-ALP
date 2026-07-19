import os
import sys
import unittest
from datetime import datetime, timezone, timedelta

SDK_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SDK_ROOT not in sys.path:
    sys.path.insert(0, SDK_ROOT)

from alp_sdk import AlpObject, PolicyEngine, PolicyQuery


def pol(pid, **props):
    d = {"_type": "policy", "id": pid}
    d.update(props)
    return AlpObject.from_dict(d)


class TestPolicyV2Windows(unittest.TestCase):
    def test_outside_window_denied(self):
        # Allowed only Mon-Fri 09:00-17:00 UTC. Evaluate on a
        # Saturday afternoon -> should be denied.
        sat = datetime(2026, 7, 25, 14, 0, tzinfo=timezone.utc)
        engine = PolicyEngine(
            [pol("p1", allow_paths=["src/**"], allow_during=[
                {"days": ["monday", "tuesday", "wednesday", "thursday", "friday"],
                 "start": "09:00", "end": "17:00"},
            ])]
        )
        d = engine.evaluate(PolicyQuery("path", "src/main.py", agent="a1", now=sat))
        self.assertFalse(d.allowed)
        self.assertTrue(d.blocked)

    def test_inside_window_allowed(self):
        mon = datetime(2026, 7, 20, 10, 30, tzinfo=timezone.utc)
        engine = PolicyEngine(
            [pol("p1", allow_paths=["src/**"], allow_during=[
                {"days": ["*"], "start": "09:00", "end": "17:00"},
            ])]
        )
        d = engine.evaluate(PolicyQuery("path", "src/main.py", agent="a1", now=mon))
        self.assertTrue(d.allowed)


class TestPolicyV2Approval(unittest.TestCase):
    def test_requires_approval_not_blocked(self):
        engine = PolicyEngine(
            [pol("p1", allow_paths=["src/**"],
                  require_approval=[{"kind": "path", "value": "src/secrets/**"}])]
        )
        d = engine.evaluate(PolicyQuery("path", "src/secrets/key.py", agent="a1"))
        self.assertTrue(d.allowed)
        self.assertFalse(d.blocked)
        self.assertTrue(d.requires_approval)


class TestPolicyV2Proposal(unittest.TestCase):
    def test_unsigned_blocked_with_trust_root(self):
        engine = PolicyEngine(
            [pol("p1", proposals=[
                {"id": "prop-1", "action": "deploy", "agent": "a1"},
            ])]
        )
        d = engine.evaluate_proposal("prop-1", trust_pems={"alice": "age1..."})
        self.assertFalse(d.allowed)
        self.assertTrue(d.blocked)

    def test_signed_by_trusted_allowed(self):
        engine = PolicyEngine(
            [pol("p1", proposals=[
                {"id": "prop-1", "action": "deploy", "agent": "a1",
                 "signed_by": "alice", "signature": "sig"},
            ])]
        )
        d = engine.evaluate_proposal("prop-1", trust_pems={"alice": "age1..."})
        self.assertTrue(d.allowed)
        self.assertIn("prop-1", d.audit["proposal_id"])

    def test_no_policies_allows(self):
        engine = PolicyEngine([])
        d = engine.evaluate_proposal("prop-x", trust_pems={"alice": "k"})
        self.assertTrue(d.allowed)


if __name__ == "__main__":
    unittest.main()
