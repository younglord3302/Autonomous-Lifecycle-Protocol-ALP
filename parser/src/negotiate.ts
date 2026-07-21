/** ALP multi-agent negotiation (v9.0.0 — The Collaborative Era). */

export interface Offer {
  key: string;
  value: any;
  unit?: string;
}

export interface ContractDraft {
  contract_id: string;
  parties: string[];
  terms: Offer[];
  status: string;
}

export interface NegotiationResult {
  success: boolean;
  draft: ContractDraft | null;
  reason?: string;
}

export class Negotiator {
  constructor(private contractEngine?: any) {}

  negotiate(
    agentA: string,
    agentB: string,
    capabilities: Record<string, any>,
    constraints?: Record<string, any>,
  ): NegotiationResult {
    if (!agentA || !agentB) {
      return { success: false, draft: null, reason: 'Both parties must be specified.' };
    }
    if (!capabilities || Object.keys(capabilities).length === 0) {
      return { success: false, draft: null, reason: 'No capabilities provided.' };
    }
    const terms: Offer[] = Object.entries(capabilities).map(([k, v]) => ({ key: k, value: v }));
    if (constraints) {
      for (const [k, v] of Object.entries(constraints)) {
        terms.push({ key: k, value: v, unit: 'constraint' });
      }
    }
    const draft: ContractDraft = {
      contract_id: `contract-${agentA}-${agentB}`,
      parties: [agentA, agentB],
      terms,
      status: 'agreed',
    };
    if (this.contractEngine) {
      try {
        this.contractEngine.check(draft.contract_id, { parties: [agentA, agentB] });
      } catch {
        draft.status = 'pending_validation';
      }
    }
    return { success: true, draft };
  }

  propose(agent: string, offer: Record<string, any>): Record<string, any> {
    return { from: agent, offer, status: 'proposed' };
  }

  accept(proposal: Record<string, any>): Record<string, any> {
    proposal.status = 'accepted';
    return proposal;
  }

  reject(proposal: Record<string, any>, reason: string): Record<string, any> {
    proposal.status = 'rejected';
    proposal.reason = reason;
    return proposal;
  }
}

export class ReputationStore {
  private scores: Record<string, { fulfilled: number; breached: number; score: number }> = {};

  recordFulfillment(agent: string, weight = 1.0): void {
    const entry = this.scores[agent] ?? { fulfilled: 0, breached: 0, score: 0.5 };
    entry.fulfilled += weight;
    entry.score = this.compute(entry);
    this.scores[agent] = entry;
  }

  recordBreach(agent: string, weight = 1.0): void {
    const entry = this.scores[agent] ?? { fulfilled: 0, breached: 0, score: 0.5 };
    entry.breached += weight;
    entry.score = this.compute(entry);
    this.scores[agent] = entry;
  }

  getScore(agent: string): number {
    return this.scores[agent]?.score ?? 0.5;
  }

  topAgents(limit = 10): Array<{ agent: string; score: number; fulfilled: number; breached: number }> {
    return Object.entries(this.scores)
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, limit)
      .map(([agent, v]) => ({ agent, score: v.score, fulfilled: v.fulfilled, breached: v.breached }));
  }

  private compute(entry: { fulfilled: number; breached: number }): number {
    const total = entry.fulfilled + entry.breached;
    if (total === 0) return 0.5;
    return Math.max(0, Math.min(1, entry.fulfilled / total));
  }
}

export interface Capability {
  name: string;
  slas?: Record<string, any>;
  price?: number;
}

export interface TeamQuery {
  requires: string[];
  size?: number;
}

export class TeamComposer {
  constructor(private reputationStore: ReputationStore = new ReputationStore()) {}

  compose(query: TeamQuery, candidates: Array<Record<string, any>>): Array<Record<string, any>> {
    const required = query.requires ?? [];
    if (!required.length) return candidates.slice(0, query.size ?? candidates.length);
    const matched = candidates.filter((c) => {
      const caps = (c.capabilities ?? []).map((cap: any) => cap.name);
      return required.every((r) => caps.includes(r));
    });
    const size = query.size ?? matched.length;
    matched.sort((a, b) => this.reputationStore.getScore(b.agent ?? '') - this.reputationStore.getScore(a.agent ?? ''));
    return matched.slice(0, size);
  }

  suggestTeam(query: TeamQuery, registry: Array<Record<string, any>>): Array<Record<string, any>> {
    return this.compose(query, registry);
  }
}
