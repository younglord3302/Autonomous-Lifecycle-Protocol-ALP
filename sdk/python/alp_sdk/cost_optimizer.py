"""ALP Cost Optimization (v16.4.0 — V12 The Sentinel Era).

Extends ``observ.py`` ``CostAnalyzer`` with workflow-level optimization:

* ``CostEstimator``    — predicts execution cost before a workflow runs.
* ``CostOptimizer``    — analyzes a workflow graph and emits an
  ``OptimizationPlan`` with cheaper execution paths (parallelization,
  caching, agent reassignment).
* ``AutoScaleRecommendation`` — throughput-based scaling advice.

Mirrors the planned ``parser/src/cost-optimizer.ts`` surface; tests live
in ``sdk/python/tests/test_cost_optimizer.py``.
"""

import math
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple


@dataclass
class OptimizationSuggestion:
    kind: str
    description: str
    estimated_savings: float
    confidence: float
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "kind": self.kind,
            "description": self.description,
            "estimated_savings": self.estimated_savings,
            "confidence": self.confidence,
            "metadata": self.metadata,
        }


@dataclass
class OptimizationPlan:
    workflow_id: str
    current_estimated_cost: float
    optimized_estimated_cost: float
    suggestions: List[OptimizationSuggestion] = field(default_factory=list)
    generated_at: str = ""

    def __post_init__(self):
        if not self.generated_at:
            from datetime import datetime, timezone
            self.generated_at = datetime.now(timezone.utc).isoformat()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "workflow_id": self.workflow_id,
            "current_estimated_cost": self.current_estimated_cost,
            "optimized_estimated_cost": self.optimized_estimated_cost,
            "savings": self.current_estimated_cost - self.optimized_estimated_cost,
            "savings_percent": _percent(self.current_estimated_cost, self.optimized_estimated_cost),
            "suggestions": [s.to_dict() for s in self.suggestions],
            "generated_at": self.generated_at,
        }

    def summary(self) -> str:
        d = self.to_dict()
        return (
            f"OptimizationPlan(workflow={d['workflow_id']}, "
            f"current={d['current_estimated_cost']:.4f}, "
            f"optimized={d['optimized_estimated_cost']:.4f}, "
            f"savings={d['savings']:.4f} ({d['savings_percent']:.1f}%))"
        )


@dataclass
class AutoScaleRecommendation:
    metric: str
    current_value: float
    recommended_value: float
    reason: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "metric": self.metric,
            "current_value": self.current_value,
            "recommended_value": self.recommended_value,
            "reason": self.reason,
        }


class CostEstimator:
    """Predict execution cost for a workflow before it runs.

    Uses historical metering data plus per-step cost heuristics to
    produce a pre-flight estimate.
    """

    def __init__(self, metering_log: Any, token_cost: float = 0.000002, operation_cost: float = 0.001):
        self.metering_log = metering_log
        self.token_cost = token_cost
        self.operation_cost = operation_cost

    def estimate_workflow(self, workflow: Dict[str, Any]) -> Dict[str, Any]:
        steps = workflow.get("steps", [])
        total_tokens = 0
        total_operations = 0
        step_estimates: List[Dict[str, Any]] = []

        for step in steps:
            name = str(step.get("name", step.get("id", "<unnamed>")))
            estimated_tokens = int(step.get("estimated_tokens", 1000))
            estimated_ops = int(step.get("estimated_operations", 10))
            total_tokens += estimated_tokens
            total_operations += estimated_ops
            step_estimates.append({
                "name": name,
                "tokens": estimated_tokens,
                "operations": estimated_ops,
                "cost": round(estimated_tokens * self.token_cost + estimated_ops * self.operation_cost, 6),
            })

        total_cost = round(total_tokens * self.token_cost + total_operations * self.operation_cost, 6)
        return {
            "workflow_id": workflow.get("id", workflow.get("name", "_unknown")),
            "total_tokens": total_tokens,
            "total_operations": total_operations,
            "estimated_cost": total_cost,
            "step_estimates": step_estimates,
        }

    def estimate_task(self, task_id: str, default_tokens: int = 1000, default_ops: int = 10) -> Dict[str, Any]:
        historical = {}
        if hasattr(self.metering_log, "cost_estimate"):
            historical = self.metering_log.cost_estimate(task_id) or {}
        tokens = historical.get("tokens", default_tokens) if historical else default_tokens
        operations = historical.get("operations", default_ops) if historical else default_ops
        cost = round(tokens * self.token_cost + operations * self.operation_cost, 6)
        return {
            "task_id": task_id,
            "tokens": tokens,
            "operations": operations,
            "estimated_cost": cost,
        }


