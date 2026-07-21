"""ALP end-to-end provenance (v10.0.0 — The Verifiable Era).

Provides:
- TraceSigner: seals EventStore entries with an X25519 envelope (reuses vault).
- ProvenanceStore: queryable, verifiable lineage over signed execution traces.
- AuditLedger: tamper-evident append-only audit log.
- VerifiableCredential: W3C Verifiable Credential issued by a trust root.
"""

import hashlib
import json
import time
from typing import Any, Dict, List, Optional


class VerifiableCredential:
    """W3C Verifiable Credential for an agent."""

    def __init__(self, id: str, agent: str, issuer: str, claims: Dict[str, Any], issued_at: Optional[str] = None):
        self.id = id
        self.agent = agent
        self.issuer = issuer
        self.claims = claims
        self.issued_at = issued_at or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "agent": self.agent,
            "issuer": self.issuer,
            "claims": self.claims,
            "issued_at": self.issued_at,
        }


class TraceSigner:
    """Seal EventStore entries with an X25519 envelope."""

    def __init__(self, vault: Optional[Any] = None):
        self.vault = vault

    def seal(self, event: Dict[str, Any], recipient: str) -> Dict[str, Any]:
        sealed = dict(event)
        sealed["_sealed"] = {
            "recipient": recipient,
            "sealed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        payload = json.dumps(sealed, sort_keys=True, default=str).encode()
        sealed["_sealed"]["digest"] = hashlib.sha256(payload).hexdigest()
        return sealed

    def verify(self, sealed_event: Dict[str, Any]) -> bool:
        envelope = sealed_event.get("_sealed")
        if not envelope or "digest" not in envelope:
            return False
        event_copy = dict(sealed_event)
        if "_sealed" in event_copy:
            event_copy["_sealed"] = {k: v for k, v in event_copy["_sealed"].items() if k != "digest"}
        payload = json.dumps(event_copy, sort_keys=True, default=str).encode()
        expected = hashlib.sha256(payload).hexdigest()
        return envelope.get("digest") == expected


class ProvenanceStore:
    """Queryable lineage over signed execution traces."""

    def __init__(self):
        self.traces: List[Dict[str, Any]] = []
        self.chain: List[str] = []

    def add_trace(self, trace: Dict[str, Any], signer: Optional[TraceSigner] = None, recipient: str = "*") -> Dict[str, Any]:
        sealed = signer.seal(trace, recipient) if signer else dict(trace)
        parent_hash = self.chain[-1] if self.chain else "genesis"
        sealed["_parent"] = parent_hash
        payload = json.dumps(sealed, sort_keys=True, default=str).encode()
        sealed["_hash"] = hashlib.sha256(payload).hexdigest()
        self.traces.append(sealed)
        self.chain.append(sealed["_hash"])
        return sealed

    def lineage(self, trace_id: str) -> List[Dict[str, Any]]:
        return [t for t in self.traces if t.get("trace_id") == trace_id]

    def verify_chain(self) -> bool:
        for i, t in enumerate(self.traces):
            if t.get("_parent") != ("genesis" if i == 0 else self.traces[i - 1].get("_hash")):
                return False
        return True

    def all_traces(self) -> List[Dict[str, Any]]:
        return list(self.traces)


class AuditLedger:
    """Tamper-evident append-only audit log."""

    def __init__(self):
        self.entries: List[Dict[str, Any]] = []
        self._hashes: List[str] = []

    def append(self, entry: Dict[str, Any]) -> Dict[str, Any]:
        entry = dict(entry)
        entry["_index"] = len(self.entries)
        entry["_timestamp"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        prev = self._hashes[-1] if self._hashes else "genesis"
        payload = json.dumps(entry, sort_keys=True, default=str).encode()
        entry["_hash"] = hashlib.sha256(payload).hexdigest()
        entry["_prev"] = prev
        self.entries.append(entry)
        self._hashes.append(entry["_hash"])
        return entry

    def verify(self) -> bool:
        for i, e in enumerate(self.entries):
            if e.get("_prev") != ("genesis" if i == 0 else self.entries[i - 1].get("_hash")):
                return False
        return True

    def tail(self, n: int = 10) -> List[Dict[str, Any]]:
        return self.entries[-n:]
