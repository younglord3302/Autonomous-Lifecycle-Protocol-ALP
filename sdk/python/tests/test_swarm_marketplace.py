import pytest
from alp_sdk.swarm_marketplace import (
    SwarmMarketplaceEngine,
    SkillListing,
    SkillInvocationResult,
)

class TestSwarmMarketplaceEngine:
    def test_register_and_discover_skill(self):
        engine = SwarmMarketplaceEngine()
        listing = engine.register_skill("s1", "agent-coder", "code-review", "analysis", 0.05, "Reviews PRs")

        assert listing.id == "s1"
        assert listing.provider_agent == "agent-coder"
        assert listing.category == "analysis"

        found = engine.discover_skills("analysis")
        assert len(found) == 1
        assert found[0].skill_name == "code-review"

    def test_invoke_skill_and_log(self):
        engine = SwarmMarketplaceEngine()
        engine.register_skill("s2", "agent-writer", "summarize", "nlp", 0.02)

        result = engine.invoke_skill("s2", "agent-reader", "Summarize this document")
        assert result is not None
        assert isinstance(result, SkillInvocationResult)
        assert result.caller_agent == "agent-reader"
        assert result.provider_agent == "agent-writer"
        assert result.cost_charged == 0.02
        assert len(engine.get_invocation_log()) == 1

        listing = engine.get_listing("s2")
        assert listing is not None
        assert listing.total_invocations == 1

    def test_rate_skill(self):
        engine = SwarmMarketplaceEngine()
        engine.register_skill("s3", "agent-x", "format-json", "utility")
        assert engine.rate_skill("s3", 4.0) is True
        assert engine.get_listing("s3").rating <= 5.0
        assert engine.rate_skill("missing", 3.0) is False

    def test_invoke_missing_skill_returns_none(self):
        engine = SwarmMarketplaceEngine()
        assert engine.invoke_skill("nope", "caller", "data") is None
