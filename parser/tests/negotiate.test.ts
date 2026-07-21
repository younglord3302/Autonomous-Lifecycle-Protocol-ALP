import { describe, it, expect } from 'vitest';
import { Negotiator, ReputationStore, TeamComposer } from '../src/negotiate';

describe('Negotiator', () => {
  it('negotiates capabilities between two agents', () => {
    const neg = new Negotiator();
    const result = neg.negotiate('agent-a', 'agent-b', { cost: 10, time: '1h' });
    expect(result.success).toBe(true);
    expect(result.draft).not.toBeNull();
    expect(result.draft!.parties).toEqual(['agent-a', 'agent-b']);
  });

  it('fails when parties are missing', () => {
    const neg = new Negotiator();
    const result = neg.negotiate('', 'agent-b', { cost: 10 });
    expect(result.success).toBe(false);
    expect(result.reason).toBe('Both parties must be specified.');
  });

  it('includes constraints as terms with unit', () => {
    const neg = new Negotiator();
    const result = neg.negotiate('a', 'b', { cost: 5 }, { max_time: '2h' });
    expect(result.success).toBe(true);
    const constraintTerms = result.draft!.terms.filter((t) => t.unit === 'constraint');
    expect(constraintTerms.length).toBeGreaterThanOrEqual(1);
  });

  it('proposes, accepts, and rejects', () => {
    const neg = new Negotiator();
    let proposal = neg.propose('agent-a', { cost: 10 });
    expect(proposal.status).toBe('proposed');
    proposal = neg.accept(proposal);
    expect(proposal.status).toBe('accepted');
    proposal = neg.reject(proposal, 'too expensive');
    expect(proposal.status).toBe('rejected');
    expect(proposal.reason).toBe('too expensive');
  });
});

describe('ReputationStore', () => {
  it('starts with neutral score', () => {
    const store = new ReputationStore();
    expect(store.getScore('new-agent')).toBe(0.5);
  });

  it('improves score on fulfillment', () => {
    const store = new ReputationStore();
    store.recordFulfillment('agent-1');
    expect(store.getScore('agent-1')).toBeGreaterThan(0.5);
  });

  it('lowers score on breach', () => {
    const store = new ReputationStore();
    store.recordFulfillment('agent-1', 3);
    store.recordBreach('agent-1', 7);
    expect(store.getScore('agent-1')).toBeLessThan(0.5);
  });

  it('topAgents returns sorted list', () => {
    const store = new ReputationStore();
    store.recordFulfillment('good', 10);
    store.recordBreach('bad', 10);
    const top = store.topAgents(2);
    expect(top[0].agent).toBe('good');
  });
});

describe('TeamComposer', () => {
  it('matches required capabilities', () => {
    const store = new ReputationStore();
    const composer = new TeamComposer(store);
    const candidates = [
      { agent: 'a1', capabilities: [{ name: 'code' }, { name: 'test' }] },
      { agent: 'a2', capabilities: [{ name: 'design' }] },
    ];
    const result = composer.compose({ requires: ['code'], size: 2 }, candidates);
    expect(result.length).toBe(1);
    expect(result[0].agent).toBe('a1');
  });

  it('returns all candidates when no requirements', () => {
    const store = new ReputationStore();
    const composer = new TeamComposer(store);
    const candidates = [
      { agent: 'a1', capabilities: [{ name: 'code' }] },
      { agent: 'a2', capabilities: [{ name: 'design' }] },
    ];
    const result = composer.suggestTeam({}, candidates);
    expect(result.length).toBe(2);
  });
});
