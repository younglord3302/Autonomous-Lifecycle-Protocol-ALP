"""ALP Observability (v7.1.0 — Python SDK parity, spec/05 §4 + V3 Pillars 4/5).

Mirrors the TypeScript runtime primitives used by ``alp serve`` / ``alp evolve``:

* ``RuntimeLog``  — append-only JSONL event stream at ``.alp/.runtime/log.jsonl``
  (mirrors ``cli/src/runtime.ts``). Best-effort: never raises.
* ``StateStore``  — durable, dependency-free snapshot store that ingests events
  and computes analytics (mirrors ``parser/src/state-store.ts``). Analytics reuse
  the pure ``compute_analytics`` in ``analytics.py``.

The HTTP dashboard (``alp serve``) and failure-telemetry CLI (``alp evolve``)
live in the TypeScript CLI; this module provides the SDK-level primitives so
the Python SDK can emit and analyze the same event stream.
"""
from __future__ import annotations


import json
import os
import time
from typing import Any, Dict, List, Optional


# ── Event types (mirrors RuntimeEventType in cli/src/runtime.ts) ────────────

RUNTIME_EVENT_TYPES = [
    "run_start",
    "run_end",
    "task_claim",
    "task_release",
    "task_status",
    "agent_active",
    "agent_idle",
    "memory_write",
    "file_mutation",
    "checkpoint",
    "human_handoff",
    "workflow_fail",
    "error",
]


def runtime_dir(alp_dir: str) -> str:
    return os.path.join(alp_dir, ".runtime")


def runtime_log_path(alp_dir: str) -> str:
    return os.path.join(runtime_dir(alp_dir), "log.jsonl")


class RuntimeLog:
    """Append-only JSONL event stream (mirrors ``cli/src/runtime.ts``)."""

    def __init__(self, alp_dir: str):
        self.alp_dir = alp_dir

    def log_event(
        self,
        event_type: str,
        fields: Optional[Dict[str, Any]] = None,
        pid: Optional[int] = None,
    ) -> None:
        """Append a structured event. Never raises."""
        try:
            d = runtime_dir(self.alp_dir)
            if not os.path.isdir(d):
                os.makedirs(d, exist_ok=True)
            entry: Dict[str, Any] = {
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "type": event_type,
                "pid": pid if pid is not None else os.getpid(),
            }
            if fields:
                entry.update({k: v for k, v in fields.items() if k not in ("timestamp", "type", "pid")})
            with open(runtime_log_path(self.alp_dir), "a", encoding="utf-8") as f:
                f.write(json.dumps(entry) + "\n")
        except Exception:
            # Observability is best-effort.
            pass

    def read_events(self) -> List[Dict[str, Any]]:
        """Read and parse all events in the runtime log."""
        p = runtime_log_path(self.alp_dir)
        if not os.path.exists(p):
            return []
        events: List[Dict[str, Any]] = []
        try:
            with open(p, "r", encoding="utf-8") as f:
                for line in f:
                    trimmed = line.strip()
                    if not trimmed:
                        continue
                    try:
                        events.append(json.loads(trimmed))
                    except Exception:
                        # Skip malformed lines.
                        continue
        except Exception:
            return events
        return events


# ── Durable state store (mirrors parser/src/state-store.ts) ────────────────

def _key_of(e: Dict[str, Any]) -> str:
    return "|".join([
        str(e.get("timestamp", "")),
        str(e.get("type", "")),
        str(e.get("task_id", "")),
        str(e.get("status", "")),
        str(e.get("agent", "")),
    ])


class StateStore:
    """Durable, dependency-free event store (mirrors ``state-store.ts``).

    Persists a compact JSON snapshot (``.alp/.runtime/state.db.json``) so
    history survives restarts. ``analytics()`` reuses the pure
    ``compute_analytics`` from ``analytics``.
    """

    def __init__(self, alp_dir: str):
        self.alp_dir = alp_dir
        self._db_path = os.path.join(runtime_dir(alp_dir), "state.db.json")
        self._events: List[Dict[str, Any]] = []
        self._load()

    def _load(self) -> None:
        if not os.path.exists(self._db_path):
            return
        try:
            with open(self._db_path, "r", encoding="utf-8") as f:
                snap = json.load(f)
            if isinstance(snap, dict) and isinstance(snap.get("events"), list):
                self._events = snap["events"]
        except Exception:
            self._events = []

    def save(self) -> None:
        d = runtime_dir(self.alp_dir)
        if not os.path.isdir(d):
            os.makedirs(d, exist_ok=True)
        snap = {"version": 1, "ingested": len(self._events), "events": self._events}
        with open(self._db_path, "w", encoding="utf-8") as f:
            json.dump(snap, f)

    @property
    def size(self) -> int:
        return len(self._events)

    def ingest(self, incoming: List[Dict[str, Any]]) -> int:
        """Append events, de-duplicating by timestamp+type+task_id+status.

        Returns the number of newly added events.
        """
        seen = {_key_of(e) for e in self._events}
        added = 0
        for e in incoming:
            k = _key_of(e)
            if k in seen:
                continue
            seen.add(k)
            self._events.append(e)
            added += 1
        if added > 0:
            self._events.sort(key=lambda ev: str(ev.get("timestamp", "")))
        return added

    def analytics(self) -> Dict[str, Any]:
        from .analytics import compute_analytics

        return compute_analytics(self._events)


