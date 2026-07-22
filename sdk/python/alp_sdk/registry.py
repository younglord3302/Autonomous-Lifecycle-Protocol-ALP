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
from __future__ import annotations


import os
import re
import json
import hashlib
import functools
import urllib.parse
import urllib.request
import urllib.error
from typing import Any, Dict, List, Optional, Tuple

try:
    from .signing import (
        signing_payload,
        verify,
        sign,
        fingerprint,
        resolve_public_key,
        _HAVE_CRYPTO,
    )
except ImportError:  # pragma: no cover
    signing_payload = None
    verify = None
    sign = None
    fingerprint = None
    resolve_public_key = None
    _HAVE_CRYPTO = False

__all__ = [
    "RegistryClient",
    "load_alprc",
    "semver_cmp",
    "satisfies",
    "verify_version_signature",
    "VersionConflictError",
    "parse_registry_alias",
    "resolve_dependency_graph",
]


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


def verify_version_signature(
    pkg_name: str,
    version: str,
    info: Dict[str, Any],
    trust_roots: Optional[Dict[str, str]] = None,
    explicit_trust_pem: Optional[str] = None,
) -> Dict[str, Any]:
    """Shared, source-agnostic signature verification (v4.5).

    Mirrors the TypeScript ``RegistryStore.verifyVersionSignature``: checks a
    version's ``signature`` against a trust root without installing. ``info`` is
    the version's metadata (``PackageVersionInfo``); ``trust_roots`` maps a
    namespace (``@ns`` / ``ns`` / ``*``) to a fingerprint (``alp1...``) or
    inline PEM; ``explicit_trust_pem`` overrides the namespace trust root (an
    explicit ``--key``). The entry hash is taken from ``info["integrity"]`` so
    remote and local verification use the same canonical payload.

    Returns ``{name, version, signed, trusted, valid, reason}``.
    """
    ns = pkg_name.replace("@", "", 1).split("/")[0]

    def trust_entry() -> Optional[str]:
        if explicit_trust_pem:
            return explicit_trust_pem
        trusted = trust_roots or {}
        return trusted.get("@" + ns) or trusted.get(ns) or trusted.get("*")

    def is_trusted(signature: Dict[str, str]) -> bool:
        entry = trust_entry()
        if not entry:
            return False
        if entry.startswith("alp1"):
            return fingerprint(signature.get("key", "")) == entry
        return entry.strip() == signature.get("key", "").strip()

    signature = info.get("signature")
    if not signature:
        required = not explicit_trust_pem and bool(trust_entry())
        return {
            "name": pkg_name,
            "version": version,
            "signed": False,
            "trusted": False,
            "valid": False,
            "reason": "trust root requires a signature" if required else "package is unsigned (no trust root configured)",
        }

    entry = info.get("entry") or (info.get("files") or [None])[0] or ""
    entry_hash = info["integrity"][len("sha256:") :] if info.get("integrity") else ""
    payload = signing_payload(
        name=pkg_name, version=version, entry=entry, entry_hash=entry_hash, dependencies=info.get("dependencies", {})
    )
    valid = verify(resolve_public_key(signature["key"]), payload, signature)
    trusted = is_trusted(signature)
    reason = (
        "signature valid and trusted"
        if valid and trusted
        else "signature valid but signer not in trust root"
        if valid
        else "signature invalid"
    )
    return {"name": pkg_name, "version": version, "signed": True, "trusted": trusted, "valid": valid, "reason": reason}


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
            return meta.get("tags", {}).get("latest") or sorted(versions, key=functools.cmp_to_key(semver_cmp))[-1]
        if rng in meta.get("versions", {}):
            return rng
        matched = sorted((v for v in versions if satisfies(v, rng)), key=semver_cmp)
        if not matched:
            raise RuntimeError(f"No version satisfying {rng} for {meta.get('name')} (have {', '.join(versions)})")
        return matched[-1]

    def verify_remote(self, pkg_name: str, version_range: str = "latest", trust_key: Optional[str] = None) -> Dict[str, Any]:
        """Verify a remote package version's signature without downloading it (v4.5).

        Fetches ``meta.json``, resolves the version, and runs the shared
        ``verify_version_signature`` against the remote ``PackageVersionInfo``
        (``integrity`` supplies the canonical entry hash). ``trust_key`` (a PEM
        public key) overrides the ``.alprc`` namespace trust root. Returns the
        same ``{name, version, signed, trusted, valid, reason}`` dict as the TS
        CLI's ``alp registry verify --url`` so remote and local checks agree.
        """
        meta = self.get_meta(pkg_name)
        version = self.resolve_version(meta, version_range)
        info = meta["versions"][version]
        return verify_version_signature(
            pkg_name,
            version,
            info,
            self.config.get("trustedKeys"),
            resolve_public_key(trust_key) if trust_key else None,
        )

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

        # v4.2/v4.3: signature verification against a configured trust root,
        # via the shared verify_version_signature helper (v4.5). An explicit
        # trust_key PEM overrides the namespace trust root. The entryHash is
        # taken from the declared integrity, so install and verify agree.
        explicit_trust_pem = resolve_public_key(trust_key) if trust_key else None
        result = verify_version_signature(pkg_name, version, info, self.config.get("trustedKeys"), explicit_trust_pem)
        if explicit_trust_pem or self.resolve_trust_entry(pkg_name):
            if not result["signed"]:
                raise RuntimeError(f"Package {pkg_name}@{version} is not signed; trust root requires signatures")
            if not result["trusted"]:
                raise RuntimeError(f"Signature for {pkg_name}@{version} is not from a trusted key")
            if not result["valid"]:
                raise RuntimeError(f"Signature verification failed for {pkg_name}@{version}")

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


    def resolve_dependencies(self, direct_imports: List[str], max_depth: int = 8) -> Dict[str, str]:
        """Resolve the full dependency graph for ``direct_imports`` (spec/14 §6).

        Mirrors ``resolve_dependency_graph`` but bound to this client's live
        ``get_meta`` so transitive dependencies are fetched from the registry.
        Returns ``{package: version}`` with exactly one version per package.
        Raises ``VersionConflictError`` on an empty range intersection.
        """
        return resolve_dependency_graph(direct_imports, self.get_meta, max_depth)


