from __future__ import annotations

from datetime import datetime, timezone
from typing import Dict, Any, Optional

class CostBudget:
    def __init__(
        self,
        budget_id: str,
        task_id: str,
        max_tokens: int,
        max_cost_usd: float,
        provider: str = "openai",
        model_tier: str = "standard",
        created_at: Optional[str] = None,
    ):
        self.id = budget_id
        self.task_id = task_id
        self.max_tokens = max_tokens
        self.max_cost_usd = max_cost_usd
        self.used_tokens = 0
        self.used_cost_usd = 0.0
        self.provider = provider
        self.model_tier = model_tier
        self.created_at = created_at or datetime.now(timezone.utc).isoformat()

class CostBudgetEngine:
    def __init__(self):
        self.budgets: Dict[str, CostBudget] = {}

    def create_budget(
        self,
        task_id: str,
        max_tokens: int,
        max_cost_usd: float,
        provider: str = "openai",
        model_tier: str = "standard",
    ) -> CostBudget:
        budget = CostBudget(
            budget_id=f"budget-{task_id}",
            task_id=task_id,
            max_tokens=max_tokens,
            max_cost_usd=max_cost_usd,
            provider=provider,
            model_tier=model_tier,
        )
        self.budgets[budget.id] = budget
        return budget

    def track_usage(
        self, budget_id: str, tokens_used: int, cost_usd: float
    ) -> Dict[str, Any]:
        budget = self.budgets.get(budget_id)
        if not budget:
            return {"remaining_cost_usd": 0.0, "remaining_tokens": 0, "is_exceeded": True}

        budget.used_tokens += tokens_used
        budget.used_cost_usd += cost_usd

        rem_cost = max(0.0, budget.max_cost_usd - budget.used_cost_usd)
        rem_tokens = max(0, budget.max_tokens - budget.used_tokens)
        is_exceeded = budget.used_cost_usd > budget.max_cost_usd or budget.used_tokens > budget.max_tokens

        return {
            "remaining_cost_usd": rem_cost,
            "remaining_tokens": rem_tokens,
            "is_exceeded": is_exceeded,
        }

    def select_optimal_model(
        self, task_complexity: str, max_cost_usd: float
    ) -> Dict[str, Any]:
        if task_complexity == "high" and max_cost_usd >= 0.10:
            return {"provider": "anthropic", "model": "claude-3-5-sonnet", "estimated_cost_per_1k": 0.003}
        elif task_complexity == "medium" or max_cost_usd >= 0.02:
            return {"provider": "openai", "model": "gpt-4o-mini", "estimated_cost_per_1k": 0.00015}
        else:
            return {"provider": "ollama", "model": "llama3.2-local", "estimated_cost_per_1k": 0.00}