# ── Metering & Cost Governance (v10.7.0) ───────────────────────────────────


def metering_path(alp_dir: str) -> str:
    return os.path.join(runtime_dir(alp_dir), "metering.jsonl")


class MeteringLog:
    """Append-only metering log mirroring ``MeteringStore`` TS."""

    def __init__(self, alp_dir: str):
        self.alp_dir = alp_dir

    def append(
        self,
        task_id: str,
        agent: str,
        input_tokens: int = 0,
        output_tokens: int = 0,
        operations: int = 0,
        duration_ms: int = 0,
    ) -> None:
        entry: Dict[str, Any] = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "task_id": task_id,
            "agent": agent,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "operations": operations,
            "duration_ms": duration_ms,
        }
        try:
            d = runtime_dir(self.alp_dir)
            if not os.path.isdir(d):
                os.makedirs(d, exist_ok=True)
            with open(metering_path(self.alp_dir), "a", encoding="utf-8") as f:
                f.write(json.dumps(entry) + "\n")
        except Exception:
            pass

    def read_all(self) -> List[Dict[str, Any]]:
        p = metering_path(self.alp_dir)
        if not os.path.exists(p):
            return []
        entries: List[Dict[str, Any]] = []
        try:
            with open(p, "r", encoding="utf-8") as f:
                for line in f:
                    trimmed = line.strip()
                    if not trimmed:
                        continue
                    try:
                        entries.append(json.loads(trimmed))
                    except Exception:
                        continue
        except Exception:
            return entries
        return entries

    def cost_estimate(self, task_id: str) -> Dict[str, Any]:
        entries = [e for e in self.read_all() if e.get("task_id") == task_id]
        tokens = sum(int(e.get("input_tokens", 0)) + int(e.get("output_tokens", 0)) for e in entries)
        operations = sum(int(e.get("operations", 0)) for e in entries)
        estimated_cost = round(tokens * 0.000002 + operations * 0.001, 6)
        return {"tokens": tokens, "operations": operations, "estimated_cost": estimated_cost}

    def rate_limiter(self, ns: str) -> Dict[str, Any]:
        now = time.time()
        return {
            "remaining": 100,
            "resetAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now + 60)),
        }


class CostAnalyzer:
    """Compute-cost estimation utilities."""

    def __init__(self, metering_log: MeteringLog):
        self.metering_log = metering_log

    def estimate(self, task_id: str) -> Dict[str, Any]:
        return self.metering_log.cost_estimate(task_id)

    def top_cost_tasks(self, limit: int = 5) -> List[Dict[str, Any]]:
        entries = self.metering_log.read_all()
        by_task: Dict[str, Dict[str, Any]] = {}
        for e in entries:
            tid = str(e.get("task_id", ""))
            if tid not in by_task:
                by_task[tid] = {"task_id": tid, "tokens": 0, "operations": 0}
            by_task[tid]["tokens"] += int(e.get("input_tokens", 0)) + int(e.get("output_tokens", 0))
            by_task[tid]["operations"] += int(e.get("operations", 0))
        ranked = sorted(by_task.values(), key=lambda x: x["tokens"], reverse=True)[:limit]
        for r in ranked:
            r["estimated_cost"] = round(r["tokens"] * 0.000002 + r["operations"] * 0.001, 6)
        return ranked


# Re-export for convenience.
__all__ = [
    "RUNTIME_EVENT_TYPES",
    "runtime_dir",
    "runtime_log_path",
    "RuntimeLog",
    "StateStore",
    "MeteringLog",
    "CostAnalyzer",
]
