"""ALP plugin system (v6.5.0 - Python SDK parity).

Mirrors the TypeScript ``@alp/parser`` ``PluginResolver``: resolves local
file-level ``!import`` directives (spec/11 §3.1) relative to the ``.alp/``
workspace root, remote HTTPS imports with caching + integrity (§3.2-3.4),
and registry aliases ``@ns/name@version`` (§3.5). Builds a registry of
custom types from ``@type_definition`` blocks (§2) and validates
custom-type instances (§4.1).
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
    "state", "workflow", "policy", "macro", "plugin", "type_definition",
    "workspace", "repo", "swarm", "resource", "constraint", "context",
    "goal", "artifact", "event", "package",
}


class PluginResolver:
    """Resolve local / remote / registry ``!import`` graphs and register custom ALP types."""

    def __init__(self, root_dir: Optional[str] = None, options: Optional[Dict[str, Any]] = None) -> None:
        self.types: Dict[str, CustomType] = {}
        self.plugins: Dict[str, PluginInfo] = {}
        self.objects: List[AlpObject] = []
        self._reader = AlpReader()
        self._visited: Set[str] = set()
        self._fetcher = RemoteFetcher(root_dir or os.getcwd())
        self._options: Dict[str, Any] = options or {}

    def parse_workspace(self, content: str, root_dir: str, options: Optional[Dict[str, Any]] = None) -> List[AlpObject]:
        self._fetcher = RemoteFetcher(root_dir)
        self._options = {**self._options, **(options or {})}
        self.types.clear()
        self.plugins.clear()
        self.objects = []
        self._visited.clear()
        asyncio.run(self._resolve_file(content, root_dir, root_dir, 0))
        return self.objects

    async def _resolve_file(self, content: str, file_dir: str, root_dir: str, depth: int) -> None:
        if depth > 5:
            raise AlpSyntaxError("Maximum local import depth (5) exceeded.")

        body_lines: List[str] = []
        for raw in content.split("\n"):
            trimmed = raw.strip()
            if trimmed.startswith("!import"):
                target, integrity = self._extract_import(trimmed)
                if re.match(r"^https://", target) or target.startswith("@"):
                    imported = await self._fetcher.fetch_import(target, {
                        **self._options,
                        "integrity": integrity,
                    })
                    await self._resolve_file(imported, file_dir, root_dir, depth + 1)
                else:
                    resolved = self._resolve_local_import(target, file_dir, root_dir)
                    imported = self._read(resolved)
                    await self._resolve_file(imported, os.path.dirname(resolved), root_dir, depth + 1)
                continue
            body_lines.append(raw)

        parsed = self._reader.parse("\n".join(body_lines))
        for obj in parsed:
            if obj._type == "plugin":
                self._register_plugin(obj)
            elif obj._type == "type_definition":
                self._register_type(obj)
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

    def _register_type(self, obj: AlpObject) -> None:
        type_name = obj.properties.get("type_name")
        if not type_name:
            raise ValidationError(f"@type_definition '{obj.id}' missing type_name")
        if type_name in CORE_TYPES:
            raise ValidationError(
                f"@type_definition '{obj.id}' redefines core type '{type_name}'"
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
                    f"Unknown property '{key}' in @{obj._type} '{obj.id}' (not in type_definition)"
                )

    def is_custom_type(self, type_name: str) -> bool:
        return type_name in self.types


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

    Used for ``@type_definition`` ``properties`` lists that the line-based
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
