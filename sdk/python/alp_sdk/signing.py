"""ALP Registry Package Signing (v4.2 — registry trust hardening).

Mirrors the TypeScript ``cli/src/signing.ts``: maintainers sign published
package versions with an Ed25519 keypair. The public key fingerprint + base64
signature travel with the version so consumers can verify authenticity against
a trust root.

Signing requires the optional ``cryptography`` package
(``pip install alp-sdk[signing]`` or ``pip install cryptography``); without it
these helpers raise ``RuntimeError`` and the rest of the (zero-dependency)
SDK still imports cleanly. Signing is OPTIONAL and backward compatible:
unsigned packages install normally; a signed package is verified only when a
trust root is configured, and a bad signature is rejected.

Typical use::

    from alp_sdk.signing import generate_keypair, fingerprint, sign, verify

    priv, pub = generate_keypair()
    sig = sign(priv, signing_payload(name="x", version="1.0.0", entry="p.alp", entry_hash="...", dependencies={}))
    verify(pub, payload, sig)  # -> True
"""

import base64
import hashlib
import json
import os
from typing import Any, Dict, Optional, Tuple

try:
    # `cryptography` is an optional dependency; signing is unavailable without
    # it so the rest of the (zero-dependency) SDK still imports cleanly.
    from cryptography.hazmat.primitives.asymmetric.ed25519 import (
        Ed25519PrivateKey,
        Ed25519PublicKey,
    )
    from cryptography.hazmat.primitives import serialization

    _HAVE_CRYPTO = True
except ImportError:  # pragma: no cover - depends on environment
    _HAVE_CRYPTO = False


__all__ = [
    "Signature",
    "fingerprint",
    "generate_keypair",
    "signing_payload",
    "sign",
    "verify",
    "resolve_public_key",
]


class Signature(Dict[str, str]):
    """Detached Ed25519 signature: ``key`` (PEM public key) + ``sig`` (base64)."""

    @property
    def key(self) -> str:
        return self["key"]

    @property
    def sig(self) -> str:
        return self["sig"]


def fingerprint(public_key_pem: str) -> str:
    """Short, stable fingerprint of a public key for display/trust matching."""
    digest = hashlib.sha256(public_key_pem.encode("utf-8")).hexdigest()
    return "alp1" + digest[:24]


def generate_keypair() -> Tuple[str, str]:
    """Generate an Ed25519 keypair, returning PEM-encoded private + public keys."""
    if not _HAVE_CRYPTO:
        raise RuntimeError("Ed25519 signing requires Python 3.12+ (cryptography stdlib API).")
    priv = Ed25519PrivateKey.generate()
    pub = priv.public_key()
    return (
        priv.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode("utf-8"),
        pub.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        ).decode("utf-8"),
    )


def signing_payload(
    *,
    name: str,
    version: str,
    entry: str,
    entry_hash: str,
    dependencies: Dict[str, str],
) -> str:
    """Canonical signing payload: a deterministic JSON of the version fields."""
    ordered = {k: dependencies[k] for k in sorted(dependencies)}
    return json.dumps(
        {
            "name": name,
            "version": version,
            "entry": entry,
            "entrySha256": entry_hash,
            "dependencies": ordered,
        },
        separators=(",", ":"),
    )


def _load_private(pem: str) -> "Ed25519PrivateKey":
    return serialization.load_pem_private_key(pem.encode("utf-8"), password=None)


def _load_public(pem: str) -> "Ed25519PublicKey":
    return serialization.load_pem_public_key(pem.encode("utf-8"))


def sign(private_key_pem: str, payload: str) -> Signature:
    """Sign ``payload`` with a PEM Ed25519 private key; return a Signature."""
    if not _HAVE_CRYPTO:
        raise RuntimeError("Ed25519 signing requires Python 3.12+ (cryptography stdlib API).")
    priv = _load_private(private_key_pem)
    sig = priv.sign(payload.encode("utf-8"))
    pub_pem = priv.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("utf-8")
    return Signature(key=pub_pem, sig=base64.b64encode(sig).decode("ascii"))


def verify(public_key_pem: str, payload: str, sig: Dict[str, str]) -> bool:
    """Verify a detached signature against a PEM public key."""
    try:
        if public_key_pem.strip() != sig.get("key", "").strip():
            return False
        pub = _load_public(public_key_pem)
        pub.verify(base64.b64decode(sig["sig"]), payload.encode("utf-8"))
        return True
    except Exception:
        return False


def resolve_public_key(input_str: str) -> str:
    """Load a PEM public key from a file path, or return the raw PEM string."""
    if os.path.exists(input_str) and input_str.endswith((".pub", ".pem", ".key")):
        with open(input_str, "r", encoding="utf-8") as f:
            return f.read()
    return input_str
