"""ALP Policy Federation (v7.2.0 — Python SDK parity, spec/03 §25, V4 Pillar).

Extends the atomic ``PolicyEngine`` (``policy.py``) with multi-source
*federation*: policies can originate from the local project, every member
project in a workspace (cross-project governance), and a hosted registry
namespace (``@ns/policy``). All sources are aggregated into one effective
decision so an autonomous agent is governed by the union of every policy that
applies to it — while still honoring ``deny_*``-beats-``allow_*`` and
``enforcement: warn`` per source.

This mirrors the V4 "Policy & Permission Governance" pillar: unattended
swarms are safe because policy is enforced across projects and the registry,
with a full audit trail of which source produced which decision.
"""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from .models import AlpObject
from .policy import PolicyDecision, PolicyEngine, PolicyQuery


@dataclass
class PolicySource:
    """A set of ``@policy`` objects contributed by one governance scope."""

    scope: str
    engine: PolicyEngine
    metadata: Dict[str, Any] = field(default_factory=dict)

    @property
    def count(self) -> int:
        return self.engine.count


@dataclass
class FederatedDecision:
    """Aggregate decision across all federated sources."""

    allowed: bool
    blocked: bool
    reasons: List[str]
    policies: List[str]
    sources: List[str]
    per_source: List[Dict[str, Any]] = field(default_factory=list)

    def __repr__(self) -> str:
        return (
            f"FederatedDecision(allowed={self.allowed}, blocked={self.blocked}, "
            f"sources={self.sources})"
        )


class PolicyFederation:
    """Aggregates ``@policy`` objects from multiple governance scopes."""

    def __init__(self, sources: Optional[List[PolicySource]] = None):
        self.sources: List[PolicySource] = list(sources or [])

    # ── Construction helpers ───────────────────────────────────────────────

    @classmethod
    def from_objects(
        cls, objects: List[AlpObject], scope: str = "local"
    ) -> "PolicyFederation":
        """Build a federation from a single flat object list (one scope)."""
        engine = PolicyEngine(objects)
        return cls([PolicySource(scope, engine)])

    @classmethod
    def from_workspace(cls, loader: Any, workspace_scope: str = "workspace") -> "PolicyFederation":
        """Federate ``@policy`` objects across every member project.

        Pulls policies from each member project discovered by a
        ``WorkspaceLoader`` so one agent is governed by the union of all
        project-level policies in the workspace (spec/03 §25 cross-project
        governance).
        """
        sources: List[PolicySource] = []
        try:
            projects = getattr(loader, "projects", None)
            if projects is None and hasattr(loader, "discover"):
                loader.discover()
                projects = getattr(loader, "projects", None)
            project_ids = list(projects.keys()) if isinstance(projects, dict) else []
        except Exception:
            project_ids = []

        for pid in project_ids:
            try:
                objs = loader.objects_for_project(pid)
            except Exception:
                objs = []
            engine = PolicyEngine(objs)
            if engine.count > 0:
                sources.append(PolicySource(f"{workspace_scope}:{pid}", engine))

        # Also include workspace-root policies if the loader exposes them.
        root = getattr(loader, "root_objects", None)
        if root:
            root_engine = PolicyEngine(root)
            if root_engine.count > 0:
                sources.append(PolicySource(f"{workspace_scope}:root", root_engine))

        return cls(sources)

    def add_source(
        self,
        objects: List[AlpObject],
        scope: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Add a governance scope (e.g. a registry namespace)."""
        self.sources.append(PolicySource(scope, PolicyEngine(objects), metadata or {}))

    def add_registry_policies(
        self, policies: List[Dict[str, Any]], namespace: str
    ) -> None:
        """Add namespaced ``@ns/policy`` objects from a hosted registry.

        ``policies`` is a list of plain dicts (as served by the registry
        ``/api/registry/-/<ns>/<name>/meta.json``), each converted into an
        ``AlpObject`` so it can be evaluated by the same engine.
        """
        objs = [AlpObject.from_dict(p) if isinstance(p, dict) else p for p in policies]
        self.add_source(objs, f"registry:@{namespace}", {"namespace": namespace})

    # ── Evaluation ──────────────────────────────────────────────────────────

    def evaluate(self, query: PolicyQuery) -> FederatedDecision:
        """Aggregate the decision across every source.

        ``deny_*``/strict from ANY source wins (union of denials). A source
        without governing policies for the agent is neutral.
        """
        reasons: List[str] = []
        violating: List[str] = []
        sources_hit: List[str] = []
        per_source: List[Dict[str, Any]] = []
        allowed = True
        blocked = False

        for src in self.sources:
            d: PolicyDecision = src.engine.evaluate(query)
            per_source.append(
                {
                    "scope": src.scope,
                    "allowed": d.allowed,
                    "blocked": d.blocked,
                    "policies": list(d.policies),
                }
            )
            if d.policies or not d.allowed:
                sources_hit.append(src.scope)
            reasons.extend(d.reasons)
            violating.extend(d.policies)
            if not d.allowed:
                allowed = False
            if d.blocked:
                blocked = True

        return FederatedDecision(
            allowed=allowed,
            blocked=blocked,
            reasons=reasons,
            policies=violating,
            sources=sources_hit,
            per_source=per_source,
        )

    def evaluate_deny_only(self, query: PolicyQuery) -> FederatedDecision:
        """Like ``evaluate`` but every source ignores ``allow_*`` lists."""
        reasons: List[str] = []
        violating: List[str] = []
        sources_hit: List[str] = []
        per_source: List[Dict[str, Any]] = []
        allowed = True
        blocked = False

        for src in self.sources:
            d: PolicyDecision = src.engine.evaluate_deny_only(query)
            per_source.append(
                {
                    "scope": src.scope,
                    "allowed": d.allowed,
                    "blocked": d.blocked,
                    "policies": list(d.policies),
                }
            )
            if d.policies:
                sources_hit.append(src.scope)
            reasons.extend(d.reasons)
            violating.extend(d.policies)
            if not d.allowed:
                allowed = False
            if d.blocked:
                blocked = True

        return FederatedDecision(
            allowed=allowed,
            blocked=blocked,
            reasons=reasons,
            policies=violating,
            sources=sources_hit,
            per_source=per_source,
        )

    def scopes(self) -> List[str]:
        return [s.scope for s in self.sources]

    def audit_trail(self, query: PolicyQuery) -> Dict[str, Any]:
        """Structured audit record of a query and its federated decision."""
        decision = self.evaluate(query)
        return {
            "query": {"kind": query.kind, "value": query.value, "agent": query.agent},
            "allowed": decision.allowed,
            "blocked": decision.blocked,
            "sources_evaluated": self.scopes(),
            "sources_violated": decision.sources,
            "reasons": decision.reasons,
            "policies": decision.policies,
            "per_source": decision.per_source,
        }


__all__ = [
    "PolicyFederation",
    "PolicySource",
    "FederatedDecision",
]
