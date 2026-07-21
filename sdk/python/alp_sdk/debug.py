"""ALP Time-Travel Debugging (v10.8.0 — Python SDK parity).

Mirrors ``parser/src/debug.ts``: stores engine-state snapshots and provides
a ``DebugSession`` that can step forward/backward and diff snapshots.
"""

import json
import os
import time
from typing import Any, Dict, List, Optional


def snapshots_path(alp_dir: str) -> str:
    return os.path.join(alp_dir, ".runtime", "snapshots.jsonl")


class EngineSnapshot:
    def __init__(
        self,
        id: str,
        run_id: str,
        stage: str,
        timestamp: str,
        state: Dict[str, Any],
        event_ids: List[str],
    ):
        self.id = id
        self.run_id = run_id
        self.stage = stage
        self.timestamp = timestamp
        self.state = state
        self.event_ids = event_ids

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "run_id": self.run_id,
            "stage": self.stage,
            "timestamp": self.timestamp,
            "state": self.state,
            "event_ids": self.event_ids,
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "EngineSnapshot":
        return cls(
            id=d.get("id", ""),
            run_id=d.get("run_id", ""),
            stage=d.get("stage", ""),
            timestamp=d.get("timestamp", ""),
            state=d.get("state", {}),
            event_ids=d.get("event_ids", []),
        )


class SnapshotStore:
    """Persists engine-state snapshots to disk."""

    def __init__(self, alp_dir: str):
        self.alp_dir = alp_dir

    def save(self, snapshot: EngineSnapshot) -> None:
        d = os.path.dirname(snapshots_path(self.alp_dir))
        if not os.path.isdir(d):
            os.makedirs(d, exist_ok=True)
        with open(snapshots_path(self.alp_dir), "a", encoding="utf-8") as f:
            f.write(json.dumps(snapshot.to_dict()) + "\n")

    def load_for_run(self, run_id: str) -> List[EngineSnapshot]:
        p = snapshots_path(self.alp_dir)
        if not os.path.exists(p):
            return []
        snaps: List[EngineSnapshot] = []
        try:
            with open(p, "r", encoding="utf-8") as f:
                for line in f:
                    trimmed = line.strip()
                    if not trimmed:
                        continue
                    try:
                        parsed = json.loads(trimmed)
                        if parsed.get("run_id") == run_id:
                            snaps.append(EngineSnapshot.from_dict(parsed))
                    except Exception:
                        continue
        except Exception:
            return snaps
        return sorted(snaps, key=lambda s: str(s.timestamp))


class DiffResult:
    def __init__(self, added: Dict[str, Any], removed: Dict[str, Any], changed: List[Dict[str, Any]]):
        self.added = added
        self.removed = removed
        self.changed = changed


class DebugSession:
    """Time-travel debug session over a list of snapshots."""

    def __init__(self, snapshots: Optional[List[EngineSnapshot]] = None):
        self.snapshots = sorted(snapshots or [], key=lambda s: str(s.timestamp))

    def step_forward(self) -> Optional[EngineSnapshot]:
        return self.snapshots[0] if self.snapshots else None

    def step_backward(self) -> Optional[EngineSnapshot]:
        return self.snapshots[-1] if self.snapshots else None

    def to_stage(self, name: str) -> Optional[EngineSnapshot]:
        for s in self.snapshots:
            if s.stage == name:
                return s
        return None

    def diff_snapshots(self, a: EngineSnapshot, b: EngineSnapshot) -> DiffResult:
        keys_a = set(a.state.keys())
        keys_b = set(b.state.keys())
        added = {k: b.state[k] for k in keys_b - keys_a}
        removed = {k: a.state[k] for k in keys_a - keys_b}
        changed = []
        for k in keys_a & keys_b:
            if a.state[k] != b.state[k]:
                changed.append({"key": k, "from": a.state[k], "to": b.state[k]})
        return DiffResult(added=added, removed=removed, changed=changed)
