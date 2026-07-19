"""ALP policy engine (v6.4.0 - Python SDK parity).

Mirrors the TypeScript ``@alp/parser`` ``PolicyEngine``: evaluates proposed
autonomous-agent actions (path / command) against declarative ``@policy``
objects. ``deny_*`` always beats ``allow_*``; an empty/ absent ``allow_*``
permits unless denied; ``enforcement: warn`` reports but never blocks.
"""

import re
from typing import Any, Dict, List, Optional, Union

from .models import AlpObject

PolicyActionKind = str  # 'path' | 'command'


class PolicyDecision:
    def __init__(self, allowed: bool, blocked: bool, reasons: List[str], policies: List[str]):
        self.allowed = allowed
        self.blocked = blocked
        self.reasons = reasons
        self.policies = policies

    def __repr__(self) -> str:
        return (
            f"PolicyDecision(allowed={self.allowed}, blocked={self.blocked}, "
            f"policies={self.policies})"
        )


class PolicyQuery:
    def __init__(self, kind: str, value: str, agent: Optional[str] = None):
        self.kind = kind
        self.value = value
        self.agent = agent


class PolicyEngine:
    def __init__(self, objects: List[AlpObject]):
        self.policies = [o for o in objects if o._type == "policy"]

    @property
    def count(self) -> int:
        return len(self.policies)

    def _governs(self, policy: Dict[str, Any], agent: Optional[str]) -> bool:
        target = policy.get("applies_to")
        if target is None or target == "*" or target == "-> *":
            return True
        if isinstance(target, str):
            targets = [target]
        else:
            targets = list(target)
        if not agent:
            return False
        return any(_normalize_ref(t) == agent or t == "*" for t in targets)

    def evaluate(self, query: PolicyQuery) -> PolicyDecision:
        return self._evaluate_internal(query, False)

    def evaluate_deny_only(self, query: PolicyQuery) -> PolicyDecision:
        return self._evaluate_internal(query, True)

    def _evaluate_internal(self, query: PolicyQuery, deny_only: bool) -> PolicyDecision:
        reasons: List[str] = []
        violating: List[str] = []
        blocked = False
        allowed = True

        for policy in self.policies:
            if not self._governs(policy.properties, query.agent):
                continue
            strict = policy.properties.get("enforcement", "strict") == "strict"
            if query.kind == "path":
                deny = policy.properties.get("deny_paths")
                allow = policy.properties.get("allow_paths")
            elif query.kind == "command":
                deny = policy.properties.get("deny_commands")
                allow = policy.properties.get("allow_commands")
            else:
                deny = None
                allow = None

            if deny and any(self._matches(query.kind, p, query.value) for p in deny):
                reasons.append(
                    f"Policy '{policy.id}' denies {query.kind} '{query.value}'."
                )
                violating.append(policy.id)
                allowed = False
                if strict:
                    blocked = True
                continue

            if not deny_only and allow and len(allow) > 0:
                ok = any(self._matches(query.kind, p, query.value) for p in allow)
                if not ok:
                    reasons.append(
                        f"Policy '{policy.id}' does not allow {query.kind} "
                        f"'{query.value}' (not in allow-list)."
                    )
                    violating.append(policy.id)
                    allowed = False
                    if strict:
                        blocked = True

        return PolicyDecision(allowed, blocked, reasons, violating)

    def _matches(self, kind: str, pattern: str, value: str) -> bool:
        if kind == "command":
            p = pattern.strip().lower()
            v = value.strip().lower()
            return v == p or v.startswith(p + " ") or v.startswith(p)
        return bool(glob_to_regexp(pattern).match(_normalize_path(value)))


def _normalize_ref(ref: str) -> str:
    return ref.replace("->", "", 1).strip()


def _normalize_path(p: str) -> str:
    return p.replace("\\", "/").replace("./", "", 1)


def glob_to_regexp(glob: str) -> "re.Pattern[str]":
    """Convert a glob (``*``, ``**``, ``?``) into an anchored ``re.Pattern``."""
    normalized = _normalize_path(glob)
    out = []
    i = 0
    while i < len(normalized):
        c = normalized[i]
        if c == "*":
            if i + 1 < len(normalized) and normalized[i + 1] == "*":
                out.append(".*")
                i += 1
                if i + 1 < len(normalized) and normalized[i + 1] == "/":
                    i += 1
            else:
                out.append("[^/]*")
        elif c == "?":
            out.append("[^/]")
        elif c in ".+^${}()|[]\\":
            out.append("\\" + c)
        else:
            out.append(c)
        i += 1
    return re.compile("^" + "".join(out) + "$")
