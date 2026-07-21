"""ALP Self-Sovereign Identity (v18.0.0 — V14 The Sovereign Era).

W3C DID-based agent identity without a central authority:

* ``AgentIdentity``   — creates/manages DIDs (decentralized identifiers).
* ``IdentityResolver`` — verifies presentations against a trust registry.
* ``TrustRegistry``    — maps DIDs to permission scopes and trust levels.
* ``VerifiablePresentation`` — signed identity proof from agent to verifier.

Mirrors the planned ``parser/src/identity.ts`` surface; tests live in
``sdk/python/tests/test_identity.py``.
"""

import hashlib
import json
import os
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set


IDENTITY_DIR = ".identity"
TRUST_FILE = "trust_registry.json"
KEYS_FILE = "agent_keys.json"


def identity_dir(alp_dir: str) -> str:
    return os.path.join(alp_dir, IDENTITY_DIR)


def trust_path(alp_dir: str) -> str:
    return os.path.join(identity_dir(alp_dir), TRUST_FILE)


def keys_path(alp_dir: str) -> str:
    return os.path.join(identity_dir(alp_dir), KEYS_FILE)


@dataclass
class AgentIdentity:
    """W3C DID-based agent identity."""

    did: str
    agent_id: str
    public_key: str
    created_at: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self):
        if not self.created_at:
            self.created_at = _now_iso()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "did": self.did,
            "agent_id": self.agent_id,
            "public_key": self.public_key,
            "created_at": self.created_at,
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "AgentIdentity":
        return cls(
            did=d["did"],
            agent_id=d["agent_id"],
            public_key=d["public_key"],
            created_at=d.get("created_at", ""),
            metadata=d.get("metadata", {}),
        )


@dataclass
class VerifiablePresentation:
    """Signed identity proof from agent to verifier."""

    did: str
    agent_id: str
    claims: Dict[str, Any]
    signature: str
    issued_at: str = ""

    def __post_init__(self):
        if not self.issued_at:
            self.issued_at = _now_iso()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "did": self.did,
            "agent_id": self.agent_id,
            "claims": self.claims,
            "signature": self.signature,
            "issued_at": self.issued_at,
        }

    def verify(self, public_key: str) -> bool:
        payload = json.dumps({"did": self.did, "agent_id": self.agent_id, "claims": self.claims}, sort_keys=True).encode()
        expected = hashlib.sha256(payload + public_key.encode()).hexdigest()
        return self.signature == expected


class TrustRegistry:
    """Maps DIDs to permission scopes and trust levels."""

    def __init__(self, alp_dir: str):
        self.alp_dir = alp_dir
        self._entries: Dict[str, Dict[str, Any]] = {}
        self._load()

    def _load(self) -> None:
        p = trust_path(self.alp_dir)
        if not os.path.exists(p):
            return
        try:
            with open(p, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                self._entries = data
        except Exception:
            self._entries = {}

    def _save(self) -> None:
        d = identity_dir(self.alp_dir)
        if not os.path.exists(d):
            os.makedirs(d, exist_ok=True)
        with open(trust_path(self.alp_dir), "w", encoding="utf-8") as f:
            json.dump(self._entries, f, indent=2)

    def register(self, did: str, agent_id: str, scopes: List[str], trust_level: str = "standard") -> Dict[str, Any]:
        entry = {
            "agent_id": agent_id,
            "scopes": scopes,
            "trust_level": trust_level,
            "registered_at": _now_iso(),
        }
        self._entries[did] = entry
        self._save()
        return entry

    def resolve(self, did: str) -> Optional[Dict[str, Any]]:
        return self._entries.get(did)

    def revoke(self, did: str) -> bool:
        if did in self._entries:
            del self._entries[did]
            self._save()
            return True
        return False

    def list_dids(self) -> List[str]:
        return list(self._entries.keys())

    def has_scope(self, did: str, required_scope: str) -> bool:
        entry = self._entries.get(did)
        if not entry:
            return False
        return required_scope in entry.get("scopes", [])


class IdentityResolver:
    """Verifies presentations against a trust registry."""

    def __init__(self, trust_registry: TrustRegistry):
        self.trust_registry = trust_registry

    def verify_presentation(self, presentation: VerifiablePresentation, public_key: str) -> Dict[str, Any]:
        if not presentation.verify(public_key):
            return {"valid": False, "reason": "invalid_signature"}
        entry = self.trust_registry.resolve(presentation.did)
        if not entry:
            return {"valid": False, "reason": "unknown_did"}
        return {
            "valid": True,
            "did": presentation.did,
            "agent_id": presentation.agent_id,
            "scopes": entry.get("scopes", []),
            "trust_level": entry.get("trust_level", "standard"),
        }


class AgentKeyStore:
    """Persists agent key pairs for DID operations."""

    def __init__(self, alp_dir: str):
        self.alp_dir = alp_dir
        self._keys: Dict[str, Dict[str, str]] = {}
        self._load()

    def _load(self) -> None:
        p = keys_path(self.alp_dir)
        if not os.path.exists(p):
            return
        try:
            with open(p, "r", encoding="utf-8") as f:
                self._keys = json.load(f)
        except Exception:
            self._keys = {}

    def _save(self) -> None:
        d = identity_dir(self.alp_dir)
        if not os.path.exists(d):
            os.makedirs(d, exist_ok=True)
        with open(keys_path(self.alp_dir), "w", encoding="utf-8") as f:
            json.dump(self._keys, f, indent=2)

    def store_key(self, did: str, public_key: str, private_key: str) -> None:
        self._keys[did] = {"public_key": public_key, "private_key": private_key}
        self._save()

    def get_key(self, did: str) -> Optional[Dict[str, str]]:
        return self._keys.get(did)

    def remove_key(self, did: str) -> bool:
        if did in self._keys:
            del self._keys[did]
            self._save()
            return True
        return False


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def generate_keypair() -> tuple[str, str]:
    private_key = uuid.uuid4().hex
    public_key = hashlib.sha256(private_key.encode()).hexdigest()
    return public_key, private_key


def create_did(agent_id: str, public_key: str) -> str:
    key_hash = hashlib.sha256(public_key.encode()).hexdigest()[:16]
    return f"did:alp:{agent_id}:{key_hash}"
