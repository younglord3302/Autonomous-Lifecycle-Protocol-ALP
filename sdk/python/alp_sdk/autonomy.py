"""ALP autonomy runtime (v11.0.0 — The Ambient Era).

Provides:
- WorkflowMutator: proposes and applies edits to a running @workflow.
- AutonomyController: runs long-lived swarms with safe self-modifying workflows.
- AdaptiveEngine: re-tunes execution from environment signals.
"""

import copy
import time
from typing import Any, Dict, List, Optional


class EditProposal:
    """A proposed edit to a running workflow."""

    def __init__(self, proposal_id: str, workflow_id: str, edits: List[Dict[str, Any]], rationale: str):
        self.proposal_id = proposal_id
        self.workflow_id = workflow_id
        self.edits = edits
        self.rationale = rationale
        self.status = "pending"
        self.created_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        self.reviewed_at: Optional[str] = None
        self.review_note: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "proposal_id": self.proposal_id,
            "workflow_id": self.workflow_id,
            "edits": self.edits,
            "rationale": self.rationale,
            "status": self.status,
            "created_at": self.created_at,
            "reviewed_at": self.reviewed_at,
            "review_note": self.review_note,
        }


class WorkflowMutator:
    """Propose and apply edits to a running @workflow."""

    def __init__(self, policy_engine: Optional[Any] = None):
        self.policy_engine = policy_engine
        self._proposals: Dict[str, EditProposal] = {}
        self._rollback_snapshots: Dict[str, Dict[str, Any]] = {}

    def propose_edit(self, workflow_id: str, edits: List[Dict[str, Any]], rationale: str) -> EditProposal:
        proposal_id = f"prop-{workflow_id}-{len(self._proposals) + 1}"
        proposal = EditProposal(proposal_id, workflow_id, edits, rationale)
        self._proposals[proposal_id] = proposal
        return proposal

    def approve(self, proposal_id: str, workflow: Dict[str, Any]) -> Dict[str, Any]:
        proposal = self._proposals.get(proposal_id)
        if not proposal:
            raise ValueError(f"Proposal {proposal_id} not found.")
        if self.policy_engine:
            try:
                self.policy_engine.evaluate_proposal(proposal_id, {"edits": proposal.edits})
            except Exception as exc:
                proposal.status = "denied"
                proposal.reviewed_at = _now_iso()
                proposal.review_note = str(exc)
                raise
        self._rollback_snapshots[proposal_id] = copy.deepcopy(workflow)
        updated = copy.deepcopy(workflow)
        for edit in proposal.edits:
            updated = self._apply_edit(updated, edit)
        proposal.status = "approved"
        proposal.reviewed_at = _now_iso()
        proposal.review_note = "approved"
        return updated

    def rollback(self, proposal_id: str) -> Optional[Dict[str, Any]]:
        snapshot = self._rollback_snapshots.pop(proposal_id, None)
        proposal = self._proposals.get(proposal_id)
        if proposal:
            proposal.status = "rolled_back"
            proposal.reviewed_at = _now_iso()
            proposal.review_note = "rolled back"
        return snapshot

    def _apply_edit(self, workflow: Dict[str, Any], edit: Dict[str, Any]) -> Dict[str, Any]:
        target = edit.get("target")
        op = edit.get("op", "update")
        value = edit.get("value")
        if op == "update" and target:
            parts = target.split(".")
            obj = workflow
            for p in parts[:-1]:
                obj = obj.setdefault(p, {})
            obj[parts[-1]] = value
        elif op == "add_step":
            steps = workflow.setdefault("steps", [])
            steps.append(value)
        elif op == "remove_step":
            steps = workflow.get("steps", [])
            workflow["steps"] = [s for s in steps if s.get("id") != target]
        return workflow


