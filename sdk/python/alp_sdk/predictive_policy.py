"""ALP Predictive Governance (v16.2.0 — V12 The Sentinel Era).

Extends ``PolicyEngine`` with anomaly detection: learns normal behavior
baselines from ``EventStore`` history and flags anomalous requests before
they reach policy evaluation. ``AnomalyScore`` is attached to every
``PolicyDecision`` so callers can see predicted risk factors.

Mirrors the planned ``parser/src/predictive_policy.ts`` surface; tests live
in ``sdk/python/tests/test_predictive_policy.py``.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .event_store import EventStore
from .policy import PolicyDecision, PolicyEngine, PolicyQuery


@dataclass
class AnomalyScore:
    """Quantifies how anomalous a policy query is against learned baselines."""

    score: float
    factors: List[str] = field(default_factory=list)
    baseline: Dict[str, Any] = field(default_factory=dict)
    recommendation: str = "monitor"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "score": self.score,
            "factors": self.factors,
            "baseline": self.baseline,
            "recommendation": self.recommendation,
        }

    def is_anomalous(self, threshold: float = 0.7) -> bool:
        return self.score >= threshold


@dataclass
class BaselineProfile:
    """Learned normal behavior for a policy query kind/value."""

    kind: str
    value: str
    sample_count: int = 0
    mean_frequency: float = 0.0
    stddev_frequency: float = 0.0
    failure_rate: float = 0.0
    last_seen: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "kind": self.kind,
            "value": self.value,
            "sample_count": self.sample_count,
            "mean_frequency": self.mean_frequency,
            "stddev_frequency": self.stddev_frequency,
            "failure_rate": self.failure_rate,
            "last_seen": self.last_seen,
        }


class PredictivePolicyEngine(PolicyEngine):
    """Policy engine with predictive anomaly detection.

    Wraps an existing ``PolicyEngine`` (or a list of ``AlpObject``\u000ds) and
    an ``EventStore`` to learn baselines from historical execution data.
    Every ``evaluate`` call computes an ``AnomalyScore`` and attaches it
    to the returned ``PolicyDecision``.
    """

    def __init__(
        self,
        objects: List[Any],
        event_store: Optional[EventStore] = None,
        z_threshold: float = 2.5,
        min_samples: int = 5,
    ):
        super().__init__(objects)
        self.event_store = event_store
        self.z_threshold = z_threshold
        self.min_samples = min_samples
        self._baselines: Dict[str, BaselineProfile] = {}
        self._history: List[Tuple[PolicyQuery, PolicyDecision]] = []
        if self.event_store is not None:
            self._learn_from_history()

    def _learn_from_history(self) -> None:
        if self.event_store is None:
            return
        events = self.event_store.read_all()
        samples: Dict[str, List[float]] = {}
        counts: Dict[str, int] = {}
        failures: Dict[str, int] = {}
        last_seen: Dict[str, str] = {}

        for event in events:
            kind = event.payload.get("kind")
            value = event.payload.get("value")
            if not kind or not value:
                continue
            key = f"{kind}:{value}"
            counts[key] = counts.get(key, 0) + 1
            samples.setdefault(key, []).append(counts[key])
            if event.payload.get("status") == "[!]" or event.payload.get("blocked"):
                failures[key] = failures.get(key, 0) + 1
            last_seen[key] = event.timestamp

        for key, count in counts.items():
            kind, value = key.split(":", 1)
            freqs = samples[key]
            mean_freq = sum(freqs) / len(freqs)
            stddev_freq = _stddev(freqs) if len(freqs) > 1 else 0.0
            failure_rate = failures.get(key, 0) / count
            profile = BaselineProfile(
                kind=kind,
                value=value,
                sample_count=count,
                mean_frequency=mean_freq,
                stddev_frequency=stddev_freq,
                failure_rate=failure_rate,
                last_seen=last_seen.get(key, ""),
            )
            self._baselines[key] = profile

    def _score_query(self, query: PolicyQuery) -> AnomalyScore:
        key = f"{query.kind}:{query.value}"
        profile = self._baselines.get(key)

        factors: List[str] = []
        score_components: List[float] = []

        if profile is None or profile.sample_count < self.min_samples:
            factors.append("insufficient_history")
            score_components.append(0.3)
        else:
            if profile.failure_rate > 0.3:
                factors.append("high_failure_rate")
                score_components.append(min(profile.failure_rate, 1.0))
            if profile.stddev_frequency > 2.0:
                factors.append("high_frequency_variance")
                score_components.append(0.5)

        recent = [q for q, _ in self._history[-50:] if q.kind == query.kind and q.value == query.value]
        if len(recent) == 0:
            factors.append("rare_request")
            score_components.append(0.4)
        elif len(recent) > 10:
            factors.append("burst")
            score_components.append(0.3)

        score = min(1.0, sum(score_components) / max(len(score_components), 1))

        if score >= 0.8:
            recommendation = "escalate"
        elif score >= 0.5:
            recommendation = "require_approval"
        else:
            recommendation = "monitor"

        return AnomalyScore(
            score=round(score, 3),
            factors=factors,
            baseline=profile.to_dict() if profile else {},
            recommendation=recommendation,
        )

    def evaluate(self, query: PolicyQuery) -> PolicyDecision:
        anomaly = self._score_query(query)
        decision = super().evaluate(query)
        decision.audit = decision.audit or {}
        decision.audit["anomaly"] = anomaly.to_dict()
        self._history.append((query, decision))
        return decision

    def evaluate_deny_only(self, query: PolicyQuery) -> PolicyDecision:
        anomaly = self._score_query(query)
        decision = super().evaluate_deny_only(query)
        decision.audit = decision.audit or {}
        decision.audit["anomaly"] = anomaly.to_dict()
        self._history.append((query, decision))
        return decision

    def evaluate_proposal(self, proposal_id: str, trust_pems: Optional[Dict[str, str]] = None) -> PolicyDecision:
        anomaly = AnomalyScore(score=0.0, factors=[], baseline={}, recommendation="monitor")
        decision = super().evaluate_proposal(proposal_id, trust_pems)
        decision.audit = decision.audit or {}
        decision.audit["anomaly"] = anomaly.to_dict()
        return decision

    def get_baselines(self) -> List[BaselineProfile]:
        return list(self._baselines.values())

    def get_baseline(self, kind: str, value: str) -> Optional[BaselineProfile]:
        return self._baselines.get(f"{kind}:{value}")

    def get_history(self) -> List[Tuple[PolicyQuery, PolicyDecision]]:
        return list(self._history)

    def anomalies_summary(self, policy_id: Optional[str] = None) -> Dict[str, Any]:
        summaries: List[Dict[str, Any]] = []
        for query, decision in self._history:
            anomaly = (decision.audit or {}).get("anomaly") or {}
            if not anomaly:
                continue
            if policy_id is not None and policy_id not in decision.policies:
                continue
            summaries.append({
                "kind": query.kind,
                "value": query.value,
                "score": anomaly.get("score", 0.0),
                "factors": anomaly.get("factors", []),
                "recommendation": anomaly.get("recommendation", "monitor"),
            })
        return {
            "total": len(summaries),
            "anomalous": sum(1 for s in summaries if s["score"] >= self.z_threshold),
            "items": summaries[-20:],
        }


def _stddev(values: List[float]) -> float:
    if len(values) < 2:
        return 0.0
    m = sum(values) / len(values)
    return math.sqrt(sum((x - m) ** 2 for x in values) / (len(values) - 1))
