import unittest
from alp_sdk.swarm_marketplace import (
    SwarmMarketplaceEngine,
    SkillListing,
    SkillInvocationResult,
)

class TestSwarmMarketplaceEngine(unittest.TestCase):
    def test_register_and_discover_skill(self):
        engine = SwarmMarketplaceEngine()
        listing = engine.register_skill("s1", "agent-coder", "code-review", "analysis", 0.05, "Reviews PRs")

        self.assertEqual(listing.id, "s1")
        self.assertEqual(listing.provider_agent, "agent-coder")
        self.assertEqual(listing.category, "analysis")

        found = engine.discover_skills("analysis")
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0].skill_name, "code-review")

    def test_invoke_skill_and_log(self):
        engine = SwarmMarketplaceEngine()
        engine.register_skill("s2", "agent-writer", "summarize", "nlp", 0.02)

        result = engine.invoke_skill("s2", "agent-reader", "Summarize this document")
        self.assertIsNotNone(result)
        self.assertIsInstance(result, SkillInvocationResult)
        self.assertEqual(result.caller_agent, "agent-reader")
        self.assertEqual(result.provider_agent, "agent-writer")
        self.assertEqual(result.cost_charged, 0.02)
        self.assertEqual(len(engine.get_invocation_log()), 1)

        listing = engine.get_listing("s2")
        self.assertIsNotNone(listing)
        self.assertEqual(listing.total_invocations, 1)

    def test_rate_skill(self):
        engine = SwarmMarketplaceEngine()
        engine.register_skill("s3", "agent-x", "format-json", "utility")
        self.assertTrue(engine.rate_skill("s3", 4.0))
        self.assertLessEqual(engine.get_listing("s3").rating, 5.0)
        self.assertFalse(engine.rate_skill("missing", 3.0))

    def test_invoke_missing_skill_returns_none(self):
        engine = SwarmMarketplaceEngine()
        self.assertIsNone(engine.invoke_skill("nope", "caller", "data"))
