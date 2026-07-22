"""ALP Immutable Execution Traces (v16.0.0 — V12 The Sentinel Era).

Provides:
- TraceEntry: a single execution trace event with metadata.
- TraceStore: hash-linked append-only trace log with Merkle-tree sealing.
- verify_trace_integrity: detect tampering in a stored trace chain.

Mirrors the planned ``parser/src/trace.ts`` surface; tests live in
``sdk/python/tests/test_trace.py``.
"""
from __future__ import annotations


import hashlib
import json
import os
import time
import uuid
from typing import Any, Dict, List, Optional, Tuple


TRACE_DIR = ".traces"
TRACE_FILE = "traces.jsonl"


def trace_dir(alp_dir: str) -> str:
    return os.path.join(alp_dir, TRACE_DIR)


def trace_path(alp_dir: str) -> str:
    return os.path.join(trace_dir(alp_dir), TRACE_FILE)


class TraceEntry:
    def __init__(
        self,
        trace_id: str,
        event_id: str,
        timestamp: str,
        event_type: str,
        payload: Optional[Dict[str, Any]] = None,
        parent_hash: Optional[str] = None,
        merkle_root: Optional[str] = None,
    ):
        self.trace_id = trace_id
        self.event_id = event_id
        self.timestamp = timestamp
        self.event_type = event_type
        self.payload = payload or {}
        self.parent_hash = parent_hash
        self.merkle_root = merkle_root

    def to_dict(self) -> Dict[str, Any]:
        return {
            "trace_id": self.trace_id,
            "event_id": self.event_id,
            "timestamp": self.timestamp,
            "event_type": self.event_type,
            "payload": self.payload,
            "parent_hash": self.parent_hash,
            "merkle_root": self.merkle_root,
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "TraceEntry":
        return cls(
            trace_id=d["trace_id"],
            event_id=d["event_id"],
            timestamp=d["timestamp"],
            event_type=d["event_type"],
            payload=d.get("payload", {}),
            parent_hash=d.get("parent_hash"),
            merkle_root=d.get("merkle_root"),
        )

    def _hash_payload(self) -> str:
        raw = json.dumps(self.payload, sort_keys=True, default=str).encode()
        return hashlib.sha256(raw).hexdigest()

    def entry_hash(self) -> str:
        data = {
            "trace_id": self.trace_id,
            "event_id": self.event_id,
            "timestamp": self.timestamp,
            "event_type": self.event_type,
            "payload_hash": self._hash_payload(),
            "parent_hash": self.parent_hash,
        }
        raw = json.dumps(data, sort_keys=True, default=str).encode()
        return hashlib.sha256(raw).hexdigest()


class MerkleTree:
    """Minimal binary Merkle tree over an ordered list of leaf hashes."""

    def __init__(self, leaves: List[str]):
        self.leaves = leaves
        self.root = self._build_root(leaves)

    @staticmethod
    def _build_root(leaves: List[str]) -> Optional[str]:
        if not leaves:
            return None
        layer = [hashlib.sha256(leaf.encode()).hexdigest() for leaf in leaves]
        while len(layer) > 1:
            next_layer: List[str] = []
            i = 0
            while i < len(layer):
                left = layer[i]
                right = layer[i + 1] if i + 1 < len(layer) else left
                combined = hashlib.sha256((left + right).encode()).hexdigest()
                next_layer.append(combined)
                i += 2
            layer = next_layer
        return layer[0]


class TraceStore:
    """Append-only, Merkle-sealed execution trace log."""

    def __init__(self, alp_dir: str, version: str = "16.0.0"):
        self.alp_dir = alp_dir
        self.version = version

    def ensure_dir(self) -> None:
        d = trace_dir(self.alp_dir)
        if not os.path.exists(d):
            os.makedirs(d, exist_ok=True)

    def append(self, event_type: str, payload: Optional[Dict[str, Any]] = None, trace_id: Optional[str] = None) -> TraceEntry:
        trace_id = trace_id or uuid.uuid4().hex[:12]
        all_entries = self.read_all(trace_id)
        parent_hash = all_entries[-1].entry_hash() if all_entries else "genesis"
        event = TraceEntry(
            trace_id=trace_id,
            event_id=uuid.uuid4().hex[:12],
            timestamp=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            event_type=event_type,
            payload=payload or {},
            parent_hash=parent_hash,
        )
        leaf_hashes = [e.entry_hash() for e in all_entries] + [event.entry_hash()]
        event.merkle_root = MerkleTree(leaf_hashes).root
        self.ensure_dir()
        with open(trace_path(self.alp_dir), "a", encoding="utf-8") as f:
            f.write(json.dumps(event.to_dict()) + "\n")
        return event

    def read_all(self, trace_id: Optional[str] = None) -> List[TraceEntry]:
        p = trace_path(self.alp_dir)
        if not os.path.exists(p):
            return []
        entries: List[TraceEntry] = []
        with open(p, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    parsed = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if trace_id and parsed.get("trace_id") != trace_id:
                    continue
                entries.append(TraceEntry.from_dict(parsed))
        return entries

    def verify_trace_integrity(self, trace_id: str) -> Dict[str, Any]:
        entries = self.read_all(trace_id)
        if not entries:
            return {"valid": False, "reason": "trace_not_found"}
        for i, entry in enumerate(entries):
            if entry.parent_hash != ("genesis" if i == 0 else entries[i - 1].entry_hash()):
                return {"valid": False, "reason": "broken_parent_chain", "event_id": entry.event_id}
        leaf_hashes = [e.entry_hash() for e in entries]
        computed_root = MerkleTree(leaf_hashes).root
        last = entries[-1]
        if last.merkle_root != computed_root:
            return {"valid": False, "reason": "merkle_root_mismatch", "event_id": last.event_id}
        return {"valid": True, "events": len(entries), "merkle_root": computed_root}


def verify_trace_integrity(alp_dir: str, trace_id: str) -> Dict[str, Any]:
    store = TraceStore(alp_dir)
    return store.verify_trace_integrity(trace_id)
