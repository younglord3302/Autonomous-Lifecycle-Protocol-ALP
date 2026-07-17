"""ALP Registry Client (v4 — The Federation Era, Pillar 3).

Mirrors the TypeScript ``@alp/cli`` ``RegistryClient``: talks to a hosted ALP
registry (an ``alp serve --registry`` instance) over the HTTP protocol in
spec/14-plugin-registry.md. Resolves ``meta.json``, downloads package files,
verifies sha256 integrity, supports semver range resolution, ``.alprc``
namespace routing, and bearer auth. Dependency-free (stdlib only) to match the
zero-dependency philosophy of the rest of the SDK.

Typical use::

    from alp_sdk import RegistryClient
    client = RegistryClient("http://127.0.0.1:4000")
    meta = client.get_meta("@community/scrum-master")
    client.install("@community/scrum-master", ".alp", "^1.0.0")
"""

import os
import re
import json
import hashlib
import urllib.parse
import urllib.request
import urllib.error
from typing import Any, Dict, List, Optional, Tuple

from .signing import sign, verify, signing_payload, resolve_public_key, fingerprint, Signature

__all__ = ["RegistryClient", "load_alprc", "semver_cmp", "satisfies"]


_LOCALHOST = re.compile(r"^(localhost|127\.0\.0\.1|\[::1\]|::1)$", re.IGNORECASE)


def _expand_env(value: str) -> str:
    return re.sub(r"\$\{([^}]+)\}", lambda m: os.environ.get(m.group(1), ""), value)


