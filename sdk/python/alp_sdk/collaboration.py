"""ALP CollaborationEngine — Real-time multiplayer conflict resolution (v37.0.0 — Python SDK parity).

Provides session-based multi-agent concurrent editing with LWW conflict resolution,
presence tracking, operation logging, and branch/merge with conflict markers.
"""
from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

AGENT_COLORS = [
    "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4",
    "#FFEAA7", "#DDA0DD", "#98D8C8", "#F7DC6F",
    "#BB8FCE", "#85C1E9", "#F8C471", "#82E0AA",
]

_op_counter = 0


class PresenceInfo:
    def __init__(self, agent_id: str, color: str, cursor: Optional[str] = None, status: str = "active"):
        self.agent_id = agent_id
        self.cursor = cursor
        self.last_seen = time.time()
        self.color = color
        self.status = status

    def to_dict(self) -> Dict[str, Any]:
        return {
            "agentId": self.agent_id,
            "cursor": self.cursor,
            "lastSeen": self.last_seen,
            "color": self.color,
            "status": self.status,
        }


class CollabOperation:
    def __init__(
        self,
        op_id: str,
        doc_id: str,
        op_type: str,
        path: str,
        agent_id: str,
        value: Any = None,
        previous_value: Any = None,
        vector_clock: Optional[Dict[str, int]] = None,
    ):
        self.id = op_id
        self.doc_id = doc_id
        self.type = op_type
        self.path = path
        self.agent_id = agent_id
        self.value = value
        self.previous_value = previous_value
        self.timestamp = time.time()
        self.vector_clock = vector_clock or {}

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "docId": self.doc_id,
            "type": self.type,
            "path": self.path,
            "agentId": self.agent_id,
            "value": self.value,
            "previousValue": self.previous_value,
            "timestamp": self.timestamp,
            "vectorClock": self.vector_clock,
        }


class CollabBranch:
    def __init__(self, branch_id: str, source_doc_id: str, state: Dict[str, Any], forked_from_op: int):
        self.branch_id = branch_id
        self.source_doc_id = source_doc_id
        self.forked_at = time.time()
        self.forked_from_op = forked_from_op
        self.state = dict(state)
        self.operations: List[CollabOperation] = []


class CollabSession:
    def __init__(self, doc_id: str, initial_state: Optional[Dict[str, Any]] = None):
        self.doc_id = doc_id
        self.created_at = time.time()
        self.agents: Dict[str, PresenceInfo] = {}
        self.operations: List[CollabOperation] = []
        self.state: Dict[str, Any] = dict(initial_state or {})
        self.branches: Dict[str, CollabBranch] = {}


class CollaborationEngine:
    def __init__(self):
        self.sessions: Dict[str, CollabSession] = {}

    def create_session(self, doc_id: str, initial_state: Optional[Dict[str, Any]] = None) -> CollabSession:
        if doc_id in self.sessions:
            return self.sessions[doc_id]
        session = CollabSession(doc_id, initial_state)
        self.sessions[doc_id] = session
        return session

    def join_session(self, doc_id: str, agent_id: str) -> Optional[PresenceInfo]:
        session = self.sessions.get(doc_id)
        if not session:
            return None
        color_idx = len(session.agents) % len(AGENT_COLORS)
        presence = PresenceInfo(agent_id=agent_id, color=AGENT_COLORS[color_idx])
        session.agents[agent_id] = presence
        return presence

    def leave_session(self, doc_id: str, agent_id: str) -> bool:
        session = self.sessions.get(doc_id)
        if not session:
            return False
        if agent_id in session.agents:
            session.agents[agent_id].status = "disconnected"
            session.agents[agent_id].last_seen = time.time()
            del session.agents[agent_id]
            return True
        return False

    def get_presence(self, doc_id: str) -> List[PresenceInfo]:
        session = self.sessions.get(doc_id)
        if not session:
            return []
        return list(session.agents.values())

    def apply_operation(
        self, doc_id: str, op_type: str, path: str, agent_id: str, value: Any = None
    ) -> Optional[CollabOperation]:
        global _op_counter
        session = self.sessions.get(doc_id)
        if not session:
            return None

        clock: Dict[str, int] = {}
        for op in session.operations:
            for agent, tick in op.vector_clock.items():
                clock[agent] = max(clock.get(agent, 0), tick)
        clock[agent_id] = clock.get(agent_id, 0) + 1

        _op_counter += 1
        previous_value = session.state.get(path)
        op = CollabOperation(
            op_id=f"op-{_op_counter}",
            doc_id=doc_id,
            op_type=op_type,
            path=path,
            agent_id=agent_id,
            value=value,
            previous_value=previous_value,
            vector_clock=clock,
        )

        if op_type in ("insert", "update"):
            session.state[path] = value
        elif op_type == "delete" and path in session.state:
            del session.state[path]

        session.operations.append(op)

        if agent_id in session.agents:
            presence = session.agents[agent_id]
            presence.last_seen = time.time()
            presence.cursor = path
            presence.status = "active"

        return op

    def get_operation_log(self, doc_id: str) -> List[CollabOperation]:
        session = self.sessions.get(doc_id)
        return list(session.operations) if session else []

    def get_snapshot(self, doc_id: str) -> Dict[str, Any]:
        session = self.sessions.get(doc_id)
        return dict(session.state) if session else {}

    def fork(self, doc_id: str, branch_id: str) -> Optional[CollabBranch]:
        session = self.sessions.get(doc_id)
        if not session:
            return None
        branch = CollabBranch(
            branch_id=branch_id,
            source_doc_id=doc_id,
            state=session.state,
            forked_from_op=len(session.operations),
        )
        session.branches[branch_id] = branch
        return branch

    def merge_branch(self, doc_id: str, branch_id: str) -> Optional[Dict[str, Any]]:
        session = self.sessions.get(doc_id)
        if not session:
            return None
        branch = session.branches.get(branch_id)
        if not branch:
            return None

        conflicts = []
        merged = dict(session.state)
        ops_applied = 0

        main_ops_after_fork = session.operations[branch.forked_from_op :]
        main_modified_paths = {op.path for op in main_ops_after_fork}

        for path, branch_val in branch.state.items():
            if path in main_modified_paths and merged.get(path) != branch_val:
                local_val = merged.get(path)
                merged[path] = branch_val
                conflicts.append({
                    "path": path,
                    "localValue": local_val,
                    "remoteValue": branch_val,
                    "resolution": "remote_wins",
                })
            else:
                merged[path] = branch_val
            ops_applied += 1

        session.state = merged
        del session.branches[branch_id]

        return {
            "merged": merged,
            "conflicts": conflicts,
            "operationsApplied": ops_applied,
        }

    def get_session(self, doc_id: str) -> Optional[CollabSession]:
        return self.sessions.get(doc_id)
