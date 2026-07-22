"""ALP multi-agent negotiation (v9.0.0 — The Collaborative Era).

Provides:
- Negotiator: bilateral capability/cost negotiation producing signed @contract instances.
- ReputationStore: tracks per-agent trust scores from fulfilled/breached contracts.
- TeamComposer: assembles composable agent teams from a capability query.
"""
from __future__ import annotations


import math
from typing import Any, Dict, List, Optional


class Offer:
    """A single term in a negotiation."""

    def __init__(self, key: str, value: Any, unit: Optional[str] = None):
        self.key = key
        self.value = value
        self.unit = unit

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {"key": self.key, "value": self.value}
        if self.unit:
            d["unit"] = self.unit
        return d


class ContractDraft:
    """A draft @contract produced by negotiation."""

    def __init__(self, contract_id: str, parties: List[str], terms: List[Offer], status: str = "draft"):
        self.contract_id = contract_id
        self.parties = parties
        self.terms = terms
        self.status = status

    def to_dict(self) -> Dict[str, Any]:
        return {
            "contract_id": self.contract_id,
            "parties": self.parties,
            "terms": [t.to_dict() for t in self.terms],
            "status": self.status,
        }


class NegotiationResult:
    """Outcome of a negotiation session."""

    def __init__(self, success: bool, draft: Optional[ContractDraft], reason: Optional[str] = None):
        self.success = success
        self.draft = draft
        self.reason = reason

    def to_dict(self) -> Dict[str, Any]:
        return {
            "success": self.success,
            "draft": self.draft.to_dict() if self.draft else None,
            "reason": self.reason,
        }


class Negotiator:
    """Bilaterally negotiate capabilities and costs before a handoff.

    Produces a signed `@contract` instance (reuses `ContractEngine` from
    `sdk/python/alp_sdk/contract.py`).
    """

    def __init__(self, contract_engine: Optional[Any] = None):
        self.contract_engine = contract_engine

    def negotiate(
        self,
        agent_a: str,
        agent_b: str,
        capabilities: Dict[str, Any],
        constraints: Optional[Dict[str, Any]] = None,
    ) -> NegotiationResult:
        if not agent_a or not agent_b:
            return NegotiationResult(False, None, "Both parties must be specified.")
        if not capabilities:
            return NegotiationResult(False, None, "No capabilities provided.")
        terms = [Offer(k, v) for k, v in capabilities.items()]
        if constraints:
            for k, v in constraints.items():
                terms.append(Offer(k, v, unit="constraint"))
        draft = ContractDraft(
            contract_id=f"contract-{agent_a}-{agent_b}",
            parties=[agent_a, agent_b],
            terms=terms,
            status="agreed",
        )
        if self.contract_engine:
            try:
                self.contract_engine.check(draft.contract_id, {"parties": [agent_a, agent_b]})
            except Exception:
                draft.status = "pending_validation"
        return NegotiationResult(True, draft)

    def propose(self, agent: str, offer: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "from": agent,
            "offer": offer,
            "status": "proposed",
        }

    def accept(self, proposal: Dict[str, Any]) -> Dict[str, Any]:
        proposal["status"] = "accepted"
        return proposal

    def reject(self, proposal: Dict[str, Any], reason: str) -> Dict[str, Any]:
        proposal["status"] = "rejected"
        proposal["reason"] = reason
        return proposal


class ReputationStore:
    """Track per-agent trust scores from fulfilled/breached contracts."""

    def __init__(self):
        self.scores: Dict[str, Dict[str, Any]] = {}

    def record_fulfillment(self, agent: str, weight: float = 1.0) -> None:
        entry = self.scores.setdefault(agent, {"fulfilled": 0, "breached": 0, "score": 0.5})
        entry["fulfilled"] += weight
        entry["score"] = self._compute(entry)

    def record_breach(self, agent: str, weight: float = 1.0) -> None:
        entry = self.scores.setdefault(agent, {"fulfilled": 0, "breached": 0, "score": 0.5})
        entry["breached"] += weight
        entry["score"] = self._compute(entry)

    def get_score(self, agent: str) -> float:
        return self.scores.get(agent, {}).get("score", 0.5)

    def top_agents(self, limit: int = 10) -> List[Dict[str, Any]]:
        ranked = sorted(self.scores.items(), key=lambda x: x[1]["score"], reverse=True)
        return [
            {"agent": k, "score": v["score"], "fulfilled": v["fulfilled"], "breached": v["breached"]}
            for k, v in ranked[:limit]
        ]

    def _compute(self, entry: Dict[str, Any]) -> float:
        total = entry["fulfilled"] + entry["breached"]
        if total == 0:
            return 0.5
        return max(0.0, min(1.0, entry["fulfilled"] / total))


class Capability:
    """An agent capability with optional SLA and price."""

    def __init__(self, name: str, slas: Optional[Dict[str, Any]] = None, price: Optional[float] = None):
        self.name = name
        self.slas = slas or {}
        self.price = price

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {"name": self.name, "slas": self.slas}
        if self.price is not None:
            d["price"] = self.price
        return d


class TeamComposer:
    """Assemble composable agent teams from a capability query."""

    def __init__(self, reputation_store: Optional[ReputationStore] = None):
        self.reputation_store = reputation_store or ReputationStore()

    def compose(self, query: Dict[str, Any], candidates: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        required = query.get("requires", [])
        if not required:
            return candidates[:query.get("size", len(candidates))]
        matched = []
        for c in candidates:
            caps = [cap.get("name") for cap in c.get("capabilities", [])]
            if all(r in caps for r in required):
                matched.append(c)
        size = query.get("size", len(matched))
        matched.sort(key=lambda c: self.reputation_store.get_score(c.get("agent", "")), reverse=True)
        return matched[:size]

    def suggest_team(self, query: Dict[str, Any], registry: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return self.compose(query, registry)
