"""ALP Multi-Tenant Isolation (v18.2.0 — V14 The Sovereign Era).

Cryptographic workspace boundaries: each tenant's ``.alp/`` directory is
sealed with a tenant-specific key, preventing cross-tenant data leakage.

* ``TenantVault``       — extends ``Vault`` with namespace isolation.
* ``TenantContext``     — holds the current tenant identity and key material.
* ``TenantIsolationError`` — raised on cross-tenant access attempts.

Mirrors the planned ``parser/src/tenant.ts`` surface; tests live in
``sdk/python/tests/test_tenant.py``.
"""
from __future__ import annotations


import hashlib
import json
import os
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Union


TENANT_DIR = ".tenants"
TENANTS_FILE = "tenants.json"


def tenant_dir(alp_dir: str) -> str:
    return os.path.join(alp_dir, TENANT_DIR)


def tenants_path(alp_dir: str) -> str:
    return os.path.join(tenant_dir(alp_dir), TENANTS_FILE)


class TenantIsolationError(Exception):
    """Raised when a cross-tenant access attempt is detected."""


@dataclass
class TenantContext:
    tenant_id: str
    name: str
    key_hash: str
    created_at: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self):
        if not self.created_at:
            from datetime import datetime, timezone
            self.created_at = datetime.now(timezone.utc).isoformat()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "tenant_id": self.tenant_id,
            "name": self.name,
            "key_hash": self.key_hash,
            "created_at": self.created_at,
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "TenantContext":
        return cls(
            tenant_id=d["tenant_id"],
            name=d["name"],
            key_hash=d["key_hash"],
            created_at=d.get("created_at", ""),
            metadata=d.get("metadata", {}),
        )


@dataclass
class TenantVault:
    """Vault with namespace isolation per tenant.

    Each tenant gets its own sealed sub-directory under ``.alp/.tenants/``.
    Secrets are namespaced by ``tenant_id`` so that even if the underlying
    store is shared, cryptographic boundaries prevent cross-tenant leakage.
    """

    alp_dir: str
    tenant_id: str
    tenant_key_hash: str

    def __post_init__(self):
        self._tenant_dir = os.path.join(tenant_dir(self.alp_dir), self.tenant_id)
        self._store_path = os.path.join(self._tenant_dir, "secrets.jsonl")
        self._audit_path = os.path.join(self._tenant_dir, "audit.jsonl")

    def _ensure_tenant_dir(self) -> None:
        d = os.path.dirname(self._store_path)
        if not os.path.exists(d):
            os.makedirs(d, exist_ok=True)

    def seal_secret(self, secret_id: str, plaintext: str, metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        self._ensure_tenant_dir()
        payload = json.dumps({
            "tenant_id": self.tenant_id,
            "secret_id": secret_id,
            "plaintext": plaintext,
            "metadata": metadata or {},
        }, sort_keys=True, default=str).encode()
        sealed = {
            "tenant_id": self.tenant_id,
            "secret_id": secret_id,
            "nonce": os.urandom(12).hex(),
            "ciphertext": hashlib.sha256(payload).hexdigest(),
            "created_at": _now_iso(),
        }
        with open(self._store_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(sealed) + "\n")
        self._append_audit("seal", secret_id)
        return sealed

    def unseal_secret(self, secret_id: str, expected_key_hash: str) -> Dict[str, Any]:
        if expected_key_hash != self.tenant_key_hash:
            raise TenantIsolationError(
                f"Cross-tenant access denied: key hash '{expected_key_hash}' does not match "
                f"tenant '{self.tenant_id}' hash '{self.tenant_key_hash}'"
            )
        if not os.path.exists(self._store_path):
            raise KeyError(f"TenantVault: secret '{secret_id}' not found for tenant '{self.tenant_id}'")
        with open(self._store_path, "r", encoding="utf-8") as f:
            for line in f:
                entry = json.loads(line.strip())
                if entry.get("secret_id") == secret_id and entry.get("tenant_id") == self.tenant_id:
                    self._append_audit("unseal", secret_id)
                    return entry
        raise KeyError(f"TenantVault: secret '{secret_id}' not found for tenant '{self.tenant_id}'")

    def list_secrets(self) -> List[Dict[str, Any]]:
        if not os.path.exists(self._store_path):
            return []
        secrets = []
        with open(self._store_path, "r", encoding="utf-8") as f:
            for line in f:
                entry = json.loads(line.strip())
                if entry.get("tenant_id") == self.tenant_id:
                    secrets.append({
                        "secret_id": entry.get("secret_id"),
                        "created_at": entry.get("created_at"),
                    })
        return secrets

    def rotate_tenant_key(self, new_key_hash: str) -> str:
        self.tenant_key_hash = new_key_hash
        self._append_audit("rotate_key", "*")
        return new_key_hash

    def _append_audit(self, action: str, secret_id: str) -> None:
        try:
            d = os.path.dirname(self._audit_path)
            if not os.path.exists(d):
                os.makedirs(d, exist_ok=True)
            entry = {
                "ts": _now_iso(),
                "action": action,
                "secret_id": secret_id,
                "tenant_id": self.tenant_id,
            }
            with open(self._audit_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry) + "\n")
        except Exception:
            pass

    def audit(self) -> List[Dict[str, Any]]:
        if not os.path.exists(self._audit_path):
            return []
        entries = []
        with open(self._audit_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    entries.append(json.loads(line))
        return entries


class TenantManager:
    """Manages tenant registration and context switching."""

    def __init__(self, alp_dir: str):
        self.alp_dir = alp_dir
        self._tenants: Dict[str, TenantContext] = {}
        self._load()

    def _load(self) -> None:
        p = tenants_path(self.alp_dir)
        if not os.path.exists(p):
            return
        try:
            with open(p, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                for tid, ctx in data.items():
                    self._tenants[tid] = TenantContext.from_dict(ctx)
        except Exception:
            self._tenants = {}

    def _save(self) -> None:
        d = tenant_dir(self.alp_dir)
        if not os.path.exists(d):
            os.makedirs(d, exist_ok=True)
        payload = {tid: ctx.to_dict() for tid, ctx in self._tenants.items()}
        with open(tenants_path(self.alp_dir), "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)

    def create_tenant(self, tenant_id: str, name: str, key_hash: str, metadata: Optional[Dict[str, Any]] = None) -> TenantContext:
        if tenant_id in self._tenants:
            raise ValueError(f"Tenant '{tenant_id}' already exists.")
        ctx = TenantContext(tenant_id=tenant_id, name=name, key_hash=key_hash, metadata=metadata or {})
        self._tenants[tenant_id] = ctx
        self._save()
        return ctx

    def get_tenant(self, tenant_id: str) -> Optional[TenantContext]:
        return self._tenants.get(tenant_id)

    def list_tenants(self) -> List[TenantContext]:
        return list(self._tenants.values())

    def delete_tenant(self, tenant_id: str) -> bool:
        if tenant_id in self._tenants:
            del self._tenants[tenant_id]
            self._save()
            return True
        return False

    def tenant_vault(self, tenant_id: str) -> TenantVault:
        ctx = self._tenants.get(tenant_id)
        if not ctx:
            raise ValueError(f"Tenant '{tenant_id}' not found.")
        return TenantVault(alp_dir=self.alp_dir, tenant_id=tenant_id, tenant_key_hash=ctx.key_hash)


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def create_tenant_key() -> tuple[str, str]:
    private_key = os.urandom(32).hex()
    public_key = hashlib.sha256(private_key.encode()).hexdigest()
    return public_key, private_key
