"""ALP encrypted secrets vault (v8.4.0 - Python SDK parity).

Mirrors the TypeScript ``Vault``: stores secrets encrypted at rest using an
age-style X25519 envelope + AES-256-GCM. Each secret is sealed to one or more
recipient public keys; only the holder of the matching X25519 private key can
unseal it.

Encryption requires the optional ``cryptography`` package
(``pip install alp-sdk[vault]``). Without it, ``Vault`` raises ``RuntimeError``,
mirroring the optional signing dependency (spec/08). The rest of the
(zero-dependency) SDK still imports cleanly. The TS SDK uses Node's built-in
``crypto`` so encryption is always available there (spec/19).
"""
from __future__ import annotations


import base64
import json
import os
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple, Union

try:
    from cryptography.hazmat.primitives.asymmetric.x25519 import (
        X25519PrivateKey,
        X25519PublicKey,
    )
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF
    from cryptography.hazmat.primitives.serialization import (
        Encoding,
        PublicFormat,
        PrivateFormat,
        NoEncryption,
    )

    _HAVE_CRYPTO = True
except ImportError:  # pragma: no cover - depends on environment
    _HAVE_CRYPTO = False


ALGO_NONCE = 12
WRAP_NONCE = b"\x00" * 12
HKDF_INFO = b"alp-vault-v8"


@dataclass
class SealedSecret:
    id: str
    recipients: Dict[str, str]
    nonce: str
    ciphertext: str
    created_at: str
    rotated_at: Optional[str] = None


@dataclass
class VaultAuditEntry:
    ts: str
    action: str
    id: str
    by: str = "anonymous"


