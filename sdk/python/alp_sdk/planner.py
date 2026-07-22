"""ALP planning & reasoning (v8.0.0 — The Cognitive Era).

Provides:
- GoalDecomposer: breaks a high-level goal into a task/workflow DAG.
- Planner: scores and ranks candidate plans using historical baselines.
- Reflector: post-run self-critique that emits reusable lessons.
"""
from __future__ import annotations


import re
from typing import Any, Dict, List, Optional


class PlanNode:
    """A single step in a decomposed plan."""

    def __init__(self, node_id: str, kind: str, label: str, depends_on: Optional[List[str]] = None):
        self.node_id = node_id
        self.kind = kind
        self.label = label
        self.depends_on = depends_on or []

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.node_id,
            "kind": self.kind,
            "label": self.label,
            "depends_on": self.depends_on,
        }


class Plan:
    """A decomposed execution plan (DAG of PlanNodes)."""

    def __init__(self, plan_id: str, goal: str, nodes: Optional[List[PlanNode]] = None, metadata: Optional[Dict[str, Any]] = None):
        self.plan_id = plan_id
        self.goal = goal
        self.nodes = nodes or []
        self.metadata = metadata or {}

    def add_node(self, node: PlanNode) -> None:
        self.nodes.append(node)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "plan_id": self.plan_id,
            "goal": self.goal,
            "nodes": [n.to_dict() for n in self.nodes],
            "metadata": self.metadata,
        }


class Lesson:
    """A post-run critique emitted by the Reflector."""

    def __init__(self, lesson_id: str, run_id: str, insight: str, severity: str = "info", tags: Optional[List[str]] = None):
        self.lesson_id = lesson_id
        self.run_id = run_id
        self.insight = insight
        self.severity = severity
        self.tags = tags or []

    def to_dict(self) -> Dict[str, Any]:
        return {
            "lesson_id": self.lesson_id,
            "run_id": self.run_id,
            "insight": self.insight,
            "severity": self.severity,
            "tags": self.tags,
        }


class GoalDecomposer:
    """Break a high-level goal into a DAG of tasks and workflows."""

    def decompose(self, goal: str, constraints: Optional[Dict[str, Any]] = None) -> Plan:
        goal = goal.strip()
        if not goal:
            raise ValueError("Goal must not be empty.")
        plan_id = re.sub(r"[^a-z0-9_-]+", "-", goal.lower())[:40] or "plan"
        steps = self._extract_steps(goal)
        nodes = []
        for i, step in enumerate(steps, 1):
            nodes.append(PlanNode(f"step-{i}", "task", step, depends_on=[f"step-{i-1}"] if i > 1 else []))
        return Plan(plan_id=plan_id, goal=goal, nodes=nodes, metadata={"constraints": constraints or {}})

    def _extract_steps(self, goal: str) -> List[str]:
        verbs = re.findall(r"\b([A-Z][a-z]+)\b", goal)
        if not verbs:
            return [goal]
        return verbs

    def to_workflow(self, plan: Plan) -> Dict[str, Any]:
        return plan.to_dict()


class Planner:
    """Score and rank candidate plans by estimated cost and risk."""

    def __init__(self, estimator: Optional[Any] = None):
        self.estimator = estimator

    def rank(self, plans: List[Plan]) -> List[Dict[str, Any]]:
        scored = []
        for plan in plans:
            score = self._score(plan)
            scored.append({
                "plan": plan.to_dict(),
                "score": score,
                "rank": 0,
            })
        scored.sort(key=lambda x: x["score"]["composite"], reverse=True)
        for i, entry in enumerate(scored, 1):
            entry["rank"] = i
        return scored

    def _score(self, plan: Plan) -> Dict[str, Any]:
        node_count = len(plan.nodes)
        depth = self._max_depth(plan)
        if self.estimator:
            try:
                pred = self.estimator.estimate(plan.plan_id)
                risk = pred.get("failure_risk") or 0.0
                confidence = pred.get("confidence", "low")
            except Exception:
                risk = 0.5
                confidence = "low"
        else:
            risk = 0.5
            confidence = "low"
        complexity = node_count * 0.1 + depth * 0.2
        composite = max(0.0, 1.0 - risk - complexity * 0.1)
        return {
            "node_count": node_count,
            "depth": depth,
            "risk": risk,
            "confidence": confidence,
            "complexity": round(complexity, 4),
            "composite": round(composite, 4),
        }

    def _max_depth(self, plan: Plan) -> int:
        if not plan.nodes:
            return 0
        depths = {n.node_id: 1 for n in plan.nodes}
        for n in plan.nodes:
            for dep in n.depends_on:
                if dep in depths:
                    depths[n.node_id] = max(depths[n.node_id], depths[dep] + 1)
        return max(depths.values())


class Reflector:
    """Post-run self-critique that emits reusable lessons."""

    def __init__(self, events: Optional[List[Dict[str, Any]]] = None):
        self.events = events or []

    def reflect(self, run_id: str) -> List[Lesson]:
        lessons = []
        lessons.extend(self._detect_failure_patterns(run_id))
        lessons.extend(self._detect_inefficiencies(run_id))
        lessons.extend(self._detect_handoff_patterns(run_id))
        return lessons

    def _detect_failure_patterns(self, run_id: str) -> List[Lesson]:
        lessons = []
        failures = [e for e in self.events if e.get("type") == "task_status" and e.get("status") == "[!]" and e.get("task_id")]
        if not failures:
            return lessons
        tasks = {}
        for e in failures:
            tid = e.get("task_id")
            tasks[tid] = tasks.get(tid, 0) + 1
        for tid, count in tasks.items():
            if count >= 2:
                lessons.append(Lesson(
                    lesson_id=f"lesson-{len(lessons)+1}",
                    run_id=run_id,
                    insight=f"Task '{tid}' failed {count} times; consider retry or fallback strategy.",
                    severity="warn",
                    tags=["failure", tid],
                ))
        return lessons

    def _detect_inefficiencies(self, run_id: str) -> List[Lesson]:
        lessons = []
        cycle_times: Dict[str, List[int]] = {}
        for e in self.events:
            if e.get("type") == "task_claim":
                tid = e.get("task_id")
                if tid:
                    cycle_times.setdefault(tid, []).append(e.get("timestamp"))
        for tid, stamps in cycle_times.items():
            if len(stamps) >= 3:
                lessons.append(Lesson(
                    lesson_id=f"lesson-{len(lessons)+1}",
                    run_id=run_id,
                    insight=f"Task '{tid}' was claimed {len(stamps)} times; review ownership logic.",
                    severity="info",
                    tags=["efficiency", tid],
                ))
        return lessons

    def _detect_handoff_patterns(self, run_id: str) -> List[Lesson]:
        lessons = []
        handoffs = [e for e in self.events if e.get("type") == "human_handoff" or e.get("status") == "[?]"]
        if len(handoffs) > 1:
            lessons.append(Lesson(
                lesson_id=f"lesson-{len(lessons)+1}",
                run_id=run_id,
                insight=f"Run had {len(handoffs)} human handoffs; consider automating or simplifying decision gates.",
                severity="warn",
                tags=["handoff"],
            ))
        return lessons
