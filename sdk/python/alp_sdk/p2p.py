"""ALP Decentralized Coordination (v18.1.0 — V14 The Sovereign Era).

P2P swarm coordination without a central coordinator:

* ``P2PNode``         — a peer in the decentralized swarm.
* ``P2PSwarm``        — gossip-based state sync, direct negotiation, ad-hoc federations.
* ``GossipProtocol``  — best-effort rumor spreading for state synchronization.
* ``DHT``             — lightweight distributed hash table for agent discovery.

Mirrors the planned ``parser/src/p2p.ts`` surface; tests live in
``sdk/python/tests/test_p2p.py``.
"""

import hashlib
import json
import os
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


P2P_DIR = ".p2p"
PEERS_FILE = "peers.jsonl"
STATE_FILE = "swarm_state.json"


def p2p_dir(alp_dir: str) -> str:
    return os.path.join(alp_dir, P2P_DIR)


def peers_path(alp_dir: str) -> str:
    return os.path.join(p2p_dir(alp_dir), PEERS_FILE)


def swarm_state_path(alp_dir: str) -> str:
    return os.path.join(p2p_dir(alp_dir), STATE_FILE)


@dataclass
class P2PNode:
    node_id: str
    agent_id: str
    capabilities: List[str] = field(default_factory=list)
    address: str = ""
    last_seen: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self):
        if not self.last_seen:
            self.last_seen = _now_iso()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "node_id": self.node_id,
            "agent_id": self.agent_id,
            "capabilities": self.capabilities,
            "address": self.address,
            "last_seen": self.last_seen,
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "P2PNode":
        return cls(
            node_id=d["node_id"],
            agent_id=d["agent_id"],
            capabilities=d.get("capabilities", []),
            address=d.get("address", ""),
            last_seen=d.get("last_seen", ""),
            metadata=d.get("metadata", {}),
        )


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
class GossipMessage:
    topic: str
    payload: Dict[str, Any]
    source_node: str
    timestamp: str = ""
    ttl: int = 3

    def __post_init__(self):
        if not self.timestamp:
            self.timestamp = _now_iso()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "topic": self.topic,
            "payload": self.payload,
            "source_node": self.source_node,
            "timestamp": self.timestamp,
            "ttl": self.ttl,
        }


class DHT:
    """Lightweight distributed hash table for agent discovery."""

    def __init__(self):
        self._table: Dict[str, P2PNode] = {}

    def register(self, node: P2PNode) -> None:
        key = self._node_key(node.agent_id)
        self._table[key] = node

    def resolve(self, agent_id: str) -> Optional[P2PNode]:
        return self._table.get(self._node_key(agent_id))

    def remove(self, agent_id: str) -> None:
        self._table.pop(self._node_key(agent_id), None)

    def find_by_capability(self, capability: str) -> List[P2PNode]:
        return [n for n in self._table.values() if capability in n.capabilities]

    def all_nodes(self) -> List[P2PNode]:
        return list(self._table.values())

    @staticmethod
    def _node_key(agent_id: str) -> str:
        return hashlib.sha256(agent_id.encode()).hexdigest()[:16]


class GossipProtocol:
    """Best-effort rumor spreading for swarm state synchronization."""

    def __init__(self, fanout: int = 3):
        self.fanout = fanout
        self._seen: Set[str] = set()

    def spread(self, message: GossipMessage, peers: List[P2PNode]) -> List[GossipMessage]:
        forwarded: List[GossipMessage] = []
        msg_id = self._message_id(message)
        if msg_id in self._seen:
            return forwarded
        self._seen.add(msg_id)
        if message.ttl <= 0:
            return forwarded
        for peer in peers[: self.fanout]:
            next_payload = dict(message.payload)
            next_payload["_forwarded_to"] = peer.node_id
            forwarded.append(
                GossipMessage(
                    topic=message.topic,
                    payload=next_payload,
                    source_node=message.source_node,
                    timestamp=message.timestamp,
                    ttl=message.ttl - 1,
                )
            )
        return forwarded

    def _message_id(self, message: GossipMessage) -> str:
        raw = json.dumps(message.to_dict(), sort_keys=True, default=str).encode()
        return hashlib.sha256(raw).hexdigest()


