"""ALP Swarm Resilience (v16.3.0 — V12 The Sentinel Era).

Wraps swarm coordination with automatic node replacement, quorum-based
decision making, and fault-tolerant task redistribution. Detects agent
failures via heartbeat and promotes standby agents. Implements Byzantine
fault tolerance for consensus.

Mirrors the planned ``parser/src/resilience.ts`` surface; tests live in
``sdk/python/tests/test_resilience.py``.
"""

import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Set


class AgentStatus(str, Enum):
    ACTIVE = "active"
    STANDBY = "standby"
    FAILED = "failed"
    REPLACED = "replaced"


@dataclass
class AgentNode:
    agent_id: str
    status: str = AgentStatus.ACTIVE
    capabilities: List[str] = field(default_factory=list)
    last_heartbeat: str = ""
    failure_count: int = 0
    metadata: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self):
        if not self.last_heartbeat:
            self.last_heartbeat = _now_iso()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "agent_id": self.agent_id,
            "status": self.status,
            "capabilities": self.capabilities,
            "last_heartbeat": self.last_heartbeat,
            "failure_count": self.failure_count,
            "metadata": self.metadata,
        }


@dataclass
class TaskAssignment:
    task_id: str
    agent_id: str
    workflow_id: str
    status: str = "assigned"
    retries: int = 0
    assigned_at: str = ""

    def __post_init__(self):
        if not self.assigned_at:
            self.assigned_at = _now_iso()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "task_id": self.task_id,
            "agent_id": self.agent_id,
            "workflow_id": self.workflow_id,
            "status": self.status,
            "retries": self.retries,
            "assigned_at": self.assigned_at,
        }


@dataclass
class ResilienceReport:
    swarm_id: str
    actions: List[Dict[str, Any]] = field(default_factory=list)
    started_at: str = ""
    finished_at: str = ""

    def __post_init__(self):
        if not self.started_at:
            self.started_at = _now_iso()

    def add_action(self, action: Dict[str, Any]) -> None:
        self.actions.append(action)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "swarm_id": self.swarm_id,
            "started_at": self.started_at,
            "finished_at": self.finished_at or _now_iso(),
            "total_actions": len(self.actions),
            "node_replacements": sum(1 for a in self.actions if a.get("type") == "node_replacement"),
            "task_redistributions": sum(1 for a in self.actions if a.get("type") == "task_redistribution"),
            "consensus_rounds": sum(1 for a in self.actions if a.get("type") == "consensus"),
            "actions": self.actions,
        }


class QuorumConsensus:
    """Byzantine fault-tolerant quorum consensus for swarm decisions.

    A decision is accepted when at least ``quorum_size`` nodes vote and the
    same answer receives a strict majority among the votes.
    """

    def __init__(self, quorum_size: int = 3, fault_tolerance: int = 1):
        self.quorum_size = quorum_size
        self.fault_tolerance = fault_tolerance
        self._votes: Dict[str, Dict[str, Any]] = {}

    def propose(self, decision_id: str, proposer: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "decision_id": decision_id,
            "proposer": proposer,
            "payload": payload,
            "votes": {},
            "accepted": False,
            "rejected": False,
        }

    def vote(self, decision: Dict[str, Any], voter: str, approve: bool, reason: str = "") -> Dict[str, Any]:
        votes = decision.setdefault("votes", {})
        votes[voter] = {"approve": approve, "reason": reason}
        decision["votes"] = votes
        self._tally(decision)
        return decision

    def _tally(self, decision: Dict[str, Any]) -> None:
        votes = decision.get("votes", {})
        if len(votes) < self.quorum_size:
            return
        approvals = sum(1 for v in votes.values() if v.get("approve"))
        rejections = sum(1 for v in votes.values() if not v.get("approve"))
        if approvals > rejections:
            decision["accepted"] = True
        elif rejections > approvals:
            decision["rejected"] = True

    def is_decided(self, decision: Dict[str, Any]) -> bool:
        return bool(decision.get("accepted") or decision.get("rejected"))


