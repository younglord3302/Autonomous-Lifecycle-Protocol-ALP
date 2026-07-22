"""ALP policy engine (v6.4.0, v2 extensions v8.1.0 - Python SDK parity).

Mirrors the TypeScript ``@alp/parser`` ``PolicyEngine``: evaluates
proposed autonomous-agent actions (path / command) against declarative
``@policy`` objects. ``deny_*`` always beats ``allow_*``; an empty/
absent ``allow_*`` permits unless denied; ``enforcement: warn`` reports
but never blocks.

v8.1.0 extensions:

* ``allow_during`` time-windows — actions outside every declared UTC
  window are denied (a strict, time-scoped least-privilege guard).
* ``require_approval`` — matching actions escalate to a
  human-in-the-loop approval gate instead of auto-blocking.
* ``proposal`` blocks — signed, auditable action proposals verified
  against a trust root (MCP-enforcement audit trail, spec/03 §25).
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Union

from .models import AlpObject

PolicyActionKind = str  # 'path' | 'command'


class PolicyDecision:
    def __init__(self, allowed: bool, blocked: bool, reasons: List[str], policies: List[str], requires_approval: bool = False, audit: Optional[Dict[str, Any]] = None):
        self.allowed = allowed
        self.blocked = blocked
        self.reasons = reasons
        self.policies = policies
        self.requires_approval = requires_approval
        self.audit = audit

    def __repr__(self) -> str:
        return (
            f"PolicyDecision(allowed={self.allowed}, blocked={self.blocked}, "
            f"policies={self.policies})"
        )


class PolicyQuery:
    def __init__(self, kind: str, value: str, agent: Optional[str] = None, now: Any = None):
        self.kind = kind
        self.value = value
        self.agent = agent
        self.now = now


class PolicyEngine:
    def __init__(self, objects: List[AlpObject]):
        self.policies = [o for o in objects if o._type == "policy"]
        self._versions: Dict[str, List[PolicyVersion]] = {}
        self._rollbacks: List[PolicyRollback] = []

    @property
    def count(self) -> int:
        return len(self.policies)

    def suggest(self, query: PolicyQuery) -> List[PolicySuggestion]:
        """V7.0.0: return structured suggestions for warn-mode violations."""
        decision = self._evaluate_internal(query, False)
        suggestions: List[PolicySuggestion] = []
        for pid in decision.policies:
            policy = next((p for p in self.policies if p.id == pid), None)
            if not policy:
                continue
            strict = policy.properties.get("enforcement", "strict") == "strict"
            if strict:
                continue
            for reason in decision.reasons:
                if pid in reason:
                    suggestions.append(
                        PolicySuggestion(
                            suggestion_id=f"sugg-{len(suggestions)+1}",
                            policy_id=pid,
                            action_kind=query.kind,
                            action_value=query.value,
                            reason=reason,
                            confidence=0.5,
                        )
                    )
        return suggestions

    def version_policy(self, policy_id: str, version: str) -> Optional[PolicyVersion]:
        """V7.2.0: snapshot the current policy definition under a version tag."""
        policy = next((p for p in self.policies if p.id == policy_id), None)
        if not policy:
            return None
        pv = PolicyVersion(version=version, policy=policy.properties, created_at=datetime.now(timezone.utc).isoformat())
        self._versions.setdefault(policy_id, []).append(pv)
        return pv

    def rollback(self, policy_id: str, to_version: str) -> Optional[PolicyRollback]:
        """V7.2.0: roll a policy back to a previously snapshot version."""
        versions = self._versions.get(policy_id, [])
        target = next((v for v in versions if v.version == to_version), None)
        if not target:
            return None
        policy = next((p for p in self.policies if p.id == policy_id), None)
        if not policy:
            return None
        from_version = policy.properties.get("version", "unknown")
        policy.properties = dict(target.policy)
        rolled_at = datetime.now(timezone.utc).isoformat()
        rollback = PolicyRollback(
            policy_id=policy_id,
            from_version=from_version,
            to_version=to_version,
            rolled_back_at=rolled_at,
        )
        self._rollbacks.append(rollback)
        return rollback

    def get_versions(self, policy_id: str) -> List[PolicyVersion]:
        return list(self._versions.get(policy_id, []))

    def get_rollbacks(self, policy_id: str) -> List[PolicyRollback]:
        return [r for r in self._rollbacks if r.policy_id == policy_id]

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

    def _in_any_window(self, windows: List[Any], now: Any) -> bool:
        """v8.1.0: is ``now`` (a datetime, default UTC now)
        inside any declared time window? The line-based reader may keep
        nested list items as raw inline-object strings, so both the
        window and its ``days`` array are normalized here."""
        import json as _json
        from datetime import datetime, timezone

        moment = now if now is not None else datetime.now(timezone.utc)
        day = moment.strftime("%A").lower()
        hhmm = moment.strftime("%H:%M")
        for w in windows:
            w = parse_inline_object(w) if isinstance(w, str) else w
            if not isinstance(w, dict):
                continue
            days = w.get("days") or ["*"]
            if isinstance(days, str):
                try:
                    parsed = _json.loads(days)
                    if isinstance(parsed, list):
                        days = parsed
                except Exception:
                    days = [days]
            day_ok = "*" in days or any(str(d).lower() == day for d in days)
            if not day_ok:
                continue
            if not w.get("start") and not w.get("end"):
                return True
            start = w.get("start") or "00:00"
            end = w.get("end") or "23:59"
            if hhmm >= start and hhmm < end:
                return True
        return False

    def evaluate(self, query: PolicyQuery) -> PolicyDecision:
        return self._evaluate_internal(query, False)

    def evaluate_deny_only(self, query: PolicyQuery) -> PolicyDecision:
        return self._evaluate_internal(query, True)

    def evaluate_proposal(self, proposal_id: str, trust_pems: Optional[Dict[str, str]] = None) -> PolicyDecision:
        """v8.1.0: verify a signed ``proposal`` block against this
        policy's ``proposals`` list and an optional trust root."""
        from datetime import datetime, timezone

        reasons: List[str] = []
        violating: List[str] = []
        allowed = False
        blocked = False

        for policy in self.policies:
            proposals = policy.properties.get("proposals", [])
            if not isinstance(proposals, list):
                continue
            match = next(
                (p for p in proposals if isinstance(p, dict) and p.get("id") == proposal_id),
                None,
            )
            if match is None:
                continue
            signature = match.get("signature")
            signed_by = match.get("signed_by")
            if signature:
                if trust_pems and signed_by and signed_by not in trust_pems:
                    reasons.append(
                        f"Policy '{policy.id}' proposal '{proposal_id}' signed by "
                        f"'{signed_by}' not in trust root."
                    )
                    violating.append(policy.id)
                    blocked = True
                else:
                    allowed = True
            elif trust_pems and len(trust_pems) > 0:
                reasons.append(
                    f"Policy '{policy.id}' proposal '{proposal_id}' is unsigned; "
                    f"trust root requires signatures."
                )
                violating.append(policy.id)
                blocked = True
            else:
                allowed = True

        if len(self.policies) == 0:
            allowed = True

        return PolicyDecision(
            allowed,
            blocked,
            reasons,
            violating,
            audit={
                "proposal_id": proposal_id,
                "decision": "allow" if allowed else "deny",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
        )

    def _evaluate_internal(self, query: PolicyQuery, deny_only: bool) -> PolicyDecision:
        reasons: List[str] = []
        violating: List[str] = []
        blocked = False
        allowed = True
        requires_approval = False
        now = query.now if query.now is not None else None

        for policy in self.policies:
            if not self._governs(policy.properties, query.agent):
                continue
            strict = policy.properties.get("enforcement", "strict") == "strict"

            # v8.1.0: time-scoped least-privilege. Outside every
            # declared `allow_during` window, allowed actions are denied.
            windows = policy.properties.get("allow_during")
            if isinstance(windows, list):
                windows = [parse_inline_object(w) if isinstance(w, str) else w for w in windows]
            if windows and len(windows) > 0:
                if not self._in_any_window(windows, now):
                    reasons.append(
                        f"Policy '{policy.id}' denies {query.kind} "
                        f"'{query.value}' (outside allowed time window)."
                    )
                    violating.append(policy.id)
                    allowed = False
                    if strict:
                        blocked = True
                    continue
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

            # 3. v8.1.0: human-approval escalation.
            approvals = policy.properties.get("require_approval")
            if approvals and isinstance(approvals, list):
                approvals = [parse_inline_object(r) if isinstance(r, str) else r for r in approvals]
            if approvals:
                for rule in approvals:
                    if isinstance(rule, dict) and rule.get("kind") == query.kind:
                        if self._matches(query.kind, rule.get("value", ""), query.value):
                            requires_approval = True
                            break

        return PolicyDecision(
            allowed,
            blocked,
            reasons,
            violating,
            requires_approval=requires_approval,
            audit={
                "agent": query.agent,
                "decision": "allow" if allowed else ("block" if blocked else "warn"),
                "timestamp": (now or datetime.now(timezone.utc)).isoformat(),
            },
        )

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


class PolicySuggestion:
    """V7.0.0: structured suggestion emitted when a policy is in ``warn`` mode.

    Carries the proposed action, the triggering policy, and a confidence
    score so callers can decide whether to auto-apply or escalate.
    """

    def __init__(
        self,
        suggestion_id: str,
        policy_id: str,
        action_kind: str,
        action_value: str,
        reason: str,
        confidence: float = 0.5,
        metadata: Optional[Dict[str, Any]] = None,
    ):
        self.suggestion_id = suggestion_id
        self.policy_id = policy_id
        self.action_kind = action_kind
        self.action_value = action_value
        self.reason = reason
        self.confidence = max(0.0, min(1.0, confidence))
        self.metadata = metadata or {}
        self.created_at = datetime.now(timezone.utc).isoformat()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "suggestion_id": self.suggestion_id,
            "policy_id": self.policy_id,
            "action_kind": self.action_kind,
            "action_value": self.action_value,
            "reason": self.reason,
            "confidence": self.confidence,
            "metadata": self.metadata,
            "created_at": self.created_at,
        }

    def __repr__(self) -> str:
        return (
            f"PolicySuggestion(id={self.suggestion_id}, policy={self.policy_id}, "
            f"confidence={self.confidence})"
        )


class PolicyVersion:
    """V7.2.0: immutable snapshot of a policy definition for versioning."""

    def __init__(self, version: str, policy: Dict[str, Any], created_at: str):
        self.version = version
        self.policy = dict(policy)
        self.created_at = created_at

    def to_dict(self) -> Dict[str, Any]:
        return {
            "version": self.version,
            "policy": self.policy,
            "created_at": self.created_at,
        }


class PolicyRollback:
    """V7.2.0: describes a rollback operation from one policy version to another."""

    def __init__(self, policy_id: str, from_version: str, to_version: str, rolled_back_at: str):
        self.policy_id = policy_id
        self.from_version = from_version
        self.to_version = to_version
        self.rolled_back_at = rolled_back_at

    def to_dict(self) -> Dict[str, Any]:
        return {
            "policy_id": self.policy_id,
            "from_version": self.from_version,
            "to_version": self.to_version,
            "rolled_back_at": self.rolled_back_at,
        }
