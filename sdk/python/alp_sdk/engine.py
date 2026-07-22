"""ALP Unified Execution Engine (v7.0.0 — spec/05, Python SDK parity).

Implements the four ALP engines as behavioral specifications:

* ``LoopEngine``    — iterative improvement cycle (mirrors TS ``parser/loop.ts``)
* ``WorkflowEngine``— sequential/conditional/parallel step orchestration
* ``ContextEngine`` — task-scoped context resolution (8-step algorithm)
* ``VerificationEngine`` — quality-gate enforcement, policy-guarded

None of these execute code themselves; they manage state transitions,
evaluate ALPEL conditions, and emit structured results/events. The actual
work is performed by the agent or tooling that consumes ALP.
"""
from __future__ import annotations


import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from .alpel import build_context, evaluate_bool
from .error import AlpError


# ── Shared types ────────────────────────────────────────────────────────────

LOOP_STAGES = [
    "understand",
    "plan",
    "implement",
    "test",
    "review",
    "reflect",
    "improve",
]


class EngineError(AlpError):
    """Raised for execution-engine configuration or runtime errors."""


# ── Loop Engine ─────────────────────────────────────────────────────────────

@dataclass
class LoopConfig:
    max_iterations: int = 10
    completion_conditions: List[str] = field(default_factory=list)
    failure_conditions: List[str] = field(default_factory=list)
    checkpoint_per_iteration: bool = True
    rollback_strategy: Optional[str] = None


@dataclass
class LoopCheckpoint:
    iteration: int
    stage: str
    timestamp: str
    data: Dict[str, Any] = field(default_factory=dict)


@dataclass
class LoopEvent:
    type: str  # iteration_start | iteration_end | stage_enter | stage_exit |
              # checkpoint | completed | failed | rolled_back
    iteration: int
    stage: Optional[str] = None
    timestamp: str = ""
    data: Optional[Any] = None


LoopEventHandler = Callable[[LoopEvent], None]


