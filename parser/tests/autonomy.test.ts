import { describe, it, expect } from 'vitest';
import { WorkflowMutator, AdaptiveEngine, AutonomyController } from '../src/autonomy';

describe('WorkflowMutator', () => {
  it('proposes an edit', () => {
    const mutator = new WorkflowMutator();
    const proposal = mutator.proposeEdit('wf-1', [{ op: 'add_step', value: { id: 's1' } }], 'add step');
    expect(proposal.workflow_id).toBe('wf-1');
    expect(proposal.status).toBe('pending');
    expect(proposal.edits.length).toBe(1);
  });

  it('approves and applies edits', () => {
    const mutator = new WorkflowMutator();
    const proposal = mutator.proposeEdit('wf-1', [{ op: 'add_step', value: { id: 's1' } }], 'add');
    const wf = { steps: [] };
    const updated = mutator.approve(proposal.proposal_id, wf);
    expect(updated.steps.length).toBe(1);
    expect(proposal.status).toBe('approved');
  });

  it('denies on policy failure', () => {
    const badPolicy = { evaluateProposal: (_id: string, _ctx: any) => { throw new Error('denied'); } };
    const mutator = new WorkflowMutator(badPolicy as any);
    const proposal = mutator.proposeEdit('wf-1', [{ op: 'add_step' }], 'bad');
    expect(() => mutator.approve(proposal.proposal_id, {})).toThrow('denied');
    expect(proposal.status).toBe('denied');
  });

  it('rolls back to snapshot', () => {
    const mutator = new WorkflowMutator();
    const proposal = mutator.proposeEdit('wf-1', [{ op: 'add_step', value: { id: 's1' } }], 'add');
    const original = { steps: [{ id: 's0' }] };
    mutator.approve(proposal.proposal_id, original);
    const restored = mutator.rollback(proposal.proposal_id);
    expect(restored?.steps).toEqual([{ id: 's0' }]);
  });
});

describe('AdaptiveEngine', () => {
  it('tunes retry count from latency', () => {
    const engine = new AdaptiveEngine();
    engine.observe({ kind: 'latency', p99: 1500 });
    expect(engine.getTuning('retry.max_attempts')).toBe(4);
  });

  it('tunes circuit breaker from error rate', () => {
    const engine = new AdaptiveEngine();
    engine.observe({ kind: 'error_rate', rate: 0.3 });
    const threshold = engine.getTuning('circuit_breaker.threshold');
    expect(threshold).toBeGreaterThan(0);
    expect(threshold).toBeLessThanOrEqual(0.5);
  });

  it('tunes pool size from throughput', () => {
    const engine = new AdaptiveEngine();
    engine.observe({ kind: 'throughput', rps: 150 });
    expect(engine.getTuning('pool.size')).toBe(15);
  });
});

describe('AutonomyController', () => {
  it('starts a swarm', () => {
    const controller = new AutonomyController();
    const run = controller.startSwarm('swarm-1', { steps: [] });
    expect(run.swarm_id).toBe('swarm-1');
    expect(run.status).toBe('running');
  });

  it('proposes and applies mutation', () => {
    const controller = new AutonomyController();
    controller.startSwarm('swarm-1', { steps: [] });
    const proposal = controller.proposeMutation('swarm-1', [{ op: 'add_step', value: { id: 's1' } }], 'add');
    expect(proposal).toBeDefined();
    const updated = controller.applyMutation('swarm-1', proposal!.proposal_id);
    expect(updated?.steps?.length).toBe(1);
  });

  it('rolls back mutation', () => {
    const controller = new AutonomyController();
    controller.startSwarm('swarm-1', { steps: [{ id: 's0' }] });
    const proposal = controller.proposeMutation('swarm-1', [{ op: 'add_step', value: { id: 's1' } }], 'add');
    controller.applyMutation('swarm-1', proposal!.proposal_id);
    const restored = controller.rollbackMutation('swarm-1', proposal!.proposal_id);
    expect(restored?.steps).toEqual([{ id: 's0' }]);
  });

  it('observes signals', () => {
    const controller = new AutonomyController();
    controller.startSwarm('swarm-1', { steps: [] });
    controller.observeSignal('swarm-1', { kind: 'latency', p99: 2000 });
    expect(controller.adaptive.getTuning('retry.max_attempts')).toBe(5);
  });

  it('filters decisions by swarm', () => {
    const controller = new AutonomyController();
    controller.startSwarm('swarm-1', { steps: [] });
    controller.startSwarm('swarm-2', { steps: [] });
    controller.proposeMutation('swarm-1', [], 'a');
    controller.proposeMutation('swarm-2', [], 'b');
    expect(controller.getDecisions('swarm-1').length).toBe(1);
    expect(controller.getDecisions('swarm-2').length).toBe(1);
    expect(controller.getDecisions().length).toBe(2);
  });
});
