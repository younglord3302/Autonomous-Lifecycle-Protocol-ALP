"""ALP edge-native runtime (v11.1.0 — The Ambient Era).

Provides:
- LWWRegister: last-writer-wins register for CRDT state sync.
- ORSet: observed-remove set for CRDT state sync.
- EdgeRuntime: offline-first execution, resync on reconnect, locality-aware task placement.
"""
from __future__ import annotations


import time
from typing import Any, Dict, List, Optional


class LWWRegister:
    """Last-writer-wins register for CRDT state sync."""

    def __init__(self, node_id: str, value: Any = None):
        self.node_id = node_id
        self.value = value
        self.timestamp = time.time()

    def set(self, value: Any, node_id: Optional[str] = None) -> Dict[str, Any]:
        node = node_id or self.node_id
        now = time.time()
        entry = {"value": value, "node_id": node, "timestamp": now}
        if now >= self.timestamp:
            self.value = value
            self.timestamp = now
        return entry

    def get(self) -> Any:
        return self.value

    def merge(self, other: Dict[str, Any]) -> None:
        if other.get("timestamp", 0) >= self.timestamp:
            self.value = other.get("value")
            self.timestamp = other.get("timestamp", self.timestamp)

    def to_dict(self) -> Dict[str, Any]:
        return {"value": self.value, "node_id": self.node_id, "timestamp": self.timestamp}


class ORSet:
    """Observed-remove set for CRDT state sync."""

    def __init__(self, node_id: str):
        self.node_id = node_id
        self.items: Dict[str, List[Dict[str, Any]]] = {}

    def add(self, item: Any) -> Dict[str, Any]:
        tag = f"{self.node_id}-{time.time()}"
        entry = {"item": item, "tag": tag, "node_id": self.node_id, "op": "add"}
        self.items.setdefault(str(item), []).append(entry)
        return entry

    def remove(self, item: Any) -> None:
        self.items.pop(str(item), None)

    def has(self, item: Any) -> bool:
        return str(item) in self.items

    def values(self) -> List[Any]:
        return [v[0]["item"] for v in self.items.values() if v]

    def merge(self, other_items: Dict[str, List[Dict[str, Any]]]) -> None:
        for key, entries in other_items.items():
            existing = self.items.get(key, [])
            existing_tags = {e["tag"] for e in existing}
            for entry in entries:
                if entry.get("op") == "add" and entry["tag"] not in existing_tags:
                    existing.append(entry)
                elif entry.get("op") == "remove":
                    self.items.pop(key, None)
            if existing:
                self.items[key] = existing

    def to_dict(self) -> Dict[str, Any]:
        return {k: v for k, v in self.items.items()}


class EdgeRuntime:
    """Offline-first execution with resync and locality-aware task placement."""

    def __init__(self, node_id: str, region: str = "local"):
        self.node_id = node_id
        self.region = region
        self.state: Dict[str, LWWRegister] = {}
        self.pending: List[Dict[str, Any]] = []
        self.online = True
        self.peers: List[Dict[str, Any]] = []

    def register_peer(self, peer: Dict[str, Any]) -> None:
        self.peers.append(peer)

    def set_state(self, key: str, value: Any) -> Dict[str, Any]:
        reg = self.state.setdefault(key, LWWRegister(self.node_id))
        return reg.set(value)

    def get_state(self, key: str) -> Any:
        reg = self.state.get(key)
        return reg.get() if reg else None

    def queue_task(self, task: Dict[str, Any]) -> None:
        if not self.online:
            self.pending.append(task)
        else:
            self._execute(task)

    def resync(self) -> Dict[str, Any]:
        applied = 0
        for task in list(self.pending):
            self._execute(task)
            self.pending.remove(task)
            applied += 1
        return {"applied": applied, "remaining": len(self.pending)}

    def go_offline(self) -> None:
        self.online = False

    def go_online(self) -> None:
        self.online = True
        self.resync()

    def nearest_peer(self, task: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        candidates = [p for p in self.peers if p.get("online")]
        if not candidates:
            return None
        return min(candidates, key=lambda p: p.get("latency_ms", float("inf")))

    def _execute(self, task: Dict[str, Any]) -> None:
        task["executed_by"] = self.node_id
        task["executed_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
