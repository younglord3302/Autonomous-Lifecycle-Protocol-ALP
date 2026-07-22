from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

class PromptOptimizationResult:
    def __init__(
        self,
        opt_id: str,
        target_agent: str,
        base_prompt: str,
        optimized_prompt: str,
        strategy: str,
        baseline_score: float,
        new_score: float,
        score_improvement: float,
        iteration: int,
        optimized_at: Optional[str] = None,
    ):
        self.id = opt_id
        self.target_agent = target_agent
        self.base_prompt = base_prompt
        self.optimized_prompt = optimized_prompt
        self.strategy = strategy
        self.baseline_score = baseline_score
        self.new_score = new_score
        self.score_improvement = score_improvement
        self.iteration = iteration
        self.optimized_at = optimized_at or datetime.now(timezone.utc).isoformat()

class PromptOptimizerConfig:
    def __init__(
        self,
        opt_id: str,
        target_agent: str,
        base_prompt: str,
        optimized_prompt: Optional[str] = None,
        strategy: str = "chain_of_thought",
        score_improvement: Optional[float] = None,
        iteration: int = 1,
        description: Optional[str] = None,
    ):
        self.id = opt_id
        self.target_agent = target_agent
        self.base_prompt = base_prompt
        self.optimized_prompt = optimized_prompt
        self.strategy = strategy
        self.score_improvement = score_improvement
        self.iteration = iteration
        self.description = description

class PromptOptimizerEngine:
    def __init__(self):
        self.history: Dict[str, List[PromptOptimizationResult]] = {}

    def optimize_prompt(
        self,
        opt_id: str,
        target_agent: str,
        base_prompt: str,
        strategy: str = "chain_of_thought",
        baseline_score: float = 0.72,
    ) -> PromptOptimizationResult:
        optimized_prompt = base_prompt

        if strategy == "chain_of_thought":
            optimized_prompt = f"{base_prompt}\n\n[Optimization Directive: Think step by step before generating solution.]"
        elif strategy == "few_shot":
            optimized_prompt = f"{base_prompt}\n\n[Few-Shot Example]:\nInput: 'Format user'\nOutput: '{{\"status\": \"success\"}}'"
        elif strategy == "role_spec":
            optimized_prompt = f"You are an expert autonomous software engineer.\n{base_prompt}"
        elif strategy == "constraint_hardening":
            optimized_prompt = f"{base_prompt}\n\n[Strict Constraint: Never return null, missing fields, or invalid syntax.]"
        elif strategy == "auto_dpo":
            optimized_prompt = f"{base_prompt}\n\n[DPO Refinement: Prefer concise, high-density structured responses.]"

        boost_map = {
            "chain_of_thought": 0.15,
            "few_shot": 0.12,
            "role_spec": 0.08,
            "constraint_hardening": 0.18,
            "auto_dpo": 0.21,
        }

        boost = boost_map.get(strategy, 0.10)
        new_score = round(min(1.0, baseline_score + boost), 4)
        score_improvement = round(new_score - baseline_score, 4)

        agent_history = self.history.get(target_agent, [])
        iteration = len(agent_history) + 1

        result = PromptOptimizationResult(
            opt_id=opt_id,
            target_agent=target_agent,
            base_prompt=base_prompt,
            optimized_prompt=optimized_prompt,
            strategy=strategy,
            baseline_score=baseline_score,
            new_score=new_score,
            score_improvement=score_improvement,
            iteration=iteration,
        )

        agent_history.append(result)
        self.history[target_agent] = agent_history
        return result

    def get_history(self, target_agent: str) -> List[PromptOptimizationResult]:
        return self.history.get(target_agent, [])