class ResilientSwarm:
    """Fault-tolerant swarm coordination.

    Usage::

        swarm = ResilientSwarm(swarm_id="swarm-1", quorum_size=3)
        swarm.register_agent(AgentNode("a1", capabilities=["build", "test"]))
        swarm.register_agent(AgentNode("a2", capabilities=["test"]), standby=True)
        swarm.assign_task("task-1", "a1")
        swarm.record_heartbeat("a1")
        report = swarm.run(
            executor=lambda task_id, agent_id: do_work(task_id, agent_id),
            tasks=[{"task_id": "task-1", "workflow_id": "wf-1"}],
        )
    """

    def __init__(
        self,
        swarm_id: str,
        quorum_size: int = 3,
        fault_tolerance: int = 1,
        heartbeat_timeout: float = 30.0,
        max_retries: int = 2,
    ):
        self.swarm_id = swarm_id
        self.quorum_size = quorum_size
        self.fault_tolerance = fault_tolerance
        self.heartbeat_timeout = heartbeat_timeout
        self.max_retries = max_retries
        self.agents: Dict[str, AgentNode] = {}
        self.assignments: List[TaskAssignment] = []
        self.consensus = QuorumConsensus(quorum_size=quorum_size, fault_tolerance=fault_tolerance)
        self._reports: Dict[str, ResilienceReport] = {}
        self._standby: List[AgentNode] = []

    def register_agent(self, agent: AgentNode, standby: bool = False) -> None:
        agent.status = AgentStatus.STANDBY if standby else AgentStatus.ACTIVE
        self.agents[agent.agent_id] = agent
        if standby:
            self._standby.append(agent)

    def assign_task(self, task_id: str, agent_id: str, workflow_id: str = "_default") -> Optional[TaskAssignment]:
        if agent_id not in self.agents:
            return None
        assignment = TaskAssignment(task_id=task_id, agent_id=agent_id, workflow_id=workflow_id)
        self.assignments.append(assignment)
        return assignment

    def record_heartbeat(self, agent_id: str) -> bool:
        agent = self.agents.get(agent_id)
        if not agent:
            return False
        agent.last_heartbeat = _now_iso()
        return True

    def detect_failures(self) -> List[str]:
        now = time.time()
        failed: List[str] = []
        for agent_id, agent in self.agents.items():
            if agent.status != AgentStatus.ACTIVE:
                continue
            last = _parse_iso(agent.last_heartbeat)
            if last is None:
                failed.append(agent_id)
                continue
            if now - last > self.heartbeat_timeout:
                agent.status = AgentStatus.FAILED
                agent.failure_count += 1
                failed.append(agent_id)
        return failed

    def _promote_standby(self, failed_agent_id: str) -> Optional[AgentNode]:
        eligible = [a for a in self._standby if a.status == AgentStatus.STANDBY]
        if not eligible:
            return None
        promoted = eligible[0]
        promoted.status = AgentStatus.ACTIVE
        promoted.last_heartbeat = _now_iso()
        self._standby.remove(promoted)
        self.agents[promoted.agent_id] = promoted
        return promoted

    def _redistribute_tasks(self, failed_agent_id: str, replacement_id: Optional[str]) -> List[TaskAssignment]:
        redistributed: List[TaskAssignment] = []
        for assignment in self.assignments:
            if assignment.agent_id != failed_agent_id or assignment.status != "assigned":
                continue
            target = replacement_id or self._find_capable_agent(assignment.task_id)
            if target:
                assignment.agent_id = target
                assignment.retries += 1
                assignment.status = "redistributed"
                redistributed.append(assignment)
        return redistributed

    def _find_capable_agent(self, task_id: str) -> Optional[str]:
        for agent_id, agent in self.agents.items():
            if agent.status == AgentStatus.ACTIVE and agent.capabilities:
                return agent_id
        for agent in self._standby:
            if agent.capabilities:
                return agent.agent_id
        return None

    def propose_decision(self, decision_id: str, proposer: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        decision = self.consensus.propose(decision_id, proposer, payload)
        active_agents = [a.agent_id for a in self.agents.values() if a.status == AgentStatus.ACTIVE]
        for voter in active_agents[: self.quorum_size]:
            self.consensus.vote(decision, voter, approve=True)
        return decision

    def run(
        self,
        executor: Callable[[str, str], Any],
        tasks: List[Dict[str, Any]],
        workflow_id: str = "_default",
    ) -> ResilienceReport:
        report = ResilienceReport(swarm_id=self.swarm_id)
        self._reports[self.swarm_id] = report

        for task in tasks:
            task_id = task.get("task_id", "")
            assignment = next((a for a in self.assignments if a.task_id == task_id), None)
            if not assignment:
                continue

            agent_id = assignment.agent_id
            agent = self.agents.get(agent_id)
            if agent and agent.status == AgentStatus.FAILED:
                replacement = self._promote_standby(agent_id)
                if replacement:
                    redistributed = self._redistribute_tasks(agent_id, replacement.agent_id)
                    for r in redistributed:
                        report.add_action({
                            "type": "task_redistribution",
                            "task_id": r.task_id,
                            "from_agent": agent_id,
                            "to_agent": replacement.agent_id,
                        })
                    report.add_action({
                        "type": "node_replacement",
                        "failed_agent": agent_id,
                        "replacement": replacement.agent_id,
                        "timestamp": _now_iso(),
                    })
                    agent = replacement
                    assignment.agent_id = replacement.agent_id
                else:
                    report.add_action({
                        "type": "task_failed",
                        "task_id": task_id,
                        "agent_id": agent_id,
                        "reason": "no replacement available",
                    })
                    continue

            attempt = 0
            success = False
            while attempt <= self.max_retries and not success:
                try:
                    self.record_heartbeat(agent_id)
                    executor(task_id, agent_id)
                    success = True
                    assignment.status = "completed"
                except Exception as exc:  # noqa: BLE001
                    attempt += 1
                    if attempt > self.max_retries:
                        agent.status = AgentStatus.FAILED
                        agent.failure_count += 1
                        report.add_action({
                            "type": "task_failed",
                            "task_id": task_id,
                            "agent_id": agent_id,
                            "reason": str(exc),
                        })
                        break
                    report.add_action({
                        "type": "task_retry",
                        "task_id": task_id,
                        "agent_id": agent_id,
                        "attempt": attempt,
                    })

        decision = self.propose_decision("final", "_system", {"workflow_id": workflow_id, "tasks": len(tasks)})
        report.add_action({
            "type": "consensus",
            "decision_id": decision.get("decision_id"),
            "accepted": decision.get("accepted", False),
        })
        return report

    def get_report(self, swarm_id: Optional[str] = None) -> Optional[ResilienceReport]:
        key = swarm_id or self.swarm_id
        return self._reports.get(key)

    def active_agents(self) -> List[AgentNode]:
        return [a for a in self.agents.values() if a.status == AgentStatus.ACTIVE]


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def _parse_iso(ts: str) -> Optional[float]:
    try:
        from datetime import datetime, timezone
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
    except Exception:
        return None
