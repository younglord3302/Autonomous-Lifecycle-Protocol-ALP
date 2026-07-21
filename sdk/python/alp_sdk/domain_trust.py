"""ALP Cross-Domain Trust (v18.4.0 — V14 The Sovereign Era).

Trust bootstrapping between sovereign domains:

* ``DomainTrustAnchor`` — exchanges signed trust roots with foreign domains.
* ``TrustRoot``        — signed root of trust for a domain.
* ``DomainLink``       — bilateral trust relationship between domains.

Enables cross-domain agent authentication without a global CA.
``alp trust link <domain>`` establishes bilateral trust.

Mirrors the planned ``parser/src/domain_trust.ts`` surface; tests live in
``sdk/python/tests/test_domain_trust.py``.
"""

import hashlib
import json
import os
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Set


TRUST_DIR = ".trust"
DOMAINS_FILE = "domains.jsonl"
LINKS_FILE = "links.jsonl"


def trust_dir(alp_dir: str) -> str:
    return os.path.join(alp_dir, TRUST_DIR)


def domains_path(alp_dir: str) -> str:
    return os.path.join(trust_dir(alp_dir), DOMAINS_FILE)


def links_path(alp_dir: str) -> str:
    return os.path.join(trust_dir(alp_dir), LINKS_FILE)


class TrustStatus(str, Enum):
    ACTIVE = "active"
    PENDING = "pending"
    REVOKED = "revoked"
    EXPIRED = "expired"


@dataclass
class TrustRoot:
    domain_id: str
    public_key: str
    signature: str = ""
    created_at: str = ""
    expires_at: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self):
        if not self.created_at:
            self.created_at = _now_iso()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "domain_id": self.domain_id,
            "public_key": self.public_key,
            "signature": self.signature,
            "created_at": self.created_at,
            "expires_at": self.expires_at,
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "TrustRoot":
        return cls(
            domain_id=d["domain_id"],
            public_key=d["public_key"],
            signature=d["signature"],
            created_at=d.get("created_at", ""),
            expires_at=d.get("expires_at"),
            metadata=d.get("metadata", {}),
        )

    def sign(self, private_key: str) -> None:
        payload = json.dumps({
            "domain_id": self.domain_id,
            "public_key": self.public_key,
            "created_at": self.created_at,
        }, sort_keys=True).encode()
        self.signature = hashlib.sha256(payload + private_key.encode()).hexdigest()

    def verify(self, private_key: str) -> bool:
        payload = json.dumps({
            "domain_id": self.domain_id,
            "public_key": self.public_key,
            "created_at": self.created_at,
        }, sort_keys=True).encode()
        expected = hashlib.sha256(payload + private_key.encode()).hexdigest()
        return self.signature == expected


@dataclass
class DomainLink:
    link_id: str
    local_domain: str
    remote_domain: str
    status: str = "pending"
    created_at: str = ""
    accepted_at: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self):
        if not self.created_at:
            self.created_at = _now_iso()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "link_id": self.link_id,
            "local_domain": self.local_domain,
            "remote_domain": self.remote_domain,
            "status": self.status,
            "created_at": self.created_at,
            "accepted_at": self.accepted_at,
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "DomainLink":
        return cls(
            link_id=d["link_id"],
            local_domain=d["local_domain"],
            remote_domain=d["remote_domain"],
            status=d.get("status", "pending"),
            created_at=d.get("created_at", ""),
            accepted_at=d.get("accepted_at", ""),
            metadata=d.get("metadata", {}),
        )


@dataclass
class DomainTrustAnchor:
    alp_dir: str
    domain_id: str
    private_key: str

    def __post_init__(self):
        self._domain_dir = os.path.join(trust_dir(self.alp_dir), "domains", self.domain_id)
        self._root_path = os.path.join(self._domain_dir, "root.json")

    def create_domain(self, metadata: Optional[Dict[str, Any]] = None) -> TrustRoot:
        public_key = hashlib.sha256(self.private_key.encode()).hexdigest()
        root = TrustRoot(domain_id=self.domain_id, public_key=public_key, signature="", metadata=metadata or {})
        root.sign(self.private_key)
        d = os.path.dirname(self._root_path)
        if not os.path.exists(d):
            os.makedirs(d, exist_ok=True)
        with open(self._root_path, "w", encoding="utf-8") as f:
            json.dump(root.to_dict(), f, indent=2)
        return root

    def get_trust_root(self) -> Optional[TrustRoot]:
        if not os.path.exists(self._root_path):
            return None
        with open(self._root_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return TrustRoot.from_dict(data)

    def export_trust_root(self) -> str:
        root = self.get_trust_root()
        if not root:
            raise ValueError(f"No trust root found for domain '{self.domain_id}'.")
        return json.dumps(root.to_dict(), indent=2)

    def import_trust_root(self, remote_root_json: str, expected_domain_id: str) -> TrustRoot:
        data = json.loads(remote_root_json)
        root = TrustRoot.from_dict(data)
        if root.domain_id != expected_domain_id:
            raise ValueError(f"Domain ID mismatch: expected '{expected_domain_id}', got '{root.domain_id}'.")
        if not root.verify(self.private_key):
            raise ValueError("Trust root signature verification failed.")
        return root


class DomainTrustManager:
    """Manages trust links between local and remote domains."""

    def __init__(self, alp_dir: str, local_domain: str):
        self.alp_dir = alp_dir
        self.local_domain = local_domain
        self._links: Dict[str, DomainLink] = {}
        self._load()

    def _load(self) -> None:
        p = links_path(self.alp_dir)
        if not os.path.exists(p):
            return
        try:
            with open(p, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    entry = json.loads(line)
                    link = DomainLink.from_dict(entry)
                    self._links[link.link_id] = link
        except Exception:
            self._links = {}

    def _save_link(self, link: DomainLink) -> None:
        d = trust_dir(self.alp_dir)
        if not os.path.exists(d):
            os.makedirs(d, exist_ok=True)
        with open(links_path(self.alp_dir), "a", encoding="utf-8") as f:
            f.write(json.dumps(link.to_dict()) + "\n")

    def link_domain(self, remote_domain: str) -> DomainLink:
        existing = [l for l in self._links.values() if l.remote_domain == remote_domain]
        if existing:
            return existing[0]
        link_id = f"link-{uuid.uuid4().hex[:12]}"
        link = DomainLink(link_id=link_id, local_domain=self.local_domain, remote_domain=remote_domain, status="pending")
        self._links[link_id] = link
        self._save_link(link)
        return link

    def accept_link(self, link_id: str) -> Optional[DomainLink]:
        link = self._links.get(link_id)
        if not link:
            return None
        link.status = "active"
        link.accepted_at = _now_iso()
        self._save_link(link)
        return link

    def revoke_link(self, link_id: str) -> bool:
        link = self._links.get(link_id)
        if not link:
            return False
        link.status = "revoked"
        self._save_link(link)
        return True

    def get_link(self, link_id: str) -> Optional[DomainLink]:
        return self._links.get(link_id)

    def get_link_by_domain(self, remote_domain: str) -> Optional[DomainLink]:
        for link in self._links.values():
            if link.remote_domain == remote_domain:
                return link
        return None

    def list_links(self) -> List[DomainLink]:
        return list(self._links.values())

    def list_active_links(self) -> List[DomainLink]:
        return [l for l in self._links.values() if l.status == "active"]


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def create_domain_keypair() -> tuple[str, str]:
    private_key = os.urandom(32).hex()
    public_key = hashlib.sha256(private_key.encode()).hexdigest()
    return public_key, private_key
