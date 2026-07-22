"""ALP Event Sourcing (v10.1.0 — Python SDK parity, spec/10-versioning.md).

Mirrors ``parser/src/event-store.ts``: an append-only, schema-versioned JSONL
event log recording every workspace mutation so the execution history can be
inspected and replayed deterministically via ``alp replay``.
"""
from __future__ import annotations


import json
import os
import time
import uuid
from typing import Any, Dict, List, Optional

EVENT_SCHEMA_VERSION = 1
EVENT_DIR = ".events"
EVENT_FILE = "events.jsonl"

EventType = str  # one of the TS EventType union values


def events_dir(alp_dir: str) -> str:
    return os.path.join(alp_dir, EVENT_DIR)


def events_path(alp_dir: str) -> str:
    return os.path.join(events_dir(alp_dir), EVENT_FILE)


class Event:
    def __init__(
        self,
        id: str,
        timestamp: str,
        type: str,
        payload: Dict[str, Any],
        version: str,
        schema_version: int,
    ):
        self.id = id
        self.timestamp = timestamp
        self.type = type
        self.payload = payload
        self.version = version
        self.schema_version = schema_version

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "timestamp": self.timestamp,
            "type": self.type,
            "payload": self.payload,
            "version": self.version,
            "schemaVersion": self.schema_version,
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Event":
        return cls(
            id=d["id"],
            timestamp=d["timestamp"],
            type=d["type"],
            payload=d.get("payload", {}),
            version=d.get("version", "10.1.0"),
            schema_version=d.get("schemaVersion", EVENT_SCHEMA_VERSION),
        )


class EventStore:
    """Append-only, schema-versioned event log (mirrors ``EventStore`` TS)."""

    def __init__(self, alp_dir: str, version: str = "10.1.0"):
        self.alp_dir = alp_dir
        self.version = version

    def ensure_dir(self) -> None:
        d = events_dir(self.alp_dir)
        if not os.path.exists(d):
            os.makedirs(d, exist_ok=True)

    def append(self, event_type: str, payload: Optional[Dict[str, Any]] = None) -> Event:
        event = Event(
            id=uuid.uuid4().hex[:12],
            timestamp=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            type=event_type,
            payload=payload or {},
            version=self.version,
            schema_version=EVENT_SCHEMA_VERSION,
        )
        self.ensure_dir()
        with open(events_path(self.alp_dir), "a", encoding="utf-8") as f:
            f.write(json.dumps(event.to_dict()) + "\n")
        return event

    def read_all(self) -> List[Event]:
        p = events_path(self.alp_dir)
        if not os.path.exists(p):
            return []
        events: List[Event] = []
        with open(p, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    parsed = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if parsed.get("schemaVersion") == EVENT_SCHEMA_VERSION and parsed.get("version"):
                    events.append(Event.from_dict(parsed))
        return events

    def filter(
        self,
        events: List[Event],
        types: Optional[List[str]] = None,
        object_id: Optional[str] = None,
        from_ts: Optional[str] = None,
        to_ts: Optional[str] = None,
    ) -> List[Event]:
        result = events
        if types:
            result = [e for e in result if e.type in types]
        if object_id:
            result = [e for e in result if e.payload.get("object_id") == object_id]
        if from_ts:
            result = [e for e in result if e.timestamp >= from_ts]
        if to_ts:
            result = [e for e in result if e.timestamp <= to_ts]
        return result

    def replay(
        self,
        types: Optional[List[str]] = None,
        object_id: Optional[str] = None,
        from_ts: Optional[str] = None,
        to_ts: Optional[str] = None,
    ) -> Dict[str, Any]:
        all_events = self.read_all()
        filtered = self.filter(all_events, types, object_id, from_ts, to_ts)
        return {
            "events": [e.to_dict() for e in filtered],
            "applied": len(filtered),
            "skipped": len(all_events) - len(filtered),
        }

    def count(self) -> int:
        return len(self.read_all())
