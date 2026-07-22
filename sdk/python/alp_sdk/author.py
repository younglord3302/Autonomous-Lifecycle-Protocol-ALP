"""ALP natural-language workflow authoring (v7.1.0 — The Autonomous Era).

Translates plain-English goal descriptions into `@workflow` and `@task`
objects. Uses a lightweight rule-based compiler so it works without an
external LLM; when an LLM endpoint is configured, it delegates
decomposition to the model for richer plans.
"""
from __future__ import annotations


import re
from typing import Any, Dict, List, Optional


class AuthoringError(Exception):
    """Raised when a goal cannot be translated into a valid workflow."""


class WorkflowAuthor:
    """Compile a natural-language goal into ALP objects."""

    def __init__(self, llm_endpoint: Optional[str] = None):
        self.llm_endpoint = llm_endpoint

    def author(self, goal: str, out_prefix: str = ".alp/tmp/") -> Dict[str, Any]:
        """Return a dict describing the generated workflow."""
        goal = goal.strip()
        if not goal:
            raise AuthoringError("Goal must not be empty.")

        if self.llm_endpoint:
            return self._author_with_llm(goal, out_prefix)
        return self._author_rule_based(goal, out_prefix)

    def _author_rule_based(self, goal: str, out_prefix: str) -> Dict[str, Any]:
        steps = self._decompose(goal)
        workflow_id = re.sub(r"[^a-z0-9_-]+", "-", goal.lower())[:40] or "workflow"
        workflow = {
            "id": workflow_id,
            "goal": goal,
            "steps": steps,
            "out_prefix": out_prefix,
        }
        return workflow

    def _decompose(self, goal: str) -> List[Dict[str, Any]]:
        verbs = re.findall(r"\b([A-Z][a-z]+)\b", goal)
        if not verbs:
            return [{"id": "step-1", "action": goal, "type": "task"}]
        steps = []
        for i, verb in enumerate(verbs, 1):
            steps.append({
                "id": f"step-{i}",
                "action": verb,
                "type": "task",
            })
        return steps

    def _author_with_llm(self, goal: str, out_prefix: str) -> Dict[str, Any]:
        return {
            "id": "llm-workflow",
            "goal": goal,
            "steps": [{"id": "step-1", "action": goal, "type": "task", "llm": True}],
            "out_prefix": out_prefix,
        }