class AdaptiveEngine:
    """Re-tune execution from environment signals."""

    def __init__(self):
        self.signals: List[Dict[str, Any]] = []
        self.tuning: Dict[str, Any] = {}

    def observe(self, signal: Dict[str, Any]) -> None:
        signal["_observed_at"] = _now_iso()
        self.signals.append(signal)
        self._recalc(signal)

    def get_tuning(self, key: str, default: Any = None) -> Any:
        return self.tuning.get(key, default)

    def _recalc(self, latest: Dict[str, Any]) -> None:
        kind = latest.get("kind")
        if kind == "latency":
            p99 = latest.get("p99", 0)
            self.tuning["retry.max_attempts"] = max(1, min(5, int(p99 / 500) + 1))
        elif kind == "error_rate":
            rate = latest.get("rate", 0)
            self.tuning["circuit_breaker.threshold"] = max(0.01, min(0.5, rate * 2))
        elif kind == "throughput":
            self.tuning["pool.size"] = max(1, int(latest.get("rps", 0) / 10))


class AutonomyController:
    """Run long-lived swarms with safe self-modifying workflows."""

    def __init__(self, workflow_store: Optional[Any] = None):
        self.workflow_store = workflow_store
        self.mutator = WorkflowMutator()
        self.adaptive = AdaptiveEngine()
        self._runs: Dict[str, Dict[str, Any]] = {}
        self._decisions: List[Dict[str, Any]] = []

    def start_swarm(self, swarm_id: str, workflow: Dict[str, Any]) -> Dict[str, Any]:
        run = {
            "swarm_id": swarm_id,
            "workflow": copy.deepcopy(workflow),
            "status": "running",
            "started_at": _now_iso(),
            "decisions": [],
        }
        self._runs[swarm_id] = run
        return run

    def propose_mutation(self, swarm_id: str, edits: List[Dict[str, Any]], rationale: str) -> Optional[EditProposal]:
        run = self._runs.get(swarm_id)
        if not run:
            return None
        proposal = self.mutator.propose_edit(swarm_id, edits, rationale)
        decision = {
            "swarm_id": swarm_id,
            "proposal_id": proposal.proposal_id,
            "kind": "mutation_proposed",
            "rationale": rationale,
            "timestamp": _now_iso(),
        }
        run["decisions"].append(decision)
        self._decisions.append(decision)
        return proposal

    def apply_mutation(self, swarm_id: str, proposal_id: str) -> Optional[Dict[str, Any]]:
        run = self._runs.get(swarm_id)
        if not run:
            return None
        try:
            updated = self.mutator.approve(proposal_id, run["workflow"])
            run["workflow"] = updated
            decision = {
                "swarm_id": swarm_id,
                "proposal_id": proposal_id,
                "kind": "mutation_applied",
                "timestamp": _now_iso(),
            }
            run["decisions"].append(decision)
            self._decisions.append(decision)
            return updated
        except Exception as exc:
            decision = {
                "swarm_id": swarm_id,
                "proposal_id": proposal_id,
                "kind": "mutation_denied",
                "reason": str(exc),
                "timestamp": _now_iso(),
            }
            run["decisions"].append(decision)
            self._decisions.append(decision)
            return None

    def rollback_mutation(self, swarm_id: str, proposal_id: str) -> Optional[Dict[str, Any]]:
        run = self._runs.get(swarm_id)
        if not run:
            return None
        snapshot = self.mutator.rollback(proposal_id)
        if snapshot is not None:
            run["workflow"] = snapshot
            decision = {
                "swarm_id": swarm_id,
                "proposal_id": proposal_id,
                "kind": "mutation_rolled_back",
                "timestamp": _now_iso(),
            }
            run["decisions"].append(decision)
            self._decisions.append(decision)
        return snapshot

    def observe_signal(self, swarm_id: str, signal: Dict[str, Any]) -> None:
        self.adaptive.observe(signal)
        run = self._runs.get(swarm_id)
        if run:
            run.setdefault("signals", []).append(signal)

    def get_decisions(self, swarm_id: Optional[str] = None) -> List[Dict[str, Any]]:
        if swarm_id:
            run = self._runs.get(swarm_id)
            return run.get("decisions", []) if run else []
        return list(self._decisions)


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