class Vault:
    """Encrypted secrets store (spec/19)."""

    def __init__(self, opts: Optional[Dict[str, Any]] = None):
        if not _HAVE_CRYPTO:
            raise RuntimeError(
                "alp_sdk.vault requires the optional 'cryptography' package: "
                "pip install alp-sdk[vault]"
            )
        opts = opts or {}
        cwd = os.getcwd()
        dir_ = opts.get("dir") or os.path.join(cwd, ".alp", ".vault")
        self.store_path = opts.get("store_file") or os.path.join(dir_, "store.jsonl")
        self.audit_path = opts.get("audit_file") or os.path.join(dir_, "audit.jsonl")

    # ── storage ──────────────────────────────────────────────────────────
    def _ensure_dir(self) -> None:
        os.makedirs(os.path.dirname(self.store_path), exist_ok=True)

    def _read_store(self) -> List[SealedSecret]:
        if not os.path.exists(self.store_path):
            return []
        with open(self.store_path, "r", encoding="utf-8") as fh:
            text = fh.read().strip()
        if not text:
            return []
        return [SealedSecret(**json.loads(line)) for line in text.splitlines() if line.strip()]

    def _write_store(self, secrets: List[SealedSecret]) -> None:
        self._ensure_dir()
        with open(self.store_path, "w", encoding="utf-8") as fh:
            for s in secrets:
                fh.write(json.dumps(s.__dict__) + "\n")

    def _append_audit(self, entry: VaultAuditEntry) -> None:
        self._ensure_dir()
        with open(self.audit_path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry.__dict__) + "\n")

    # ── public API ─────────────────────────────────────────────────────────
    def set(self, id: str, plaintext: str, recipients: List[Union[str, bytes]], by: str = "anonymous") -> SealedSecret:
        pubs = [self._load_public(r) for r in recipients]
        data_key = os.urandom(32)
        nonce = os.urandom(ALGO_NONCE)
        aes = AESGCM(data_key)
        ciphertext = aes.encrypt(nonce, plaintext.encode("utf-8"), None)

        sealed: Dict[str, str] = {}
        for pub in pubs:
            fp = self._fingerprint(pub)
            sealed[fp] = self._seal_data_key(data_key, pub)

        record = SealedSecret(
            id=id,
            recipients=sealed,
            nonce=base64.b64encode(nonce).decode("ascii"),
            ciphertext=base64.b64encode(ciphertext).decode("ascii"),
            created_at=self._now(),
            rotated_at=None,
        )
        secrets = [s for s in self._read_store() if s.id != id]
        secrets.append(record)
        self._write_store(secrets)
        self._append_audit(VaultAuditEntry(ts=record.created_at, action="set", id=id, by=by))
        return record

    def get(self, id: str, private_key: Union[str, bytes], by: str = "anonymous") -> str:
        secret = next((s for s in self._read_store() if s.id == id), None)
        if secret is None:
            raise KeyError(f"Vault: secret '{id}' not found")
        priv = self._load_private(private_key)
        fp = self._fingerprint(priv.public_key())
        blob = secret.recipients.get(fp)
        if blob is None:
            raise PermissionError(f"Vault: recipient '{fp}' is not authorized for '{id}'")
        data_key = self._open_data_key(blob, priv)
        nonce = base64.b64decode(secret.nonce)
        ct = base64.b64decode(secret.ciphertext)
        aes = AESGCM(data_key)
        plaintext = aes.decrypt(nonce, ct, None).decode("utf-8")
        self._append_audit(VaultAuditEntry(ts=self._now(), action="get", id=id, by=fp))
        return plaintext

    def list(self, by: str = "anonymous") -> List[Dict[str, Any]]:
        out = [
            {"id": s.id, "created_at": s.created_at, "rotated_at": s.rotated_at}
            for s in self._read_store()
        ]
        self._append_audit(VaultAuditEntry(ts=self._now(), action="list", id="*", by=by))
        return out

    def rotate(self, id: str, private_key: Union[str, bytes], by: str = "anonymous") -> SealedSecret:
        plaintext = self.get(id, private_key, by)
        secret = next(s for s in self._read_store() if s.id == id)
        priv = self._load_private(private_key)
        rotated = self.set(id, plaintext, [priv.public_key()], by)
        rotated.rotated_at = self._now()
        secrets = [s if s.id != id else rotated for s in self._read_store()]
        self._write_store(secrets)
        self._append_audit(VaultAuditEntry(ts=rotated.rotated_at, action="rotate", id=id, by=by))
        return rotated

    def audit(self) -> List[VaultAuditEntry]:
        if not os.path.exists(self.audit_path):
            return []
        with open(self.audit_path, "r", encoding="utf-8") as fh:
            text = fh.read().strip()
        if not text:
            return []
        return [VaultAuditEntry(**json.loads(line)) for line in text.splitlines() if line.strip()]

    # ── crypto helpers ──────────────────────────────────────────────────────
    @staticmethod
    def _fingerprint(pub: "X25519PublicKey") -> str:
        raw = pub.public_bytes(Encoding.Raw, PublicFormat.Raw)
        digest = hashes.Hash(hashes.SHA256())
        digest.update(raw)
        return "age1" + digest.finalize().hex()[:38]

    @staticmethod
    def _seal_data_key(data_key: bytes, recipient_pub: "X25519PublicKey") -> str:
        eph_priv = X25519PrivateKey.generate()
        shared = eph_priv.exchange(recipient_pub)
        wrap_key = HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=HKDF_INFO).derive(shared)
        aes = AESGCM(wrap_key)
        wrapped = aes.encrypt(WRAP_NONCE, data_key, None)
        eph_pub_raw = eph_priv.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
        return base64.b64encode(eph_pub_raw + wrapped).decode("ascii")

    @staticmethod
    def _open_data_key(blob: str, recipient_priv: "X25519PrivateKey") -> bytes:
        raw = base64.b64decode(blob)
        eph_pub_raw = raw[:32]
        wrapped = raw[32:]
        eph_pub = X25519PublicKey.from_public_bytes(eph_pub_raw)
        shared = recipient_priv.exchange(eph_pub)
        wrap_key = HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=HKDF_INFO).derive(shared)
        aes = AESGCM(wrap_key)
        return aes.decrypt(WRAP_NONCE, wrapped, None)

    @staticmethod
    def _load_public(pem_or_raw):
        if isinstance(pem_or_raw, X25519PublicKey):
            return pem_or_raw
        if isinstance(pem_or_raw, bytes):
            return X25519PublicKey.from_public_bytes(pem_or_raw)
        if pem_or_raw.startswith("-----BEGIN"):
            return serialization_load(pem_or_raw, False)
        return X25519PublicKey.from_public_bytes(base64.b64decode(pem_or_raw))

    @staticmethod
    def _load_private(pem_or_raw: Union[str, bytes]):
        if isinstance(pem_or_raw, bytes):
            return X25519PrivateKey.from_private_bytes(pem_or_raw)
        if pem_or_raw.startswith("-----BEGIN"):
            return serialization_load(pem_or_raw, True)
        return X25519PrivateKey.from_private_bytes(base64.b64decode(pem_or_raw))

    @staticmethod
    def _now() -> str:
        from datetime import datetime, timezone

        return datetime.now(timezone.utc).isoformat()


def serialization_load(pem: str, is_private: bool):
    from cryptography.hazmat.primitives.serialization import load_pem_private_key, load_pem_public_key

    if is_private:
        return load_pem_private_key(pem.encode("utf-8"), password=None)
    return load_pem_public_key(pem.encode("utf-8"))
