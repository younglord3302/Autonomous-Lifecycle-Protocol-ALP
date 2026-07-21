"""ALP anomaly detection (v7.2.0 — Adaptive Policy & Continuous Governance).

Detects statistical anomalies in agent and task behavior using
baseline profiles computed from historical event data.
"""

import math
from typing import Any, Dict, List, Optional


class AnomalyDetector:
    """Statistical anomaly detector for runtime events.

    Computes baselines from a training window of events and flags
    new observations that deviate beyond a configurable z-score
    threshold.
    """

    def __init__(self, events: List[Dict[str, Any]], z_threshold: float = 3.0):
        self.events = events
        self.z_threshold = z_threshold
        self.baselines = self._compute_baselines()

    def _compute_baselines(self) -> Dict[str, Any]:
        task_cycles: List[float] = []
        task_failures: List[int] = []
        task_handoffs: List[int] = []
        agent_claims: Dict[str, int] = {}
        agent_failures: Dict[str, int] = {}

        for e in self.events:
            etype = e.get("type", "")
            tid = e.get("task_id")
            agent = e.get("agent")
            if etype == "task_status" and tid:
                status = e.get("status")
                if status == "[!]":
                    task_failures.append(1)
                else:
                    task_failures.append(0)
            if etype == "human_handoff" and tid:
                task_handoffs.append(1)
            if agent:
                agent_claims[agent] = agent_claims.get(agent, 0) + 1
                if etype == "workflow_fail" or e.get("status") == "[!]":
                    agent_failures[agent] = agent_failures.get(agent, 0) + 1

        return {
            "task_cycle_mean": None,
            "task_cycle_stddev": None,
            "failure_rate_mean": _mean(task_failures) if task_failures else 0.0,
            "failure_rate_stddev": _stddev(task_failures) if task_failures else 0.0,
            "handoff_rate_mean": _mean(task_handoffs) if task_handoffs else 0.0,
            "handoff_rate_stddev": _stddev(task_handoffs) if task_handoffs else 0.0,
            "agent_claims": agent_claims,
            "agent_failures": agent_failures,
        }

    def detect(self, event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Flag an event as anomalous if it exceeds the z-score threshold."""
        etype = event.get("type", "")
        agent = event.get("agent")
        anomalies: List[str] = []

        if etype == "task_status" and event.get("status") == "[!]":
            rate = self.baselines["failure_rate_mean"]
            std = self.baselines["failure_rate_stddev"]
            if std > 0:
                z = abs(1.0 - rate) / std
                if z > self.z_threshold:
                    anomalies.append("failure_spike")
            elif rate == 0.0:
                anomalies.append("failure_spike")

        if etype == "human_handoff":
            rate = self.baselines["handoff_rate_mean"]
            std = self.baselines["handoff_rate_stddev"]
            if std > 0 and rate > 0:
                z = (1.0 - rate) / std
                if z > self.z_threshold:
                    anomalies.append("handoff_spike")

        if agent:
            claims = self.baselines["agent_claims"].get(agent, 0)
            failures = self.baselines["agent_failures"].get(agent, 0)
            if claims > 0:
                failure_ratio = failures / claims
                baseline_failure = self.baselines["failure_rate_mean"]
                std = self.baselines["failure_rate_stddev"]
                if std > 0:
                    z = abs(failure_ratio - baseline_failure) / std
                    if z > self.z_threshold:
                        anomalies.append("agent_failure_rate")

        if anomalies:
            return {
                "event": event,
                "anomalies": anomalies,
                "z_threshold": self.z_threshold,
                "detected_at": event.get("timestamp"),
            }
        return None

    def detect_batch(self, events: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        results = [self.detect(e) for e in events]
        return [r for r in results if r is not None]

    def update_threshold(self, z_threshold: float) -> None:
        self.z_threshold = z_threshold


def _mean(values: List[float]) -> float:
    if not values:
        return 0.0
    return sum(values) / len(values)


def _stddev(values: List[float]) -> float:
    if len(values) < 2:
        return 0.0
    m = _mean(values)
    variance = sum((x - m) ** 2 for x in values) / (len(values) - 1)
    return math.sqrt(variance)
