import os
import sys
import unittest

SDK_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SDK_ROOT not in sys.path:
    sys.path.insert(0, SDK_ROOT)

from alp_sdk import Negotiator, ReputationStore, TeamComposer, Offer, ContractDraft, NegotiationResult, Capability


class FakeContractEngine:
    def check(self, contract_id, context):
        pass


class TestNegotiator(unittest.TestCase):
    def test_negotiate_returns_success(self):
        neg = Negotiator()
        result = neg.negotiate("agent-a", "agent-b", {"cost": 10, "time": "1h"})
        self.assertTrue(result.success)
        self.assertIsNotNone(result.draft)
        self.assertEqual(result.draft.parties, ["agent-a", "agent-b"])

    def test_negotiate_missing_parties_fails(self):
        neg = Negotiator()
        result = neg.negotiate("", "agent-b", {"cost": 10})
        self.assertFalse(result.success)

    def test_negotiate_with_constraints(self):
        neg = Negotiator()
        result = neg.negotiate("a", "b", {"cost": 5}, {"max_time": "2h"})
        self.assertTrue(result.success)
        units = [t.unit for t in result.draft.terms if t.unit]
        self.assertIn("constraint", units)

    def test_propose_accept_reject(self):
        neg = Negotiator()
        proposal = neg.propose("agent-a", {"cost": 10})
        self.assertEqual(proposal["status"], "proposed")
        accepted = neg.accept(proposal)
        self.assertEqual(accepted["status"], "accepted")
        rejected = neg.reject(proposal, "too expensive")
        self.assertEqual(rejected["status"], "rejected")
        self.assertEqual(rejected["reason"], "too expensive")


class TestReputationStore(unittest.TestCase):
    def test_initial_score_is_neutral(self):
        store = ReputationStore()
        self.assertEqual(store.get_score("new-agent"), 0.5)

    def test_fulfillment_improves_score(self):
        store = ReputationStore()
        store.record_fulfillment("agent-1")
        self.assertGreater(store.get_score("agent-1"), 0.5)

    def test_breach_lowers_score(self):
        store = ReputationStore()
        store.record_fulfillment("agent-1", weight=3)
        store.record_breach("agent-1", weight=7)
        self.assertLess(store.get_score("agent-1"), 0.5)

    def test_top_agents_sorted(self):
        store = ReputationStore()
        store.record_fulfillment("good", weight=10)
        store.record_breach("bad", weight=10)
        top = store.top_agents(2)
        self.assertEqual(top[0]["agent"], "good")


class TestTeamComposer(unittest.TestCase):
    def test_compose_matches_required_capabilities(self):
        store = ReputationStore()
        composer = TeamComposer(store)
        candidates = [
            {"agent": "a1", "capabilities": [{"name": "code"}, {"name": "test"}]},
            {"agent": "a2", "capabilities": [{"name": "design"}]},
        ]
        result = composer.compose({"requires": ["code"], "size": 2}, candidates)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["agent"], "a1")

    def test_suggest_team_empty_query_returns_all(self):
        store = ReputationStore()
        composer = TeamComposer(store)
        candidates = [
            {"agent": "a1", "capabilities": [{"name": "code"}]},
            {"agent": "a2", "capabilities": [{"name": "design"}]},
        ]
        result = composer.suggest_team({}, candidates)
        self.assertEqual(len(result), 2)