class LoopEngine:
    """Iterative improvement cycle (spec/05 §2).

    Mirrors the TypeScript ``@alp/parser`` ``LoopEngine``: drives the seven
    loop stages, emits events, checkpoints each iteration, and terminates on
    completion / max-iterations / failure.
    """

    def __init__(self, config: Optional[LoopConfig] = None):
        self.config = config or LoopConfig()
        self.status = "idle"
        self.current_iteration = 0
        self.current_stage = "understand"
        self.checkpoints: List[LoopCheckpoint] = []
        self._listeners: List[LoopEventHandler] = []

    def on(self, handler: LoopEventHandler) -> None:
        self._listeners.append(handler)

    def _emit(self, event: LoopEvent) -> None:
        if not event.timestamp:
            event.timestamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        for handler in self._listeners:
            handler(event)

    def run(
        self,
        execute_stage: Callable[[str, int], bool],
        context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Run the loop.

        ``execute_stage(stage, iteration)`` performs the work for one stage and
        returns ``True`` when ALL completion conditions are satisfied (ending
        the loop successfully).
        """
        ctx = context or {}
        self.status = "running"
        self.current_iteration = 0

        while self.current_iteration < self.config.max_iterations:
            self.current_iteration += 1
            self._emit(LoopEvent("iteration_start", self.current_iteration))

            completed = False
            for stage in LOOP_STAGES:
                self.current_stage = stage
                self._emit(LoopEvent("stage_enter", self.current_iteration, stage))

                try:
                    completed = bool(execute_stage(stage, self.current_iteration))
                except Exception as err:  # noqa: BLE001 - surface to caller via event
                    self.status = "failed"
                    self._emit(
                        LoopEvent(
                            "failed",
                            self.current_iteration,
                            stage,
                            data={"error": str(err)},
                        )
                    )
                    if self.config.rollback_strategy and self.checkpoints:
                        self.status = "rolled_back"
                        self._emit(
                            LoopEvent(
                                "rolled_back",
                                self.current_iteration,
                                stage,
                                data={"strategy": self.config.rollback_strategy},
                            )
                        )
                    return {"status": self.status, "iterations": self.current_iteration}

                self._emit(LoopEvent("stage_exit", self.current_iteration, stage))
                if completed:
                    break

            if self.config.checkpoint_per_iteration:
                chk = LoopCheckpoint(
                    iteration=self.current_iteration,
                    stage=self.current_stage,
                    timestamp=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    data={},
                )
                self.checkpoints.append(chk)
                self._emit(LoopEvent("checkpoint", self.current_iteration, data=chk))

            self._emit(LoopEvent("iteration_end", self.current_iteration))

            if completed:
                self.status = "completed"
                self._emit(LoopEvent("completed", self.current_iteration))
                return {"status": self.status, "iterations": self.current_iteration}

        self.status = "failed"
        self._emit(
            LoopEvent(
                "failed",
                self.current_iteration,
                data={"reason": "Max iterations reached"},
            )
        )
        return {"status": self.status, "iterations": self.current_iteration}

    def get_last_checkpoint(self) -> Optional[LoopCheckpoint]:
        return self.checkpoints[-1] if self.checkpoints else None

    def get_state(self) -> Dict[str, Any]:
        return {
            "status": self.status,
            "iteration": self.current_iteration,
            "stage": self.current_stage,
            "checkpoints": len(self.checkpoints),
        }


# ── Workflow Engine ─────────────────────────────────────────────────────────

FAILURE_STRATEGIES = ["stop", "skip", "rollback", "retry"]
BACKOFF_TYPES = ["fixed", "linear", "exponential"]


@dataclass
class RetryStrategy:
    max_retries: int = 3
    delay: float = 30.0  # seconds
    backoff: str = "exponential"
    max_delay: float = 300.0

    def delay_for(self, attempt: int) -> float:
        """Delay before retry ``attempt`` (1-based)."""
        if self.backoff == "fixed":
            d = self.delay
        elif self.backoff == "linear":
            d = self.delay * attempt
        elif self.backoff == "exponential":
            d = self.delay * (2 ** (attempt - 1))
        else:
            d = self.delay
        return min(d, self.max_delay)


@dataclass
class StepResult:
    name: str
    status: str  # success | failed | skipped
    retries: int = 0
    error: Optional[str] = None


class WorkflowEngine:
    """Sequential/conditional step orchestration (spec/05 §3)."""

    def __init__(
        self,
        failure_strategy: str = "stop",
        retry: Optional[RetryStrategy] = None,
    ):
        if failure_strategy not in FAILURE_STRATEGIES:
            raise EngineError(
                f"Unknown failure strategy '{failure_strategy}'. "
                f"Expected one of {FAILURE_STRATEGIES}."
            )
        self.failure_strategy = failure_strategy
        self.retry = retry or RetryStrategy()

    def execute(
        self,
        steps: List[Dict[str, Any]],
        context: Optional[Dict[str, Any]] = None,
        executor: Optional[Callable[[Dict[str, Any]], None]] = None,
    ) -> List[StepResult]:
        """Run ``steps`` in order.

        ``executor(step)`` performs the step's work and raises on failure.
        ``step['condition']`` (ALPEL) skips the step when false. Returns a
        ``StepResult`` per step.
        """
        ctx = context or {}
        results: List[StepResult] = []

        for step in steps:
            name = str(step.get("name", step.get("id", "<unnamed>")))

            condition = step.get("condition")
            if condition is not None and not evaluate_bool(str(condition), _ctx(ctx, step)):
                results.append(StepResult(name, "skipped"))
                continue

            attempt = 0
            while True:
                try:
                    if executor:
                        executor(step)
                    results.append(StepResult(name, "success", retries=attempt))
                    break
                except Exception as err:  # noqa: BLE001
                    attempt += 1
                    if self.failure_strategy == "retry" and attempt <= self.retry.max_retries:
                        time.sleep(self.retry.delay_for(attempt) / 1000.0)
                        continue
                    results.append(StepResult(name, "failed", retries=attempt - 1, error=str(err)))
                    if self.failure_strategy == "stop":
                        return results
                    if self.failure_strategy == "rollback":
                        # Caller is responsible for reverting; we halt and fail.
                        return results
                    # "skip": continue to the next step.
                    break

        return results


# ── Context Engine ──────────────────────────────────────────────────────────

CONTEXT_SCOPES = ["minimal", "normal", "full"]


class ContextEngine:
    """Task-scoped context resolution (spec/05 §4).

    Implements the 8-step ``resolve_context`` algorithm. Resolution is driven
    by injected resolvers so the engine stays free of I/O; the host supplies
    functions that traverse the dependency graph, memory, rules, and decisions.
    """

    def __init__(self, scope: str = "normal"):
        if scope not in CONTEXT_SCOPES:
            raise EngineError(
                f"Unknown context scope '{scope}'. Expected one of {CONTEXT_SCOPES}."
            )
        self.scope = scope

    def resolve(
        self,
        task: Dict[str, Any],
        resolvers: Optional[Dict[str, Callable[[Dict[str, Any]], Any]]] = None,
    ) -> Dict[str, Any]:
        r = resolvers or {}
        context: Dict[str, Any] = {}

        # Step 1: Direct task context.
        context["task"] = task
        if "accept" in task:
            context["accept"] = task["accept"]
        if "verify" in task:
            context["verify"] = task["verify"]

        # Step 2: Feature context.
        if "feature" in task and callable(r.get("feature")):
            context["feature"] = r["feature"](task)

        # Step 3: Dependencies.
        if "depends_on" in task and callable(r.get("dependencies")):
            context["dependencies"] = r["dependencies"](task)

        # Step 4: Agent context.
        if "owner" in task and callable(r.get("agent")):
            context["agent"] = r["agent"](task)

        # Step 5: Relevant memory.
        if callable(r.get("memory")):
            context["memory"] = r["memory"](task)

        # Scope gating: minimal stops after dependencies/agent.
        if self.scope == "minimal":
            if "explicit" in task and callable(r.get("explicit")):
                explicit = r["explicit"](task)
                if isinstance(explicit, dict):
                    context.update(explicit)
            return context

        # Step 6: Relevant rules.
        if callable(r.get("rules")):
            context["rules"] = r["rules"](task)

        # Step 7: Relevant decisions.
        if callable(r.get("decisions")):
            context["decisions"] = r["decisions"](task)

        # Step 8: Explicit @context object merge.
        if "explicit" in task and callable(r.get("explicit")):
            explicit = r["explicit"](task)
            if isinstance(explicit, dict):
                context.update(explicit)

        return context


# ── Verification Engine ─────────────────────────────────────────────────────

@dataclass
class VerificationResult:
    type: str
    passed: bool
    required: bool
    note: Optional[str] = None
    output: Optional[str] = None
    duration: Optional[float] = None


@dataclass
class VerificationReport:
    passed: bool
    results: List[VerificationResult]
    required_passed: int = 0
    required_total: int = 0
    timestamp: str = ""

    def summary(self) -> str:
        rp = f"{self.required_passed}/{self.required_total}"
        overall = "PASS" if self.passed else "FAIL"
        return f"Required: {rp} passed | Overall: {overall}"


class VerificationEngine:
    """Quality-gate enforcement (spec/05 §5).

    ``gates`` is a list of verification entries, each either a command string
    or a dict with ``command``/``check``/``type``/``required``. ``required``
    defaults to ``True``. Commands are policy-guarded via an optional
    ``PolicyEngine`` (deny-beats-allow). ``check`` entries are evaluated by the
    provided ``agent_evaluate`` callback.
    """

    def __init__(self, policy_engine: Optional[Any] = None):
        self.policy = policy_engine

    def verify(
        self,
        gates: List[Any],
        agent: Optional[str] = None,
        runner: Optional[Callable[[str], "subprocess.CompletedProcess"]] = None,
        agent_evaluate: Optional[Callable[[str], bool]] = None,
    ) -> VerificationReport:
        results: List[VerificationResult] = []
        req_total = 0
        req_passed = 0

        for i, gate in enumerate(gates):
            entry = self._normalize(gate)
            required = entry["required"]
            if required:
                req_total += 1

            if entry["command"] is not None:
                cmd = entry["command"]
                # Policy governance: verify commands run shell code.
                if self.policy is not None and hasattr(self.policy, "evaluate"):
                    decision = self.policy.evaluate(
                        {"kind": "command", "value": str(cmd), "agent": agent}
                    )
                    allowed = getattr(decision, "allowed", True)
                    blocked = getattr(decision, "blocked", False)
                    reasons = getattr(decision, "reasons", []) or []
                    if not allowed:
                        if blocked:
                            results.append(
                                VerificationResult(
                                    entry["type"], False, required,
                                    note="Blocked by policy: " + "; ".join(reasons),
                                )
                            )
                            continue
                        # warn-only: fall through and execute

                passed = False
                output = None
                try:
                    if runner is not None:
                        proc = runner(cmd)
                        passed = getattr(proc, "returncode", 0) == 0
                        output = getattr(proc, "stdout", "") or ""
                    elif agent_evaluate is not None:
                        passed = bool(agent_evaluate(cmd))
                    else:
                        # No runner supplied: cannot execute; treat as pending
                        # failure so required gates are not silently passed.
                        passed = False
                        output = "no runner supplied"
                except Exception as err:  # noqa: BLE001
                    passed = False
                    output = str(err)

                results.append(
                    VerificationResult(entry["type"], passed, required, output=output)
                )
                if required and passed:
                    req_passed += 1

            elif entry["check"] is not None:
                passed = bool(agent_evaluate(entry["check"])) if agent_evaluate else False
                results.append(
                    VerificationResult(entry["type"], passed, required, note=entry["check"])
                )
                if required and passed:
                    req_passed += 1
            else:
                results.append(
                    VerificationResult(entry["type"], False, required, note="empty gate")
                )

        passed = req_passed == req_total and req_total > 0
        return VerificationReport(
            passed=passed,
            results=results,
            required_passed=req_passed,
            required_total=req_total,
            timestamp=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        )

    @staticmethod
    def _normalize(gate: Any) -> Dict[str, Any]:
        if isinstance(gate, str):
            return {"command": gate, "check": None, "type": "custom", "required": True}
        if isinstance(gate, dict):
            cmd = gate.get("command")
            chk = gate.get("check")
            if cmd is None and chk is None:
                raise EngineError(f"Verification gate must have 'command' or 'check': {gate}")
            return {
                "command": cmd,
                "check": chk,
                "type": gate.get("type", "custom"),
                "required": gate.get("required", True),
            }
        raise EngineError(f"Invalid verification gate: {gate!r}")


# ── Helpers ─────────────────────────────────────────────────────────────────

def _ctx(base: Dict[str, Any], obj: Dict[str, Any]) -> Dict[str, Any]:
    """Build an ALPEL evaluation context for a workflow step.

    Exposes the step's own scalar properties as bare identifiers (mirrors the
    reader's directive context), plus the surrounding workflow context.
    """
    merged = dict(base)
    for k, v in obj.items():
        if isinstance(v, (str, int, float, bool)) and k not in merged:
            merged[k] = v
    return build_context(obj, merged)
