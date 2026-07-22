import unittest
from alp_sdk.prompt_optimizer import (
    PromptOptimizerEngine,
    PromptOptimizerConfig,
    PromptOptimizationResult,
)

class TestPromptOptimizerConfig(unittest.TestCase):
    def test_default_values(self):
        config = PromptOptimizerConfig("opt-1", "agent-x", "base prompt text")
        self.assertEqual(config.id, "opt-1")
        self.assertEqual(config.target_agent, "agent-x")
        self.assertEqual(config.base_prompt, "base prompt text")
        self.assertEqual(config.strategy, "chain_of_thought")

class TestPromptOptimizerEngine(unittest.TestCase):
    def test_optimize_prompt_chain_of_thought(self):
        engine = PromptOptimizerEngine()
        result = engine.optimize_prompt(
            opt_id="opt-1",
            target_agent="coder-agent",
            base_prompt="Write math code",
            strategy="chain_of_thought",
            baseline_score=0.70,
        )

        self.assertIsInstance(result, PromptOptimizationResult)
        self.assertEqual(result.id, "opt-1")
        self.assertEqual(result.target_agent, "coder-agent")
        self.assertEqual(result.strategy, "chain_of_thought")
        self.assertIn("Think step by step", result.optimized_prompt)
        self.assertGreater(result.new_score, 0.70)
        self.assertEqual(result.score_improvement, 0.15)
        self.assertEqual(result.iteration, 1)

    def test_track_history(self):
        engine = PromptOptimizerEngine()
        engine.optimize_prompt("o1", "agent-a", "P1", "role_spec")
        engine.optimize_prompt("o2", "agent-a", "P2", "few_shot")

        history = engine.get_history("agent-a")
        self.assertEqual(len(history), 2)
        self.assertEqual(history[1].iteration, 2)
        self.assertEqual(history[1].strategy, "few_shot")

    def test_max_score_cap(self):
        engine = PromptOptimizerEngine()
        result = engine.optimize_prompt("o-max", "agent-b", "P", "auto_dpo", baseline_score=0.95)
        self.assertEqual(result.new_score, 1.0)
