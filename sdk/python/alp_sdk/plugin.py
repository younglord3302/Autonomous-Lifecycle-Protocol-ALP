"""ALP plugin system (v10.5.0, @type rewrite v8.0.0 - Python SDK parity).

Mirrors the TypeScript ``@alp/parser`` ``PluginResolver``: resolves local
file-level ``!import`` directives (spec/11 §3.1) relative to the ``.alp/``
workspace root, remote HTTPS imports with caching + integrity (§3.2-3.4),
and registry aliases ``@ns/name@version`` (§3.5). Builds a registry of
custom types declared via the canonical ``@type`` block (v8.0.0+, sole
declaration since v9.0.0) and validates custom-type instances (§4.1).
"""

import os
import re
import json
import asyncio
import hashlib
import urllib.request
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Set


def datetime_now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_iso(value: str) -> datetime:
    # Accept trailing Z as UTC.
    return datetime.fromisoformat(value.replace("Z", "+00:00"))

from .models import AlpObject
from .reader import AlpReader
from .error import SyntaxError as AlpSyntaxError, ValidationError


class TypeProperty:
    def __init__(self, name: str, type: str, required: bool):
        self.name = name
        self.type = type
        self.required = required


class CustomType:
    def __init__(
        self,
        type_name: str,
        id: str,
        description: Optional[str],
        properties: List[TypeProperty],
        allowed_nested: List[str],
    ):
        self.type_name = type_name
        self.id = id
        self.description = description
        self.properties = properties
        self.allowed_nested = allowed_nested


class PluginInfo:
    def __init__(self, id: str, name: Optional[str], version: Optional[str], types: List[str]):
        self.id = id
        self.name = name
        self.version = version
        self.types = types


CORE_TYPES = {
    "project", "feature", "task", "agent", "decision", "rule", "memory",
    "state", "workflow", "policy", "macro", "plugin", "type",
    "workspace", "repo", "swarm", "resource", "constraint", "context",
    "goal", "artifact", "event", "package",
}


