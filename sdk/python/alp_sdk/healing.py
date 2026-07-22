"""ALP Self-Healing Workflows (v16.1.0 — V12 The Sentinel Era).

Provides:
- HealingStrategy: enum of recovery strategies (retry, skip, rollback, escalate).
- CircuitBreaker: prevents cascading retries on repeated failures.
- HealingEngine: monitors workflow/task failures and selects/applies recovery.
- HealingReport: structured record of all recovery actions taken.

Mirrors the planned ``parser/src/healing.ts`` surface; tests live in
``sdk/python/tests/test_healing.py``.
"""
from __future__ import annotations


import json
import os
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional


HEALING_DIR = ".healing"
HEALING_FILE = "healing.jsonl"


class HealingStrategy(str, Enum):
    RETRY = "retry"
    SKIP = "skip"
    ROLLBACK = "rollback"
    ESCALATE = "escalate"


@dataclass
class HealingContext:
    task_id: str
    workflow_id: Optional[str]
    attempt: int
    error: str
    timestamp: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class HealingAction:
    strategy: str
    task_id: str
    workflow_id: Optional[str]
    attempt: int
    reason: str
    succeeded: bool
    timestamp: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "strategy": self.strategy,
            "task_id": self.task_id,
            "workflow_id": self.workflow_id,
            "attempt": self.attempt,
            "reason": self.reason,
            "succeeded": self.succeeded,
            "timestamp": self.timestamp or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "metadata": self.metadata,
        }


@dataclass
class HealingReport:
    workflow_id: str
    actions: List[HealingAction] = field(default_factory=list)
    started_at: str = ""
    finished_at: str = ""

    def __post_init__(self):
        if not self.started_at:
            self.started_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    def add_action(self, action: HealingAction) -> None:
        self.actions.append(action)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "workflow_id": self.workflow_id,
            "started_at": self.started_at,
            "finished_at": self.finished_at or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "actions": [a.to_dict() for a in self.actions],
            "total_actions": len(self.actions),
            "succeeded": sum(1 for a in self.actions if a.succeeded),
            "failed": sum(1 for a in self.actions if not a.succeeded),
        }

    def summary(self) -> str:
        d = self.to_dict()
        return (
            f"HealingReport(workflow={d['workflow_id']}, "
            f"actions={d['total_actions']}, "
            f"succeeded={d['succeeded']}, failed={d['failed']})"
        )


class CircuitBreaker:
    """Prevent cascading retries when a task is consistently failing."""

    def __init__(self, failure_threshold: int = 3, recovery_timeout: float = 60.0):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self._failures: Dict[str, int] = {}
        self._last_failure_ts: Dict[str, float] = {}

    def record_failure(self, task_id: str) -> None:
        self._failures[task_id] = self._failures.get(task_id, 0) + 1
        self._last_failure_ts[task_id] = time.time()

    def record_success(self, task_id: str) -> None:
        self._failures.pop(task_id, None)
        self._last_failure_ts.pop(task_id, None)

    def is_open(self, task_id: str) -> bool:
        failures = self._failures.get(task_id, 0)
        if failures < self.failure_threshold:
            return False
        last_ts = self._last_failure_ts.get(task_id, 0)
        if time.time() - last_ts > self.recovery_timeout:
            self._failures.pop(task_id, None)
            self._last_failure_ts.pop(task_id, None)
            return False
        return True

    def reset(self, task_id: str) -> None:
        self._failures.pop(task_id, None)
        self._last_failure_ts.pop(task_id, None)


