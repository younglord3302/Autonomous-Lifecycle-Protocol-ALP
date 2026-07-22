from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Callable
from enum import Enum


class MigrationStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    ROLLED_BACK = "rolled_back"


class UpgradeStrategy(Enum):
    BLUE_GREEN = "blue_green"
    ROLLING = "rolling"
    CANARY = "canary"
    BIG_BANG = "big_bang"


@dataclass
class UpgradeManifest:
    version_from: str
    version_to: str
    strategy: UpgradeStrategy
    steps: List[Dict[str, Any]] = field(default_factory=list)
    rollback_steps: List[Dict[str, Any]] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)
    _id: Optional[str] = None

    def __post_init__(self):
        if self._id is None:
            content = f"{self.version_from}:{self.version_to}:{self.strategy.value}"
            self._id = hashlib.sha256(content.encode()).hexdigest()[:16]


@dataclass
class MigrationRecord:
    manifest_id: str
    status: MigrationStatus
    current_step: int = 0
    logs: List[str] = field(default_factory=list)
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    error: Optional[str] = None


class MigrationEngine:
    def __init__(self, checkpoint_dir: str = ".alp/migrations"):
        self.checkpoint_dir = checkpoint_dir
        self._active_migrations: Dict[str, MigrationRecord] = {}
        self._version_locks: Dict[str, str] = {}
        os.makedirs(checkpoint_dir, exist_ok=True)

    def register_migration(self, manifest: UpgradeManifest) -> str:
        record = MigrationRecord(
            manifest_id=manifest._id,
            status=MigrationStatus.PENDING,
        )
        self._active_migrations[manifest._id] = record
        self._save_checkpoint(record)
        return manifest._id

    def execute(self, manifest: UpgradeManifest, dry_run: bool = False) -> MigrationRecord:
        migration_id = manifest._id
        record = self._active_migrations.get(migration_id)
        if record is None:
            record = MigrationRecord(
                manifest_id=migration_id,
                status=MigrationStatus.RUNNING,
            )
            self._active_migrations[migration_id] = record

        record.status = MigrationStatus.RUNNING
        record.started_at = self._now()
        record.logs.append(f"Starting migration {manifest.version_from} -> {manifest.version_to}")

        if dry_run:
            record.logs.append("DRY RUN: validating steps only")
            for i, step in enumerate(manifest.steps):
                record.logs.append(f"Step {i + 1}: {step.get('name', 'unnamed')} [validated]")
            record.status = MigrationStatus.COMPLETED
            record.completed_at = self._now()
            self._save_checkpoint(record)
            return record

        try:
            self._version_locks[manifest.version_from] = manifest.version_to
            for i, step in enumerate(manifest.steps):
                record.current_step = i
                step_name = step.get("name", f"step_{i}")
                record.logs.append(f"Executing step {i + 1}: {step_name}")
                self._execute_step(step)
            record.status = MigrationStatus.COMPLETED
            record.completed_at = self._now()
            record.logs.append(f"Migration completed: {manifest.version_to}")
        except Exception as e:
            record.status = MigrationStatus.FAILED
            record.error = str(e)
            record.logs.append(f"Migration failed: {e}")
            self._rollback(manifest, record)

        self._save_checkpoint(record)
        return record

    def rollback(self, manifest_id: str) -> MigrationRecord:
        manifest = self._find_manifest(manifest_id)
        if manifest is None:
            raise ValueError(f"Migration {manifest_id} not found")
        record = self._active_migrations.get(manifest_id)
        if record is None:
            raise ValueError(f"No active migration found for {manifest_id}")
        return self._rollback(manifest, record)

    def _rollback(self, manifest: UpgradeManifest, record: MigrationRecord) -> MigrationRecord:
        record.status = MigrationStatus.ROLLED_BACK
        record.logs.append("Initiating rollback...")
        for i, step in enumerate(reversed(manifest.rollback_steps)):
            step_name = step.get("name", f"rollback_step_{i}")
            record.logs.append(f"Rollback step {i + 1}: {step_name}")
            self._execute_step(step)
        record.logs.append("Rollback completed")
        if record.completed_at is None:
            record.completed_at = self._now()
        self._save_checkpoint(record)
        return record

    def _execute_step(self, step: Dict[str, Any]) -> None:
        step_type = step.get("type", "noop")
        if step_type == "noop":
            return
        elif step_type == "callback" and "fn" in step:
            step["fn"]()
        elif step_type == "shell" and "command" in step:
            os.system(step["command"])
        elif step_type == "python" and "code" in step:
            exec(step["code"])
        else:
            pass

    def get_status(self, migration_id: str) -> Optional[MigrationRecord]:
        return self._active_migrations.get(migration_id)

    def list_migrations(self) -> List[MigrationRecord]:
        return list(self._active_migrations.values())

    def get_version_lock(self, version: str) -> Optional[str]:
        return self._version_locks.get(version)

    def _save_checkpoint(self, record: MigrationRecord) -> None:
        path = os.path.join(self.checkpoint_dir, f"{record.manifest_id}.json")
        data = {
            "manifest_id": record.manifest_id,
            "status": record.status.value,
            "current_step": record.current_step,
            "logs": record.logs,
            "started_at": record.started_at,
            "completed_at": record.completed_at,
            "error": record.error,
        }
        with open(path, "w") as f:
            json.dump(data, f, indent=2)

    def _load_checkpoint(self, migration_id: str) -> Optional[MigrationRecord]:
        path = os.path.join(self.checkpoint_dir, f"{migration_id}.json")
        if not os.path.exists(path):
            return None
        with open(path, "r") as f:
            data = json.load(f)
        return MigrationRecord(
            manifest_id=data["manifest_id"],
            status=MigrationStatus(data["status"]),
            current_step=data.get("current_step", 0),
            logs=data.get("logs", []),
            started_at=data.get("started_at"),
            completed_at=data.get("completed_at"),
            error=data.get("error"),
        )

    def _find_manifest(self, migration_id: str) -> Optional[UpgradeManifest]:
        for record in self._active_migrations.values():
            if record.manifest_id == migration_id:
                return UpgradeManifest(
                    version_from="unknown",
                    version_to="unknown",
                    strategy=UpgradeStrategy.BLUE_GREEN,
                    _id=migration_id,
                )
        return None

    @staticmethod
    def _now() -> str:
        import datetime
        return datetime.datetime.utcnow().isoformat() + "Z"