class CostOptimizer:
    """Analyze a workflow graph and suggest cheaper execution paths."""

    def __init__(
        self,
        metering_log: Any,
        cost_estimator: Optional[CostEstimator] = None,
        agent_costs: Optional[Dict[str, float]] = None,
    ):
        self.metering_log = metering_log
        self.cost_estimator = cost_estimator or CostEstimator(metering_log)
        self.agent_costs = agent_costs or {}

    def optimize(self, workflow: Dict[str, Any]) -> OptimizationPlan:
        pre = self.cost_estimator.estimate_workflow(workflow)
        current_cost = float(pre["estimated_cost"])
        suggestions = self._suggest(workflow, pre)
        optimized_cost = self._apply_savings(current_cost, suggestions)
        return OptimizationPlan(
            workflow_id=pre["workflow_id"],
            current_estimated_cost=current_cost,
            optimized_estimated_cost=optimized_cost,
            suggestions=suggestions,
        )

    def _suggest(self, workflow: Dict[str, Any], pre: Dict[str, Any]) -> List[OptimizationSuggestion]:
        suggestions: List[OptimizationSuggestion] = []
        steps = workflow.get("steps", [])

        parallel_groups = self._find_parallel_groups(steps)
        if parallel_groups:
            savings = self._parallelization_savings(parallel_groups, pre)
            if savings > 0:
                suggestions.append(OptimizationSuggestion(
                    kind="parallelization",
                    description=f"Parallelize {len(parallel_groups)} independent step groups",
                    estimated_savings=savings,
                    confidence=0.8,
                    metadata={"groups": parallel_groups},
                ))

        cacheable = self._find_cacheable_steps(steps)
        if cacheable:
            savings = sum(
                (s.get("tokens", 0) * self.cost_estimator.token_cost + s.get("operations", 0) * self.cost_estimator.operation_cost)
                for s in pre["step_estimates"]
                if s["name"] in cacheable
            )
            suggestions.append(OptimizationSuggestion(
                kind="caching",
                description=f"Cache results for {len(cacheable)} deterministic steps",
                estimated_savings=round(savings, 6),
                confidence=0.6,
                metadata={"steps": list(cacheable)},
            ))

        reassignments = self._suggest_agent_reassignments(steps)
        for target, cheaper in reassignments.items():
            step_idx = next((i for i, s in enumerate(steps) if s.get("name") == target), None)
            if step_idx is None:
                continue
            step_cost = pre["step_estimates"][step_idx]["cost"]
            current_agent_cost = self.agent_costs.get(target, float("inf"))
            cheaper_agent_cost = self.agent_costs.get(cheaper, float("inf"))
            if cheaper_agent_cost < current_agent_cost:
                saved = round(min(step_cost, current_agent_cost - cheaper_agent_cost), 6)
                if saved > 0:
                    suggestions.append(OptimizationSuggestion(
                        kind="agent_reassignment",
                        description=f"Reassign '{target}' from '{target}' to '{cheaper}'",
                        estimated_savings=saved,
                        confidence=0.5,
                        metadata={"step": target, "from_agent": target, "to_agent": cheaper},
                    ))

        return suggestions

    def _find_parallel_groups(self, steps: List[Dict[str, Any]]) -> List[List[str]]:
        groups: List[List[str]] = []
        independent: List[str] = []
        for step in steps:
            deps = step.get("depends_on") or step.get("dependencies") or []
            if not deps:
                independent.append(str(step.get("name", step.get("id", ""))))
        if len(independent) > 1:
            groups.append(independent)
        return groups

    def _find_cacheable_steps(self, steps: List[Dict[str, Any]]) -> Set[str]:
        cacheable = set()
        for step in steps:
            if step.get("cache") or step.get("deterministic"):
                cacheable.add(str(step.get("name", step.get("id", ""))))
        return cacheable

    def _suggest_agent_reassignments(self, steps: List[Dict[str, Any]]) -> Dict[str, str]:
        reassignments: Dict[str, str] = {}
        for step in steps:
            agent = step.get("agent") or step.get("owner")
            if not agent:
                continue
            name = str(step.get("name", step.get("id", "")))
            current_cost = self.agent_costs.get(agent, float("inf"))
            for candidate, cost in self.agent_costs.items():
                if candidate != agent and cost < current_cost:
                    reassignments[name] = candidate
                    break
        return reassignments

    def _apply_savings(self, current: float, suggestions: List[OptimizationSuggestion]) -> float:
        savings = sum(s.estimated_savings for s in suggestions)
        return max(0.0, round(current - savings, 6))

    def _parallelization_savings(self, groups: List[List[str]], pre: Dict[str, Any]) -> float:
        step_map = {s["name"]: s for s in pre.get("step_estimates", [])}
        saved = 0.0
        for group in groups:
            costs = [step_map.get(name, {}).get("cost", 0.0) for name in group]
            if len(costs) > 1:
                saved += min(costs)
        return round(saved, 6)

    def recommend_auto_scale(self, workflow_id: str, recent_runs: List[Dict[str, Any]]) -> List[AutoScaleRecommendation]:
        if not recent_runs:
            return [AutoScaleRecommendation(
                metric="concurrency",
                current_value=1.0,
                recommended_value=2.0,
                reason="No recent runs; recommend conservative scale-up",
            )]

        durations = [float(r.get("duration_ms", 0)) for r in recent_runs if r.get("duration_ms")]
        throughputs = []
        for r in recent_runs:
            d = float(r.get("duration_ms", 0))
            tasks = float(r.get("tasks_completed", 1))
            throughputs.append(tasks / max(d / 1000.0, 0.001))
        avg_throughput = sum(throughputs) / len(throughputs) if throughputs else 0.0
        current_concurrency = float(recent_runs[-1].get("concurrency", 1))
        recommended = max(1, int(avg_throughput / 10)) if avg_throughput > 0 else current_concurrency

        return [
            AutoScaleRecommendation(
                metric="concurrency",
                current_value=current_concurrency,
                recommended_value=float(recommended),
                reason=f"Historical avg throughput: {avg_throughput:.2f} tasks/sec",
            )
        ]


def _percent(current: float, optimized: float) -> float:
    if current <= 0:
        return 0.0
    return round((current - optimized) / current * 100, 2)
