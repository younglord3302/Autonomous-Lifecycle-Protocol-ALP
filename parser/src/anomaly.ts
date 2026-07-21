/** ALP anomaly detection (v7.2.0 — Adaptive Policy & Continuous Governance). */

import { StoredEvent } from './state-store';

export interface AnomalyResult {
  event: StoredEvent;
  anomalies: string[];
  z_threshold: number;
  detected_at?: string;
}

export class AnomalyDetector {
  private baselines: Record<string, any>;
  private zThreshold: number;

  constructor(events: StoredEvent[], zThreshold = 3.0) {
    this.zThreshold = zThreshold;
    this.baselines = this.computeBaselines(events);
  }

  private computeBaselines(events: StoredEvent[]): Record<string, any> {
    const failureRates: number[] = [];
    const handoffRates: number[] = [];
    const agentClaims: Record<string, number> = {};
    const agentFailures: Record<string, number> = {};

    for (const e of events) {
      if (e.type === 'task_status' && e.status === '[!]') failureRates.push(1);
      else if (e.type === 'task_status') failureRates.push(0);
      if (e.type === 'human_handoff') handoffRates.push(1);
      if (e.agent) {
        agentClaims[e.agent] = (agentClaims[e.agent] || 0) + 1;
        if (e.type === 'workflow_fail' || e.status === '[!]') {
          agentFailures[e.agent] = (agentFailures[e.agent] || 0) + 1;
        }
      }
    }

    return {
      failure_rate_mean: mean(failureRates),
      failure_rate_stddev: stddev(failureRates),
      handoff_rate_mean: mean(handoffRates),
      handoff_rate_stddev: stddev(handoffRates),
      agent_claims: agentClaims,
      agent_failures: agentFailures,
    };
  }

  detect(event: StoredEvent): AnomalyResult | undefined {
    const anomalies: string[] = [];
    const { failure_rate_mean, failure_rate_stddev, handoff_rate_mean, handoff_rate_stddev, agent_claims, agent_failures } = this.baselines;

    if (event.type === 'task_status' && event.status === '[!]') {
      if (failure_rate_stddev > 0) {
        const z = Math.abs(1 - failure_rate_mean) / failure_rate_stddev;
        if (z > this.zThreshold) anomalies.push('failure_spike');
      } else if (failure_rate_mean === 0) {
        anomalies.push('failure_spike');
      }
    }

    if (event.type === 'human_handoff') {
      if (handoff_rate_stddev > 0) {
        const z = Math.abs(1 - handoff_rate_mean) / handoff_rate_stddev;
        if (z > this.zThreshold) anomalies.push('handoff_spike');
      }
    }

    if (event.agent) {
      const claims = agent_claims[event.agent] || 0;
      const failures = agent_failures[event.agent] || 0;
      if (claims > 0 && failure_rate_stddev > 0) {
        const ratio = failures / claims;
        const z = Math.abs(ratio - failure_rate_mean) / failure_rate_stddev;
        if (z > this.zThreshold) anomalies.push('agent_failure_rate');
      }
    }

    if (anomalies.length === 0) return undefined;
    return { event, anomalies, z_threshold: this.zThreshold, detected_at: event.timestamp };
  }

  detectBatch(events: StoredEvent[]): AnomalyResult[] {
    return events.map((e) => this.detect(e)).filter((r): r is AnomalyResult => r !== undefined);
  }

  updateThreshold(zThreshold: number): void {
    this.zThreshold = zThreshold;
  }
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((s, n) => s + n, 0) / values.length;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((s, n) => s + (n - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}