class P2PSwarm:
    """Decentralized swarm coordination without a central coordinator.

    Usage::

        swarm = P2PSwarm(alp_dir="/path/to/.alp")
        swarm.join(P2PNode("n1", "agent-1", capabilities=["build"]))
        swarm.join(P2PNode("n2", "agent-2", capabilities=["test"]))
        swarm.gossip(GossipMessage("task.assign", {"task_id": "t1", "agent": "agent-1"}, "n1"))
        report = swarm.run(executor=lambda task_id, agent_id: None, tasks=[{"task_id": "t1"}])
    """

    def __init__(
        self,
        alp_dir: str,
        fanout: int = 3,
        heartbeat_timeout: float = 30.0,
        max_retries: int = 2,
    ):
        self.alp_dir = alp_dir
        self.fanout = fanout
        self.heartbeat_timeout = heartbeat_timeout
        self.max_retries = max_retries
        self.dht = DHT()
        self.gossip_protocol = GossipProtocol(fanout=fanout)
        self._assignments: List[TaskAssignment] = []
        self._reports: Dict[str, P2PReport] = {}
        self._messages: List[GossipMessage] = []

    def join(self, node: P2PNode) -> None:
        self.dht.register(node)
        self._persist_peer(node)

    def leave(self, agent_id: str) -> None:
        self.dht.remove(agent_id)
        self._remove_peer(agent_id)

    def gossip(self, message: GossipMessage) -> List[GossipMessage]:
        peers = self.dht.all_nodes()
        forwarded = self.gossip_protocol.spread(message, peers)
        self._messages.append(message)
        self._messages.extend(forwarded)
        return forwarded

    def discover(self, capability: str) -> List[P2PNode]:
        return self.dht.find_by_capability(capability)

    def assign_task(self, task_id: str, agent_id: str, workflow_id: str = "_default") -> Optional[TaskAssignment]:
        node = self.dht.resolve(agent_id)
        if not node:
            return None
        assignment = TaskAssignment(task_id=task_id, agent_id=agent_id, workflow_id=workflow_id)
        self._assignments.append(assignment)
        return assignment

    def _execute_task(self, executor: Callable[[str, str], Any], task_id: str, agent_id: str) -> bool:
        attempt = 0
        while attempt <= self.max_retries:
            try:
                executor(task_id, agent_id)
                return True
            except Exception:
                attempt += 1
                if attempt > self.max_retries:
                    return False
        return False

    def run(self, executor: Callable[[str, str], Any], tasks: List[Dict[str, Any]], workflow_id: str = "_default") -> "P2PReport":
        report = P2PReport(swarm_id=workflow_id)
        self._reports[workflow_id] = report

        for task in tasks:
            task_id = task.get("task_id", "")
            assignment = next((a for a in self._assignments if a.task_id == task_id), None)
            if not assignment:
                continue
            agent_id = assignment.agent_id
            node = self.dht.resolve(agent_id)
            if not node:
                report.add_action({"type": "task_failed", "task_id": task_id, "reason": "node not found"})
                continue

            success = self._execute_task(executor, task_id, agent_id)
            if success:
                assignment.status = "completed"
                report.add_action({"type": "task_completed", "task_id": task_id, "agent_id": agent_id})
            else:
                node.status = AgentStatus.FAILED
                assignment.status = "failed"
                report.add_action({"type": "task_failed", "task_id": task_id, "agent_id": agent_id})

        return report

    def get_report(self, workflow_id: Optional[str] = None) -> Optional["P2PReport"]:
        key = workflow_id or self.alp_dir
        return self._reports.get(key)

    def _persist_peer(self, node: P2PNode) -> None:
        try:
            d = p2p_dir(self.alp_dir)
            if not os.path.exists(d):
                os.makedirs(d, exist_ok=True)
            with open(peers_path(self.alp_dir), "a", encoding="utf-8") as f:
                f.write(json.dumps(node.to_dict()) + "\n")
        except Exception:
            pass

    def _remove_peer(self, node_id: str) -> None:
        try:
            p = peers_path(self.alp_dir)
            if not os.path.exists(p):
                return
            kept = []
            with open(p, "r", encoding="utf-8") as f:
                for line in f:
                    try:
                        entry = json.loads(line.strip())
                    except json.JSONDecodeError:
                        kept.append(line)
                        continue
                    if entry.get("node_id") != node_id:
                        kept.append(json.dumps(entry) + "\n")
            with open(p, "w", encoding="utf-8") as f:
                f.writelines(kept)
        except Exception:
            pass


@dataclass
class P2PReport:
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
            "completed": sum(1 for a in self.actions if a.get("type") == "task_completed"),
            "failed": sum(1 for a in self.actions if a.get("type") == "task_failed"),
            "actions": self.actions,
        }


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