class VersionConflictError(RuntimeError):
    """Raised by Strict Singleton dependency resolution (spec/14 §6)."""


_ALIAS_RE = re.compile(r"^@([^/]+)/([^@]+)@(.+)$")


def parse_registry_alias(alias: str) -> Tuple[str, str, str]:
    """Parse a registry alias ``@<namespace>/<name>@<range>`` (spec/14 §2).

    Returns ``(package, namespace, version_range)`` where ``package`` is the
    canonical ``@ns/name`` form used by the rest of the client.
    """
    m = _ALIAS_RE.match(alias.strip())
    if not m:
        raise ValueError(f"Invalid registry alias: '{alias}' (expected @ns/name@range)")
    ns, name, rng = m.group(1), m.group(2), m.group(3)
    return f"@{ns}/{name}", ns, rng


def _bounds(rng: str) -> Optional[Tuple[Tuple[int, int, int], Tuple[int, int, int]]]:
    """Return the ``[min, max)`` semver bounds for a single range expression.

    Handles exact versions, ``^`` and ``~`` ranges, and the ``*``/``x``
    wildcards. Returns ``None`` for unsupported operators (treated as
    unconstrained by the caller).
    """
    rng = rng.strip()
    if rng in ("*", "x", "latest"):
        return ((0, 0, 0), (9999, 9999, 9999))
    if rng.startswith("^"):
        parts = rng[1:].split(".")
        maj, mn, pt = _pad(parts)
        if maj > 0:
            return ((maj, mn, pt), (maj + 1, 0, 0))
        if mn > 0:
            return ((maj, mn, pt), (0, mn + 1, 0))
        return ((maj, mn, pt), (0, 0, pt + 1))
    if rng.startswith("~"):
        parts = rng[1:].split(".")
        maj, mn, pt = _pad(parts)
        return ((maj, mn, pt), (maj, mn + 1, 0))
    if rng.startswith(">="):
        maj, mn, pt = _pad(rng[2:].split("."))
        return ((maj, mn, pt), (9999, 9999, 9999))
    if rng.startswith(">"):
        maj, mn, pt = _pad(rng[1:].split("."))
        return ((maj, mn, pt + 1), (9999, 9999, 9999))
    # Exact version.
    maj, mn, pt = _pad(rng.split("."))
    return ((maj, mn, pt), (maj, mn, pt + 1))


