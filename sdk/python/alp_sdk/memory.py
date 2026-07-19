"""ALP memory engine (v6.4.0 - Python SDK parity).

Mirrors the TypeScript ``@alp/parser`` ``MemoryStore``: persistent,
scoped key-value storage backed by ``.alp/.memory.json``.
"""

import json
import os
import time
from typing import Any, Dict, List, Optional

MemoryType = str
MemoryImportance = str


class MemoryEntry:
    def __init__(
        self,
        id: str,
        type: MemoryType,
        key: str,
        value: str,
        importance: MemoryImportance = "medium",
        scope: Optional[str] = None,
        source: Optional[str] = None,
        ttl: Optional[int] = None,
        created: Optional[str] = None,
        updated: Optional[str] = None,
    ):
        self.id = id
        self.type = type
        self.key = key
        self.value = value
        self.importance = importance
        self.scope = scope
        self.source = source
        self.ttl = ttl
        self.created = created or ""
        self.updated = updated or ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "type": self.type,
            "key": self.key,
            "value": self.value,
            "importance": self.importance,
            "scope": self.scope,
            "source": self.source,
            "ttl": self.ttl,
            "created": self.created,
            "updated": self.updated,
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "MemoryEntry":
        return cls(
            id=d["id"],
            type=d["type"],
            key=d["key"],
            value=d["value"],
            importance=d.get("importance", "medium"),
            scope=d.get("scope"),
            source=d.get("source"),
            ttl=d.get("ttl"),
            created=d.get("created"),
            updated=d.get("updated"),
        )


class MemoryQuery:
    def __init__(
        self,
        type: Optional[MemoryType] = None,
        scope: Optional[str] = None,
        key: Optional[str] = None,
        importance: Optional[MemoryImportance] = None,
    ):
        self.type = type
        self.scope = scope
        self.key = key
        self.importance = importance


class MemoryStore:
    def __init__(self, project_root: str):
        self.file_path = os.path.join(project_root, ".alp", ".memory.json")
        self.entries: Dict[str, MemoryEntry] = {}

    def load(self) -> None:
        if os.path.exists(self.file_path):
            with open(self.file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            self.entries = {e["id"]: MemoryEntry.from_dict(e) for e in data}

    def persist(self) -> None:
        directory = os.path.dirname(self.file_path)
        os.makedirs(directory, exist_ok=True)
        with open(self.file_path, "w", encoding="utf-8") as f:
            json.dump([e.to_dict() for e in self.entries.values()], f, indent=2)

    def store(self, entry: MemoryEntry) -> MemoryEntry:
        from datetime import datetime, timezone

        now = datetime.now(timezone.utc).isoformat()
        entry.created = entry.created or now
        entry.updated = now
        if not entry.importance:
            entry.importance = "medium"
        self.entries[entry.id] = entry
        return entry

    def retrieve(self, query: MemoryQuery) -> List[MemoryEntry]:
        results = list(self.entries.values())
        if query.type:
            results = [e for e in results if e.type == query.type]
        if query.scope:
            results = [e for e in results if e.scope == query.scope]
        if query.key:
            results = [e for e in results if query.key in e.key]
        if query.importance:
            results = [e for e in results if e.importance == query.importance]
        return results

    def update(self, id: str, value: str) -> Optional[MemoryEntry]:
        from datetime import datetime, timezone

        entry = self.entries.get(id)
        if entry:
            entry.value = value
            entry.updated = datetime.now(timezone.utc).isoformat()
            return entry
        return None

    def delete(self, id: str) -> bool:
        return self.entries.pop(id, None) is not None

    def summarize(self, scope: Optional[str] = None):
        entries = list(self.entries.values())
        if scope:
            entries = [e for e in entries if e.scope == scope]
        by_type: Dict[str, int] = {}
        by_importance: Dict[str, int] = {}
        for e in entries:
            by_type[e.type] = by_type.get(e.type, 0) + 1
            by_importance[e.importance] = by_importance.get(e.importance, 0) + 1
        return {"total": len(entries), "by_type": by_type, "by_importance": by_importance}

    def expire(self) -> int:
        now = time.time() * 1000
        removed = 0
        for _id, entry in list(self.entries.items()):
            if entry.ttl:
                created_ms = time.mktime(
                    __import__("datetime").datetime.fromisoformat(entry.created).timetuple()
                ) * 1000
                if now - created_ms > entry.ttl:
                    self.entries.pop(_id, None)
                    removed += 1
        return removed

    def get_all(self) -> List[MemoryEntry]:
        return list(self.entries.values())

    @property
    def size(self) -> int:
        return len(self.entries)
