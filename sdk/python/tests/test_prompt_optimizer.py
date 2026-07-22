import pytest
from alp_sdk.prompt_optimizer import (
    PromptOptimizerEngine,
    PromptOptimizerConfig,
    PromptOptimizationResult,
)

class TestPromptOptimizerConfig:
    def test_default_values(self):
        config = PromptOptimizerConfig("opt-1", "agent-x", "base prompt text")
        assert config.id == "opt-1"
        assert config.target_agent == "agent-x"
        assert config.base_prompt == "base prompt text"
        assert config.strategy == "chain_of_thought"

class TestPromptOptimizerEngine:
    def test_optimize_prompt_chain_of_thought(self):
        engine = PromptOptimizerEngine()
        result = engine.optimize_prompt(
            opt_id="opt-1",
            target_agent="coder-agent",
            base_prompt="Write math code",
            strategy="chain_of_thought",
            baseline_score=0.70,
        )

        assert isinstance(result, PromptOptimizationResult)
        assert result.id == "opt-1"
        assert result.target_agent == "coder-agent"
        assert result.strategy == "chain_of_thought"
        assert "Think step by step" in result.optimized_prompt
        assert result.new_score > 0.70
        assert result.score_improvement == 0.15
        assert result.iteration == 1

    def test_track_history(self):
        engine = PromptOptimizerEngine()
        engine.optimize_prompt("o1", "agent-a", "P1", "role_spec")
        engine.optimize_prompt("o2", "agent-a", "P2", "few_shot")

        history = engine.get_history("agent-a")
        assert len(history) == 2
        assert history[1].iteration == 2
        assert history[1].strategy == "few_shot"

    def test_max_score_cap(self):
        engine = PromptOptimizerEngine()
        result = engine.optimize_prompt("o-max", "agent-b", "P", "auto_dpo", baseline_score=0.95)
        assert result.new_score == 1.0