def load_alprc(cwd: str = os.getcwd()) -> Dict[str, Any]:
    """Load ``.alprc`` / ``.alprc.json`` from ``cwd`` or the user's home.

    Token values of the form ``${ENV_VAR}`` are expanded from the environment
    (spec/14 §4.2).
    """
    candidates = [
        os.path.join(cwd, ".alprc"),
        os.path.join(cwd, ".alprc.json"),
        os.path.join(os.path.expanduser("~"), ".alprc"),
        os.path.join(os.path.expanduser("~"), ".alprc.json"),
    ]
    for p in candidates:
        if os.path.exists(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    cfg = json.load(f)
                for entry in (cfg.get("auth") or {}).values():
                    if isinstance(entry, dict) and entry.get("token"):
                        entry["token"] = _expand_env(entry["token"])
                return cfg
            except (json.JSONDecodeError, OSError):
                continue
    return {}


def _parse_version(v: str) -> Tuple[int, int, int, str]:
    core, _, pre = v.replace("^", "").replace("v", "").partition("-")
    parts = [int(x) or 0 for x in core.split(".")]
    while len(parts) < 3:
        parts.append(0)
    return (parts[0], parts[1], parts[2], pre)


def semver_cmp(a: str, b: str) -> int:
    """Compare two semver strings. Pre-releases rank lower than releases."""
    pa, pb = _parse_version(a), _parse_version(b)
    for i in range(3):
        if pa[i] != pb[i]:
            return pa[i] - pb[i]
    if not pa[3] and pb[3]:
        return 1
    if pa[3] and not pb[3]:
        return -1
    return (pa[3] or "").__lt__(pb[3] or "") and -1 or (pa[3] > pb[3] and 1 or 0)


def satisfies(v: str, rng: str) -> bool:
    """Does concrete version ``v`` satisfy range ``rng`` (semver-style)?"""
    rng = rng.strip()
    if rng in ("*", "x", ""):
        return True

    caret = re.match(r"^\^(\d+)\.(\d+)\.(\d+)$", rng)
    if caret:
        maj, mn, pat = int(caret.group(1)), int(caret.group(2)), int(caret.group(3))
        if semver_cmp(v, f"{maj}.{mn}.{pat}") < 0:
            return False
        if maj > 0:
            return _parse_version(v)[0] == maj
        if mn > 0:
            return _parse_version(v)[0] == 0 and _parse_version(v)[1] == mn
        return _parse_version(v)[0] == 0 and _parse_version(v)[1] == 0 and _parse_version(v)[2] == pat

    tilde = re.match(r"^~(\d+)(?:\.(\d+))?(?:\.(\d+))?$", rng)
    if tilde:
        maj = int(tilde.group(1))
        mn = int(tilde.group(2)) if tilde.group(2) is not None else None
        if maj > 0 or mn is not None:
            if _parse_version(v)[0] != maj:
                return False
            if mn is not None and _parse_version(v)[1] != mn:
                return False
            return semver_cmp(v, f"{maj}.{mn or 0}.0") >= 0
        return _parse_version(v)[0] == maj

    xr = re.match(r"^(\d+|x|\*)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$", rng)
    if xr and ("x" in rng or "*" in rng):
        a, b, c = xr.group(1), xr.group(2), xr.group(3)
        if a not in ("x", "*") and _parse_version(v)[0] != int(a):
            return False
        if b is not None and b not in ("x", "*") and _parse_version(v)[1] != int(b):
            return False
        if c is not None and c not in ("x", "*") and _parse_version(v)[2] != int(c):
            return False
        return True

    if re.search(r">=|<=|>|<", rng):
        for cmp in rng.split():
            m = re.match(r"^(>=|<=|>|<)\s*(\d+\.\d+\.\d+)$", cmp)
            if not m:
                return False
            op, target = m.group(1), m.group(2)
            c = semver_cmp(v, target)
            if op == ">=" and not c >= 0:
                return False
            if op == "<=" and not c <= 0:
                return False
            if op == ">" and not c > 0:
                return False
            if op == "<" and not c < 0:
                return False
        return True

    return semver_cmp(v, rng) == 0


class RegistryClient:
    def __init__(self, base_url: str = "", config: Optional[Dict[str, Any]] = None, token: Optional[str] = None):
        self.base_url = base_url or os.environ.get("ALP_REGISTRY_URL") or "http://127.0.0.1:4000"
        self.config = config if config is not None else load_alprc()
        self.token = token or os.environ.get("ALP_REGISTRY_TOKEN")

    # ── .alprc routing (§4.1) ───────────────────────────────────────────
    def resolve_base_url(self, pkg_name: str) -> str:
        ns = pkg_name.replace("@", "", 1).split("/")[0]
        registries = self.config.get("registries") or {}
        mapped = registries.get("@" + ns) or registries.get(ns)
        return mapped or registries.get("default") or self.base_url

    # ── .alprc trust roots (§4.3) ───────────────────────────────────────
    def resolve_trust_entry(self, pkg_name: str) -> Optional[str]:
        """Return the `.alprc` `trustedKeys` entry for ``pkg_name``.

        An ``@ns`` entry wins, then the global ``*``. The value is either an
        inline PEM public key or a fingerprint (``alp1...``).
        """
        ns = pkg_name.replace("@", "", 1).split("/")[0]
        trusted = self.config.get("trustedKeys") or {}
        return trusted.get("@" + ns) or trusted.get(ns) or trusted.get("*")

    def is_trusted(self, pkg_name: str, signature: Dict[str, str]) -> bool:
        """True when ``signature`` is covered by the namespace's trust root."""
        entry = self.resolve_trust_entry(pkg_name)
        if not entry:
            return False
        if entry.startswith("alp1"):
            return fingerprint(signature.get("key", "")) == entry
        return entry.strip() == signature.get("key", "").strip()

    def _auth_header(self, base_url: str) -> Dict[str, str]:
        token = self.token or (self.config.get("auth") or {}).get(base_url, {}).get("token")
        return {"Authorization": "Bearer " + token} if token else {}

    def _auth_header_for_ns(self, pkg_name: str) -> Dict[str, str]:
        ns = pkg_name.replace("@", "", 1).split("/")[0]
        auth = self.config.get("auth") or {}
        token = self.token or auth.get("@" + ns, {}).get("token") or auth.get(ns, {}).get("token") or auth.get(self.resolve_base_url(pkg_name), {}).get("token")
        return {"Authorization": "Bearer " + token} if token else {}

    # ── HTTP ────────────────────────────────────────────────────────────
    def _request(self, url: str, headers: Optional[Dict[str, str]] = None, method: str = "GET", data: Optional[bytes] = None) -> Tuple[int, bytes]:
        parsed = urllib.parse.urlparse(url)
        # §5.1: registry communication MUST be over HTTPS, except loopback.
        if parsed.scheme != "https" and not _LOCALHOST.match(parsed.hostname or ""):
            raise RuntimeError(f"Refusing to use insecure registry over plain HTTP: {url} (use https://)")
        req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
        try:
            with urllib.request.urlopen(req) as resp:  # nosec - loopback/https only
                return resp.status, resp.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()

    # ── API ─────────────────────────────────────────────────────────────
    def get_meta(self, pkg_name: str) -> Dict[str, Any]:
        ns, _, name = pkg_name.replace("@", "", 1).partition("/")
        name = name or ns
        base = self.resolve_base_url(pkg_name)
        status, body = self._request(
            f"{base}/api/registry/-/{urllib.parse.quote(ns)}/{urllib.parse.quote(name)}/meta.json",
            self._auth_header(base),
        )
        if status != 200:
            raise RuntimeError(f"Package {pkg_name} not found in registry ({status})")
        return json.loads(body.decode("utf-8"))

    def resolve_version(self, meta: Dict[str, Any], rng: str = "latest") -> str:
        versions = list(meta.get("versions", {}).keys())
        if rng in ("latest", "", None):
            return meta.get("tags", {}).get("latest") or sorted(versions, key=semver_cmp)[-1]
        if rng in meta.get("versions", {}):
            return rng
        matched = sorted((v for v in versions if satisfies(v, rng)), key=semver_cmp)
        if not matched:
            raise RuntimeError(f"No version satisfying {rng} for {meta.get('name')} (have {', '.join(versions)})")
        return matched[-1]

    def install(self, pkg_name: str, target_alp_dir: str, version_range: str = "latest", trust_key: Optional[str] = None) -> str:
        import shutil

        meta = self.get_meta(pkg_name)
        version = self.resolve_version(meta, version_range)
        info = meta["versions"][version]

        safe = re.sub(r"[^a-zA-Z0-9-]", "_", pkg_name)
        dest_base = os.path.join(target_alp_dir, "packages", safe)
        os.makedirs(dest_base, exist_ok=True)

        pkg_base = self.resolve_base_url(pkg_name)
        file_url = info["url"] if info["url"].startswith("http") else f"{pkg_base}{info['url']}"
        entry = urllib.parse.unquote(file_url.rstrip("/").split("/")[-1] or "plugin.alp")
        status, body = self._request(file_url, self._auth_header(pkg_base))
        if status != 200:
            raise RuntimeError(f"Failed to download {entry} ({status})")

        # v4.2/v4.3: signature verification against a configured trust root.
        # An explicit trust_key PEM wins; otherwise fall back to the .alprc
        # trustedKeys entry (matched by namespace, then global `*`).
        signature = info.get("signature")
        if trust_key and signature:
            entry_sha = info["integrity"][len("sha256:") :] if info.get("integrity") else ""
            payload = signing_payload(
                name=pkg_name, version=version, entry=entry, entry_hash=entry_sha, dependencies=info.get("dependencies", {})
            )
            if not verify(resolve_public_key(trust_key), payload, signature):
                raise RuntimeError(f"Signature verification failed for {pkg_name}@{version}")
        elif not trust_key and signature and self.is_trusted(pkg_name, signature):
            entry_sha = info["integrity"][len("sha256:") :] if info.get("integrity") else ""
            payload = signing_payload(
                name=pkg_name, version=version, entry=entry, entry_hash=entry_sha, dependencies=info.get("dependencies", {})
            )
            if not verify(resolve_public_key(signature["key"]), payload, signature):
                raise RuntimeError(f"Signature verification failed for {pkg_name}@{version}")
        elif not trust_key and signature and self.resolve_trust_entry(pkg_name):
            raise RuntimeError(f"Signature for {pkg_name}@{version} is not from a trusted key")
        elif not trust_key and not signature and self.resolve_trust_entry(pkg_name):
            raise RuntimeError(f"Package {pkg_name}@{version} is not signed; trust root requires signatures")

        if info.get("integrity"):
            actual = "sha256:" + hashlib.sha256(body).hexdigest()
            if actual != info["integrity"]:
                raise RuntimeError(f"Integrity mismatch for {pkg_name}@{version}")

        with open(os.path.join(dest_base, entry), "wb") as f:
            f.write(body)
        manifest = dict(meta)
        manifest["version"] = version
        manifest["_installed"] = _iso_now()
        with open(os.path.join(dest_base, "alp-package.json"), "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2)
        self.write_lock(target_alp_dir, pkg_name, version, info.get("integrity"))
        return os.path.join(dest_base, entry)

    def write_lock(self, alp_dir: str, pkg_name: str, version: str, integrity: Optional[str]) -> None:
        lock_path = os.path.join(alp_dir, "registry.lock.json")
        lock: Dict[str, Any] = {}
        if os.path.exists(lock_path):
            try:
                with open(lock_path, "r", encoding="utf-8") as f:
                    lock = json.load(f)
            except (json.JSONDecodeError, OSError):
                lock = {}
        lock[pkg_name] = {"version": version, "integrity": integrity}
        with open(lock_path, "w", encoding="utf-8") as f:
            json.dump(lock, f, indent=2)

    def list(self) -> List[Dict[str, Any]]:
        base = self.config.get("registries", {}).get("default") or self.base_url
        status, body = self._request(f"{base}/api/registry", self._auth_header(base))
        if status != 200:
            raise RuntimeError(f"Registry list failed ({status})")
        return json.loads(body.decode("utf-8"))

    def search(self, query: str) -> List[Dict[str, Any]]:
        base = self.config.get("registries", {}).get("default") or self.base_url
        status, body = self._request(
            f"{base}/api/registry?q={urllib.parse.quote(query)}", self._auth_header(base)
        )
        if status != 200:
            raise RuntimeError(f"Registry search failed ({status})")
        return json.loads(body.decode("utf-8"))

    def publish(self, pkg_dir: str, sign_key: Optional[str] = None) -> Dict[str, Any]:
        """Publish ``pkg_dir`` (must contain ``alp-package.json``) to the host.

        Sends a PUT to ``/api/registry/-/<ns>/<name>`` with the manifest and
        file contents inline; the host is gated by the namespace token
        (spec/14 §4.2, registry hardening). When ``sign_key`` (a PEM Ed25519
        private key) is supplied, the version is signed and the detached
        signature travels with the publish body (v4.2 registry trust).
        """
        manifest_path = os.path.join(pkg_dir, "alp-package.json")
        if not os.path.exists(manifest_path):
            raise RuntimeError(f"Cannot publish: no alp-package.json in {pkg_dir}")
        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest = json.load(f)
        if not manifest.get("name") or not manifest.get("version") or not isinstance(manifest.get("files"), list):
            raise RuntimeError("alp-package.json must declare name, version, and files[]")
        ns, _, name = manifest["name"].replace("@", "", 1).partition("/")
        name = name or ns
        files = []
        for rel in manifest["files"]:
            with open(os.path.join(pkg_dir, rel), "r", encoding="utf-8") as f:
                files.append({"path": rel, "content": f.read()})

        # Sign the canonical payload (entry hash) before sending, if a key is set.
        entry = manifest.get("entry") or manifest["files"][0]
        with open(os.path.join(pkg_dir, entry), "rb") as f:
            entry_hash = hashlib.sha256(f.read()).hexdigest()
        signature = None
        if sign_key:
            signature = sign(
                sign_key,
                signing_payload(
                    name=manifest["name"],
                    version=manifest["version"],
                    entry=entry,
                    entry_hash=entry_hash,
                    dependencies=manifest.get("dependencies", {}),
                ),
            )

        base = self.resolve_base_url(manifest["name"])
        payload = json.dumps({**manifest, "files": files, "signature": signature}).encode("utf-8")
        status, body = self._request(
            f"{base}/api/registry/-/{urllib.parse.quote(ns)}/{urllib.parse.quote(name)}",
            {**self._auth_header_for_ns(manifest["name"]), "Content-Type": "application/json"},
            method="PUT",
            data=payload,
        )
        if status not in (200, 201):
            try:
                msg = json.loads(body.decode("utf-8")).get("error", f"publish failed ({status})")
            except (json.JSONDecodeError, OSError):
                msg = f"publish failed ({status})"
            raise RuntimeError(msg)
        return json.loads(body.decode("utf-8"))


def _iso_now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()