def _pad(parts) -> Tuple[int, int, int]:
    nums = [int(p) if p.replace("-", "").isdigit() else 0 for p in list(parts)[:3]]
    while len(nums) < 3:
        nums.append(0)
    return (nums[0], nums[1], nums[2])


def _intersect_ranges(existing: Optional[str], incoming: str) -> Optional[str]:
    """Intersect two semver ranges (spec/14 §6 step 3).

    Computes the actual ``[min, max)`` bounds of each range and intersects
    them. Returns the canonical ``^`` range for the merged window, or ``None``
    when the ranges are mutually exclusive (a Version Conflict).
    """
    if existing is None:
        return incoming
    if existing == incoming:
        return existing
    try:
        lo_e, hi_e = _bounds(existing)
        lo_i, hi_i = _bounds(incoming)
    except Exception:
        # Mixed/unsupported operators: conservatively keep the tighter floor.
        return existing if semver_cmp(_strip_op(existing), _strip_op(incoming)) >= 0 else incoming
    lo = max(lo_e, lo_i)
    hi = min(hi_e, hi_i)
    if semver_cmp(_ver(lo), _ver(hi)) >= 0:
        return None  # disjoint → conflict
    return f">={_ver(lo)} <{_ver(hi)}"


def _strip_op(rng: str) -> str:
    return rng.lstrip("^~>=<").strip()


def _ver(t: Tuple[int, int, int]) -> str:
    return f"{t[0]}.{t[1]}.{t[2]}"


def resolve_dependency_graph(
    direct_imports: List[str],
    fetch_meta,
    max_depth: int = 8,
) -> Dict[str, str]:
    """Strict Singleton dependency resolution (spec/14 §6).

    Given a list of registry aliases/package names (the project's direct
    plugin imports), walk their transitive ``dependencies`` and intersect each
    package's version requirement. Exactly one version of each package survives;
    an empty intersection raises ``VersionConflictError``.

    ``fetch_meta(pkg_name) -> dict`` returns registry metadata whose
    ``versions`` keys are semver strings and whose version entries carry a
    ``dependencies`` map of ``pkg_name -> range``. Typically bound to
    ``RegistryClient.get_meta``.
    """
    resolved: Dict[str, str] = {}
    constraints: Dict[str, Optional[str]] = {}

    queue = list(direct_imports)
    depth = 0
    while queue and depth < max_depth:
        depth += 1
        pkg = queue.pop(0)
        meta = fetch_meta(pkg)
        versions = list(meta.get("versions", {}).keys())
        if not versions:
            raise VersionConflictError(f"Package {pkg} has no published versions")
        rng = constraints.get(pkg)
        if rng:
            satisfying = [v for v in versions if satisfies(v, rng)]
            if not satisfying:
                raise VersionConflictError(
                    f"Version conflict for '{pkg}': no version satisfies '{rng}'"
                )
            chosen = sorted(satisfying, key=functools.cmp_to_key(semver_cmp))[-1]
        else:
            chosen = sorted(versions, key=functools.cmp_to_key(semver_cmp))[-1]
        if pkg not in resolved:
            resolved[pkg] = chosen

        for ver, info in meta.get("versions", {}).items():
            for dep_name, dep_range in (info.get("dependencies") or {}).items():
                if dep_name not in constraints:
                    constraints[dep_name] = dep_range
                else:
                    merged = _intersect_ranges(constraints[dep_name], dep_range)
                    if merged is None:
                        raise VersionConflictError(
                            f"Version conflict for '{dep_name}': "
                            f"'{constraints[dep_name]}' vs '{dep_range}' have no intersection"
                        )
                    constraints[dep_name] = merged
                if dep_name not in resolved and dep_name not in queue:
                    queue.append(dep_name)

    # Pin each constrained package to the highest version satisfying the
    # intersected range (only one version may exist in the final graph).
    for dep_name, rng in constraints.items():
        if dep_name in resolved:
            continue
        meta = fetch_meta(dep_name)
        satisfying = sorted(
            (v for v in meta.get("versions", {}) if satisfies(v, rng or "*")),
            key=functools.cmp_to_key(semver_cmp),
        )
        if not satisfying:
            raise VersionConflictError(
                f"Version conflict for '{dep_name}': no version satisfies '{rng}'"
            )
        resolved[dep_name] = satisfying[-1]
    return resolved


def _iso_now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()
