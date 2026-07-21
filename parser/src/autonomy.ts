/** ALP autonomy runtime (v11.0.0 — The Ambient Era). */

export interface EditProposal {
  proposal_id: string;
  workflow_id: string;
  edits: Record<string, any>[];
  rationale: string;
  status: string;
  created_at: string;
  reviewed_at?: string;
  review_note?: string;
}

export interface EnvironmentSignal {
  kind: string;
  [key: string]: any;
}

export class WorkflowMutator {
  private proposals: Map<string, EditProposal> = new Map();
  private snapshots: Map<string, Record<string, any>> = new Map();

  constructor(private policyEngine?: any) {}

  proposeEdit(workflowId: string, edits: Record<string, any>[], rationale: string): EditProposal {
    const proposalId = `prop-${workflowId}-${this.proposals.size + 1}`;
    const proposal: EditProposal = {
      proposal_id: proposalId,
      workflow_id: workflowId,
      edits,
      rationale,
      status: 'pending',
      created_at: new Date().toISOString(),
    };
    this.proposals.set(proposalId, proposal);
    return proposal;
  }

  approve(proposalId: string, workflow: Record<string, any>): Record<string, any> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) throw new Error(`Proposal ${proposalId} not found.`);
    if (this.policyEngine) {
      try {
        this.policyEngine.evaluateProposal(proposalId, { edits: proposal.edits });
      } catch (exc) {
        proposal.status = 'denied';
        proposal.reviewed_at = new Date().toISOString();
        proposal.review_note = String(exc);
        throw exc;
      }
    }
    this.snapshots.set(proposalId, JSON.parse(JSON.stringify(workflow)));
    const updated = JSON.parse(JSON.stringify(workflow));
    for (const edit of proposal.edits) {
      applyEdit(updated, edit);
    }
    proposal.status = 'approved';
    proposal.reviewed_at = new Date().toISOString();
    proposal.review_note = 'approved';
    return updated;
  }

  rollback(proposalId: string): Record<string, any> | undefined {
    const snapshot = this.snapshots.get(proposalId);
    const proposal = this.proposals.get(proposalId);
    if (proposal) {
      proposal.status = 'rolled_back';
      proposal.reviewed_at = new Date().toISOString();
      proposal.review_note = 'rolled back';
    }
    return snapshot;
  }
}

export class AdaptiveEngine {
  private signals: EnvironmentSignal[] = [];
  private tuning: Record<string, any> = {};

  observe(signal: EnvironmentSignal): void {
    signal._observed_at = new Date().toISOString();
    this.signals.push(signal);
    this.recalc(signal);
  }

  getTuning(key: string, defaultValue?: any): any {
    return this.tuning[key] ?? defaultValue;
  }

  private recalc(latest: EnvironmentSignal): void {
    const kind = latest.kind;
    if (kind === 'latency') {
      const p99 = latest.p99 ?? 0;
      this.tuning['retry.max_attempts'] = Math.max(1, Math.min(5, Math.floor(p99 / 500) + 1));
    } else if (kind === 'error_rate') {
      const rate = latest.rate ?? 0;
      this.tuning['circuit_breaker.threshold'] = Math.max(0.01, Math.min(0.5, rate * 2));
    } else if (kind === 'throughput') {
      this.tuning['pool.size'] = Math.max(1, Math.floor((latest.rps ?? 0) / 10));
    }
  }
}

export interface SwarmRun {
  swarm_id: string;
  workflow: Record<string, any>;
  status: string;
  started_at: string;
  decisions: Record<string, any>[];
  signals?: EnvironmentSignal[];
}

export class AutonomyController {
  private runs: Map<string, SwarmRun> = new Map();
  private decisions: Record<string, any>[] = [];

  constructor(public mutator: WorkflowMutator = new WorkflowMutator(), public adaptive: AdaptiveEngine = new AdaptiveEngine()) {}

  startSwarm(swarmId: string, workflow: Record<string, any>): SwarmRun {
    const run: SwarmRun = {
      swarm_id: swarmId,
      workflow: JSON.parse(JSON.stringify(workflow)),
      status: 'running',
      started_at: new Date().toISOString(),
      decisions: [],
    };
    this.runs.set(swarmId, run);
    return run;
  }

  proposeMutation(swarmId: string, edits: Record<string, any>[], rationale: string): EditProposal | undefined {
    const run = this.runs.get(swarmId);
    if (!run) return undefined;
    const proposal = this.mutator.proposeEdit(swarmId, edits, rationale);
    const decision = {
      swarm_id: swarmId,
      proposal_id: proposal.proposal_id,
      kind: 'mutation_proposed',
      rationale,
      timestamp: new Date().toISOString(),
    };
    run.decisions.push(decision);
    this.decisions.push(decision);
    return proposal;
  }

  applyMutation(swarmId: string, proposalId: string): Record<string, any> | undefined {
    const run = this.runs.get(swarmId);
    if (!run) return undefined;
    try {
      const updated = this.mutator.approve(proposalId, run.workflow);
      run.workflow = updated;
      const decision = {
        swarm_id: swarmId,
        proposal_id: proposalId,
        kind: 'mutation_applied',
        timestamp: new Date().toISOString(),
      };
      run.decisions.push(decision);
      this.decisions.push(decision);
      return updated;
    } catch (exc) {
      const decision = {
        swarm_id: swarmId,
        proposal_id: proposalId,
        kind: 'mutation_denied',
        reason: String(exc),
        timestamp: new Date().toISOString(),
      };
      run.decisions.push(decision);
      this.decisions.push(decision);
      return undefined;
    }
  }

  rollbackMutation(swarmId: string, proposalId: string): Record<string, any> | undefined {
    const run = this.runs.get(swarmId);
    if (!run) return undefined;
    const snapshot = this.mutator.rollback(proposalId);
    if (snapshot) {
      run.workflow = snapshot;
      const decision = {
        swarm_id: swarmId,
        proposal_id: proposalId,
        kind: 'mutation_rolled_back',
        timestamp: new Date().toISOString(),
      };
      run.decisions.push(decision);
      this.decisions.push(decision);
    }
    return snapshot;
  }

  observeSignal(swarmId: string, signal: EnvironmentSignal): void {
    this.adaptive.observe(signal);
    const run = this.runs.get(swarmId);
    if (run) {
      run.signals = run.signals ?? [];
      run.signals.push(signal);
    }
  }

  getDecisions(swarmId?: string): Record<string, any>[] {
    if (swarmId) {
      const run = this.runs.get(swarmId);
      return run?.decisions ?? [];
    }
    return [...this.decisions];
  }
}

function applyEdit(workflow: Record<string, any>, edit: Record<string, any>): Record<string, any> {
  const target = edit.target as string | undefined;
  const op = edit.op || 'update';
  const value = edit.value;
  if (op === 'update' && target) {
    const parts = target.split('.');
    let obj: any = workflow;
    for (const p of parts.slice(0, -1)) {
      obj = obj[p] ??= {};
    }
    obj[parts[parts.length - 1]] = value;
  } else if (op === 'add_step') {
    const steps = workflow.steps ?? [];
    steps.push(value);
    workflow.steps = steps;
  } else if (op === 'remove_step') {
    const steps = workflow.steps ?? [];
    workflow.steps = steps.filter((s: any) => s.id !== target);
  }
  return workflow;
}