class PluginResolver:
    """Resolve local / remote / registry ``!import`` graphs and register custom ALP types."""

    def __init__(self, root_dir: Optional[str] = None, options: Optional[Dict[str, Any]] = None) -> None:
        self.types: Dict[str, CustomType] = {}
        self.plugins: Dict[str, PluginInfo] = {}
        self.objects: List[AlpObject] = []
        self.warnings: List[str] = []
        self._reader = AlpReader()
        self._visited: Set[str] = set()
        self._fetcher = RemoteFetcher(root_dir or os.getcwd())
        self._options: Dict[str, Any] = options or {}
        self._plugin_sources: Dict[str, str] = {}
        self._plugin_types: Dict[str, Set[str]] = {}

    def parse_workspace(self, content: str, root_dir: str, options: Optional[Dict[str, Any]] = None, source_path: Optional[str] = None) -> List[AlpObject]:
        self._fetcher = RemoteFetcher(root_dir)
        self._options = {**self._options, **(options or {})}
        self.types.clear()
        self.plugins.clear()
        self.objects = []
        self._visited.clear()
        self._plugin_sources.clear()
        self._plugin_types.clear()
        asyncio.run(self._resolve_file(content, root_dir, root_dir, 0, source_path))
        return self.objects

    async def _resolve_file(self, content: str, file_dir: str, root_dir: str, depth: int, source_path: Optional[str] = None, owning_plugin_id: Optional[str] = None) -> None:
        if depth > 5:
            raise AlpSyntaxError("Maximum local import depth (5) exceeded.")

        current_plugin_id: Optional[str] = None

        body_lines: List[str] = []
        for raw in content.split("\n"):
            trimmed = raw.strip()
            if trimmed.startswith("!import"):
                target, integrity = self._extract_import(trimmed)
                effective_plugin_id = current_plugin_id or owning_plugin_id
                if re.match(r"^https://", target) or target.startswith("@"):
                    imported = await self._fetcher.fetch_import(target, {
                        **self._options,
                        "integrity": integrity,
                    })
                    await self._resolve_file(imported, file_dir, root_dir, depth + 1, target, effective_plugin_id)
                else:
                    resolved = self._resolve_local_import(target, file_dir, root_dir)
                    imported = self._read(resolved)
                    await self._resolve_file(imported, os.path.dirname(resolved), root_dir, depth + 1, resolved, effective_plugin_id)
                continue
            body_lines.append(raw)

        parsed = self._reader.parse("\n".join(body_lines))
        for obj in parsed:
            if obj._type == "plugin":
                self._register_plugin(obj)
                current_plugin_id = obj.id
                if source_path:
                    self._plugin_sources[obj.id] = source_path
            elif obj._type == "type":
                self._register_type(obj, [], current_plugin_id or owning_plugin_id)
            elif obj._type == "type_definition":
                raise ValidationError(
                    "@type_definition was removed in v9.0.0; declare custom "
                    "types with @type instead."
                )
            self.objects.append(obj)

    def _extract_import(self, directive: str):
        m = re.match(r'^!import(?::|\s)\s*"([^"]+)"(?:\s+!integrity:\s*(sha256:[a-fA-F0-9]+))?', directive)
        if not m:
            raise AlpSyntaxError(f"Malformed !import directive: '{directive}'")
        return m.group(1).strip(), m.group(2)
    def _resolve_local_import(self, target: str, file_dir: str, root_dir: str) -> str:
        root = os.path.abspath(root_dir)
        candidate = os.path.abspath(os.path.join(root, target))
        if candidate != root and not candidate.startswith(root + os.sep):
            raise AlpSyntaxError(f"!import path escapes workspace root: '{target}'")
        if candidate in self._visited:
            raise AlpSyntaxError(f"Circular !import detected: '{target}'")
        if not os.path.exists(candidate):
            raise AlpSyntaxError(f"!import target not found: '{target}'")
        self._visited.add(candidate)
        return candidate

    def _read(self, path: str) -> str:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()

    def _register_plugin(self, obj: AlpObject) -> None:
        raw = obj.properties.get("types", [])
        types = raw if isinstance(raw, list) else []
        ids = [
            t[3:].strip() if t.startswith("-> ") else t
            for t in types
            if isinstance(t, str) and t.startswith("type-")
        ]
        self.plugins[obj.id] = PluginInfo(
            obj.id,
            obj.properties.get("name"),
            obj.properties.get("version"),
            ids,
        )

    def _register_type(self, obj: AlpObject, warnings: Optional[List[str]] = None, plugin_id: Optional[str] = None) -> None:
        warnings = warnings if warnings is not None else []
        type_name = obj.properties.get("type_name")
        if not type_name:
            raise ValidationError(f"@type '{obj.id}' missing type_name")
        if type_name in CORE_TYPES:
            raise ValidationError(
                f"@type '{obj.id}' redefines core type '{type_name}'"
            )
        raw_props = obj.properties.get("properties", [])
        properties: List[TypeProperty] = []
        if isinstance(raw_props, list):
            for p in raw_props:
                parsed = parse_inline_object(p) if isinstance(p, str) else p
                properties.append(
                    TypeProperty(
                        str(parsed.get("name", "")),
                        str(parsed.get("type", "String")),
                        bool(parsed.get("required", False)),
                    )
                )
        allowed = obj.properties.get("allowed_nested", [])
        allowed_nested = allowed if isinstance(allowed, list) else []
        self.types[type_name] = CustomType(
            type_name,
            obj.id,
            obj.properties.get("description"),
            properties,
            allowed_nested,
        )
        if plugin_id:
            self._plugin_types.setdefault(plugin_id, set()).add(type_name)
        self.warnings.extend(warnings)

    def validate_custom(self, obj: AlpObject, warnings: Optional[List[str]] = None) -> None:
        warnings = warnings if warnings is not None else []
        definition = self.types.get(obj._type)
        if not definition:
            return

        for prop in definition.properties:
            if prop.required and prop.name not in obj.properties:
                raise ValidationError(
                    f"Missing required property '{prop.name}' in @{obj._type} '{obj.id}'"
                )

        known = {p.name for p in definition.properties}
        for key in obj.properties:
            if key in ("_type", "id") or key.startswith("@"):
                continue
            if key not in known:
                warnings.append(
                    f"Unknown property '{key}' in @{obj._type} '{obj.id}' (not in type)"
                )

    def is_custom_type(self, type_name: str) -> bool:
        return type_name in self.types

    def validate(self, plugin_path: str) -> None:
        if not os.path.exists(plugin_path):
            raise AlpSyntaxError(f"Plugin file not found: {plugin_path}")
        with open(plugin_path, "r", encoding="utf-8") as f:
            content = f.read()
        parsed = self._reader.parse(content)

        from .validator import validate_object
        for obj in parsed:
            try:
                validate_object(obj)
            except ValidationError as e:
                raise ValidationError(
                    f"Schema validation failed for @{obj._type} '{obj.id}': {e.message}"
                )

        plugins = [o for o in parsed if o._type == "plugin"]
        if not plugins:
            raise ValidationError(f"No @plugin block found in {plugin_path}")

        dep_graph: Dict[str, List[str]] = {}
        dep_ranges: Dict[str, List[Dict[str, str]]] = {}

        for p in plugins:
            raw = p.properties.get("dependencies", [])
            raw_list = raw if isinstance(raw, list) else []
            dep_names: List[str] = []
            for dep in raw_list:
                dep_str = dep if isinstance(dep, str) else json.dumps(dep)
                m = re.match(r"^@[^/]+\/([^@]+)@(.+)$", dep_str)
                if m:
                    name = m.group(1)
                    rng = m.group(2)
                    dep_names.append(name)
                    dep_ranges.setdefault(name, []).append({"plugin": p.id, "range": rng})
            dep_graph[p.id] = dep_names

        visited: Set[str] = set()
        in_stack: Set[str] = set()
        for nid in list(dep_graph.keys()):
            if self._detect_cycle(dep_graph, nid, visited, in_stack):
                raise ValidationError(f"Circular plugin dependency detected involving '{nid}'")

        for name, ranges in dep_ranges.items():
            if len(ranges) > 1:
                for i in range(len(ranges)):
                    for j in range(i + 1, len(ranges)):
                        if not self._ranges_intersect(ranges[i]["range"], ranges[j]["range"]):
                            raise ValidationError(
                                f"Version range conflict for dependency '{name}': "
                                f"{ranges[i]['plugin']} requires '{ranges[i]['range']}' but "
                                f"{ranges[j]['plugin']} requires '{ranges[j]['range']}'"
                            )

    def hot_reload(self, plugin_id: str) -> None:
        source_path = self._plugin_sources.get(plugin_id)
        if not source_path:
            raise RuntimeError(f"Cannot hot-reload plugin '{plugin_id}': source path not tracked.")
        if not os.path.exists(source_path):
            raise RuntimeError(f"Plugin source not found: {source_path}")

        self.plugins.pop(plugin_id, None)
        types_to_remove = self._plugin_types.get(plugin_id)
        if types_to_remove:
            for tn in types_to_remove:
                self.types.pop(tn, None)
            del self._plugin_types[plugin_id]
        self._plugin_sources.pop(plugin_id, None)

        with open(source_path, "r", encoding="utf-8") as f:
            content = f.read()
        root_dir = os.path.dirname(source_path)
        asyncio.run(self._resolve_file(content, root_dir, root_dir, 0, source_path, None))

    def list_plugins(self) -> List[PluginInfo]:
        return list(self.plugins.values())

    def lint_plugin(self, plugin_path: str) -> List[str]:
        warnings: List[str] = []
        if not os.path.exists(plugin_path):
            warnings.append(f"Plugin file not found: {plugin_path}")
            return warnings
        with open(plugin_path, "r", encoding="utf-8") as f:
            content = f.read()
        parsed = self._reader.parse(content)

        plugin = next((o for o in parsed if o._type == "plugin"), None)
        if not plugin:
            warnings.append("No @plugin block found.")
            return warnings

        if not plugin.properties.get("version"):
            warnings.append(f"Plugin '{plugin.id}' is missing a 'version' field.")
        if not plugin.properties.get("description"):
            warnings.append(f"Plugin '{plugin.id}' is missing a 'description' field.")
        raw_types = plugin.properties.get("types", [])
        raw_types_list = raw_types if isinstance(raw_types, list) else []
        if not raw_types_list:
            warnings.append(f"Plugin '{plugin.id}' has no 'types' references.")
        for t in raw_types_list:
            ref = t if isinstance(t, str) else str(t)
            if not ref.startswith("-> "):
                warnings.append(f"Type reference '{ref}' in '{plugin.id}' should start with '-> '.")
            elif not ref[3:].strip().startswith("type-"):
                warnings.append(f"Type reference '{ref}' in '{plugin.id}' should reference a custom type (type-...).")
        raw_deps = plugin.properties.get("dependencies", [])
        raw_deps_list = raw_deps if isinstance(raw_deps, list) else []
        for dep in raw_deps_list:
            dep_str = dep if isinstance(dep, str) else json.dumps(dep)
            if "@" not in dep_str:
                warnings.append(f"Dependency '{dep_str}' in '{plugin.id}' should use @ns/name@version format.")
        if plugin.id and not re.match(r"^[a-z0-9-]+$", plugin.id):
            warnings.append(f"Plugin id '{plugin.id}' is not kebab-case.")

        types_in_file = [o for o in parsed if o._type == "type"]
        for t in types_in_file:
            type_name = t.properties.get("type_name")
            if not type_name:
                warnings.append(f"@type '{t.id}' is missing type_name.")
            elif not re.match(r"^[a-z0-9-]+$", type_name):
                warnings.append(f"Custom type name '{type_name}' is not kebab-case.")
            if not t.properties.get("description"):
                warnings.append(f"@type '{t.id}' is missing a description.")

        return warnings

    def _detect_cycle(self, graph: Dict[str, List[str]], node: str, visited: Set[str], in_stack: Set[str]) -> bool:
        visited.add(node)
        in_stack.add(node)
        for neighbor in graph.get(node, []):
            if neighbor not in visited:
                if self._detect_cycle(graph, neighbor, visited, in_stack):
                    return True
            elif neighbor in in_stack:
                return True
        in_stack.discard(node)
        return False

    def _parse_semver(self, v: str) -> Tuple[int, int, int, str]:
        core = re.sub(r"^[^0-9]*", "", v)
        core = re.sub(r"[-+].*$", "", core)
        parts = [int(x) or 0 for x in core.split(".")]
        while len(parts) < 3:
            parts.append(0)
        pre = ""
        if "-" in v:
            pre = "-".join(v.split("-")[1:])
        return (parts[0], parts[1], parts[2], pre)

    def _semver_cmp(self, a: str, b: str) -> int:
        pa = self._parse_semver(a)
        pb = self._parse_semver(b)
        for i in range(3):
            if pa[i] != pb[i]:
                return pa[i] - pb[i]
        if not pa[3] and pb[3]:
            return 1
        if pa[3] and not pb[3]:
            return -1
        return (pa[3] or "").__lt__(pb[3] or "") and -1 or ((pa[3] or "") > (pb[3] or "") and 1 or 0)

    def _satisfies(self, v: str, rng: str) -> bool:
        rng = rng.strip()
        if rng in ("*", "x", ""):
            return True
        caret = re.match(r"^\^(\d+)\.(\d+)\.(\d+)$", rng)
        if caret:
            maj, mn, pat = int(caret.group(1)), int(caret.group(2)), int(caret.group(3))
            if self._semver_cmp(v, rng[1:]) < 0:
                return False
            if maj > 0:
                return self._parse_semver(v)[0] == maj
            if mn > 0:
                return self._parse_semver(v)[0] == 0 and self._parse_semver(v)[1] == mn
            return self._parse_semver(v)[0] == 0 and self._parse_semver(v)[1] == 0 and self._parse_semver(v)[2] == pat
        tilde = re.match(r"^~(\d+)(?:\.(\d+))?(?:\.(\d+))?$", rng)
        if tilde:
            maj = int(tilde.group(1))
            mn = tilde.group(2) is not None and int(tilde.group(2)) or None
            if maj > 0 or mn is not None:
                if self._parse_semver(v)[0] != maj:
                    return False
                if mn is not None and self._parse_semver(v)[1] != mn:
                    return False
                return self._semver_cmp(v, f"{maj}.{mn or 0}.0") >= 0
            return self._parse_semver(v)[0] == maj
        xr = re.match(r"^(\d+|x|\*)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$", rng)
        if xr and ("x" in rng or "*" in rng):
            a, b, c = xr.group(1), xr.group(2), xr.group(3)
            if a not in ("x", "*") and self._parse_semver(v)[0] != int(a):
                return False
            if b is not None and b not in ("x", "*") and self._parse_semver(v)[1] != int(b):
                return False
            if c is not None and c not in ("x", "*") and self._parse_semver(v)[2] != int(c):
                return False
            return True
        if re.search(r">=|<=|>|<", rng):
            comps = rng.split()
            for cmp in comps:
                m = re.match(r"^(>=|<=|>|<)\s*(\d+\.\d+\.\d+)$", cmp)
                if not m:
                    return False
                op, target = m.group(1), m.group(2)
                c = self._semver_cmp(v, target)
                if op == ">=" and not c >= 0:
                    return False
                if op == "<=" and not c <= 0:
                    return False
                if op == ">" and not c > 0:
                    return False
                if op == "<" and not c < 0:
                    return False
            return True
        return self._semver_cmp(v, rng) == 0

    def _ranges_intersect(self, r1: str, r2: str) -> bool:
        if r1 == r2:
            return True
        if r1 in ("*", "x") or r2 in ("*", "x"):
            return True
        exact1 = re.match(r"^(\d+)\.(\d+)\.(\d+)$", r1)
        exact2 = re.match(r"^(\d+)\.(\d+)\.(\d+)$", r2)
        if exact1 and exact2:
            return r1 == r2
        if exact1 and not exact2:
            return self._satisfies(r1, r2)
        if not exact1 and exact2:
            return self._satisfies(r2, r1)
        versions = ["0.0.0", "1.0.0", "1.5.0", "2.0.0", "2.5.0", "3.0.0"]
        for v in versions:
            if self._satisfies(v, r1) and self._satisfies(v, r2):
                return True
        return False