class HealingEngine:
    """Monitors workflow/task failures and applies automatic recovery.

    Usage::

        engine = HealingEngine(alp_dir="/path/to/.alp")
        report = engine.heal(
            task_id="task-1",
            error="Connection refused",
            attempt=1,
            executor=lambda ctx: do_work(ctx),
        )
    """

    def __init__(
        self,
        alp_dir: str,
        version: str = "16.1.0",
        circuit_breaker: Optional[CircuitBreaker] = None,
        max_attempts: int = 3,
        default_strategy: HealingStrategy = HealingStrategy.RETRY,
    ):
        self.alp_dir = alp_dir
        self.version = version
        self.circuit_breaker = circuit_breaker or CircuitBreaker()
        self.max_attempts = max_attempts
        self.default_strategy = default_strategy
        self._reports: Dict[str, HealingReport] = {}

    def _healing_path(self) -> str:
        d = os.path.join(self.alp_dir, HEALING_DIR)
        if not os.path.exists(d):
            os.makedirs(d, exist_ok=True)
        return os.path.join(d, HEALING_FILE)

    def _append_action(self, action: HealingAction) -> None:
        with open(self._healing_path(), "a", encoding="utf-8") as f:
            f.write(json.dumps(action.to_dict()) + "\n")

    def _select_strategy(self, ctx: HealingContext) -> HealingStrategy:
        if self.circuit_breaker.is_open(ctx.task_id):
            return HealingStrategy.ESCALATE
        if ctx.attempt >= self.max_attempts:
            return HealingStrategy.ESCALATE
        if "cannot retry" in ctx.error.lower():
            return HealingStrategy.SKIP
        if "checkpoint" in ctx.metadata and ctx.attempt > 1:
            return HealingStrategy.ROLLBACK
        return self.default_strategy

    def heal(
        self,
        task_id: str,
        error: str,
        attempt: int,
        executor: Callable[[HealingContext], Any],
        workflow_id: Optional[str] = None,
        context: Optional[Dict[str, Any]] = None,
    ) -> HealingReport:
        """Attempt to recover from a failure.

        ``executor`` is called with a :class:`HealingContext` when the chosen
        strategy requires action. Returns the :class:`HealingReport` for the workflow.
        """
        wf_id = workflow_id or "_global"
        if wf_id not in self._reports:
            self._reports[wf_id] = HealingReport(workflow_id=wf_id)
        report = self._reports[wf_id]

        ctx = HealingContext(
            task_id=task_id,
            workflow_id=workflow_id,
            attempt=attempt,
            error=error,
            metadata=context or {},
        )
        strategy = self._select_strategy(ctx)
        succeeded = False
        reason = ""

        if strategy == HealingStrategy.RETRY:
            try:
                executor(ctx)
                succeeded = True
                reason = "Retry succeeded"
                self.circuit_breaker.record_success(task_id)
            except Exception as exc:  # noqa: BLE001
                succeeded = False
                reason = f"Retry failed: {exc}"
                self.circuit_breaker.record_failure(task_id)

        elif strategy == HealingStrategy.SKIP:
            reason = "Skipped with justification: non-retryable error"
            succeeded = True

        elif strategy == HealingStrategy.ROLLBACK:
            try:
                executor(ctx)
                succeeded = True
                reason = "Rollback and re-execute succeeded"
                self.circuit_breaker.record_success(task_id)
            except Exception as exc:  # noqa: BLE001
                succeeded = False
                reason = f"Rollback failed: {exc}"
                self.circuit_breaker.record_failure(task_id)

        elif strategy == HealingStrategy.ESCALATE:
            reason = "Escalated to human-in-the-loop: circuit breaker open or max attempts reached"
            succeeded = False
            self.circuit_breaker.record_failure(task_id)

        action = HealingAction(
            strategy=strategy.value,
            task_id=task_id,
            workflow_id=workflow_id,
            attempt=attempt,
            reason=reason,
            succeeded=succeeded,
            metadata={"error": error},
        )
        report.add_action(action)
        self._append_action(action)
        return report

    def get_report(self, workflow_id: str) -> Optional[HealingReport]:
        return self._reports.get(workflow_id)

    def read_past_actions(self, workflow_id: Optional[str] = None) -> List[Dict[str, Any]]:
        path = self._healing_path()
        if not os.path.exists(path):
            return []
        actions: List[Dict[str, Any]] = []
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    parsed = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if workflow_id is None or parsed.get("workflow_id") == workflow_id:
                    actions.append(parsed)
        return actions