class RemoteFetcher:
    """Fetch remote / registry plugin ``.alp`` files (spec/11 §3.2-3.5).

    Mirrors the TypeScript ``RemoteFetcher``: HTTPS only, ``.alp`` extension
    check, on-disk cache under ``.alp/.cache/remote/<sha256>/`` with a 24h TTL
    (stale-on-error), and optional ``sha256:`` integrity verification.
    """

    DEFAULT_TTL_SECONDS = 86_400
    DEFAULT_MAX_BYTES = 1_000_000
    DEFAULT_REGISTRY = "https://registry.alp-protocol.org"

    def __init__(self, cache_root: str):
        self.cache_dir = os.path.join(cache_root, ".alp", ".cache", "remote")

    def resolve_alias(self, alias: str, registry_base: str) -> str:
        m = re.match(r"^@([^/]+)/([^@]+)@(.+)$", alias)
        if not m:
            return alias
        ns, name, version = m.group(1), m.group(2), m.group(3)
        return f"{registry_base.rstrip('/')}/plugins/{ns}/{name}/{version}/plugin.alp"

    def _cache_paths(self, url: str):
        key = hashlib.sha256(url.encode("utf-8")).hexdigest()
        d = os.path.join(self.cache_dir, key)
        return d, os.path.join(d, "plugin.alp"), os.path.join(d, "metadata.json")

    def _load_cache(self, url: str, force: bool = False):
        _, file_path, meta_path = self._cache_paths(url)
        if not os.path.exists(file_path) or not os.path.exists(meta_path):
            return None
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
            if not force:
                age = (datetime_now() - _parse_iso(meta["fetched_at"])).total_seconds()
                if age > meta.get("ttl_seconds", self.DEFAULT_TTL_SECONDS):
                    return None
            with open(file_path, "r", encoding="utf-8") as f:
                return f.read()
        except Exception:
            return None
        return None

    def _save_cache(self, url: str, content: str, etag: Optional[str] = None) -> None:
        _, file_path, meta_path = self._cache_paths(url)
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(content)
        meta = {
            "url": url,
            "fetched_at": datetime_now().isoformat(),
            "etag": etag,
            "content_hash": "sha256:" + hashlib.sha256(content.encode("utf-8")).hexdigest(),
            "ttl_seconds": self.DEFAULT_TTL_SECONDS,
        }
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2)

    def _verify_integrity(self, content: str, integrity: Optional[str]) -> None:
        if not integrity:
            return
        m = re.match(r"^sha256:(.+)$", integrity, re.IGNORECASE)
        if not m:
            raise AlpSyntaxError(f"Unsupported integrity algorithm: '{integrity}'")
        actual = hashlib.sha256(content.encode("utf-8")).hexdigest()
        if actual.lower() != m.group(1).lower():
            raise AlpSyntaxError(
                f"Integrity mismatch for remote import (expected {m.group(1)}, got {actual})"
            )

    async def fetch_import(self, target: str, options: Optional[Dict[str, Any]] = None) -> str:
        options = options or {}
        transport = options.get("transport")
        registry_base = options.get("registry_base", self.DEFAULT_REGISTRY)
        url = self.resolve_alias(target, registry_base) if target.startswith("@") else target
        if not re.match(r"^https://", url):
            raise AlpSyntaxError(f"Only https imports are allowed: '{target}'")
        if not re.search(r"\.alp($|\?)", url):
            raise AlpSyntaxError(f"Remote import must end in .alp: '{target}'")

        if not options.get("refresh"):
            cached = self._load_cache(url)
            if cached is not None:
                self._verify_integrity(cached, options.get("integrity"))
                return cached

        try:
            content = await self._fetch(url, transport)
        except Exception as err:
            stale = self._load_cache(url, force=True)
            if stale is not None:
                return stale
            raise AlpSyntaxError(f"Failed to fetch remote import '{url}': {err}")

        if len(content.encode("utf-8")) > options.get("max_bytes", self.DEFAULT_MAX_BYTES):
            raise AlpSyntaxError(
                f"Remote import exceeds size limit: '{target}'"
            )
        self._verify_integrity(content, options.get("integrity"))
        self._save_cache(url, content)
        return content

    async def _fetch(self, url: str, transport) -> str:
        if transport is not None:
            result = transport(url)
            if asyncio.iscoroutine(result):
                result = await result
            status = result.get("status", 200)
            if status >= 400:
                raise AlpSyntaxError(f"Remote import returned HTTP {status}: '{url}'")
            return result.get("body", "")
        req = urllib.request.Request(url, headers={"User-Agent": "alp-sdk"})
        with urllib.request.urlopen(req, timeout=30) as resp:  # nosec - https only, validated above
            return resp.read().decode("utf-8")


def parse_inline_object(literal: Any) -> Dict[str, Any]:
    """Parse a single inline object literal ``{ name: "id", ... }`` into a dict.

    Used for ``@type`` ``properties`` lists that the line-based
    reader stores as raw strings (mirrors the TS ``parseInlineObject``).
    """
    if not isinstance(literal, str):
        return literal if isinstance(literal, dict) else {}
    inner = literal.strip().strip("{}").strip()
    out: Dict[str, Any] = {}
    if not inner:
        return out
    for pair in inner.split(","):
        idx = pair.find(":")
        if idx == -1:
            continue
        key = pair[:idx].strip()
        value = pair[idx + 1:].strip()
        if (value.startswith('"') and value.endswith('"')) or (
            value.startswith("'") and value.endswith("'")
        ):
            value = value[1:-1]
        elif value == "true":
            value = True
        elif value == "false":
            value = False
        out[key] = value
    return out
