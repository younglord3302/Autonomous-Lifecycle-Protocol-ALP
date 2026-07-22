import { describe, it, expect } from 'vitest';
import { SwarmMarketplaceEngine } from '../src/swarm-marketplace';

describe('SwarmMarketplaceEngine (v36.0.0)', () => {
  it('registers a skill and discovers it by category', () => {
    const engine = new SwarmMarketplaceEngine();
    const listing = engine.registerSkill('s1', 'agent-coder', 'code-review', 'analysis', 0.05, 'Reviews PRs');

    expect(listing.id).toBe('s1');
    expect(listing.providerAgent).toBe('agent-coder');
    expect(listing.category).toBe('analysis');
    expect(listing.costPerCall).toBe(0.05);

    const found = engine.discoverSkills('analysis');
    expect(found.length).toBe(1);
    expect(found[0].skillName).toBe('code-review');
  });

  it('invokes a skill and logs the result', () => {
    const engine = new SwarmMarketplaceEngine();
    engine.registerSkill('s2', 'agent-writer', 'summarize', 'nlp', 0.02);

    const result = engine.invokeSkill('s2', 'agent-reader', 'Summarize this document');
    expect(result).toBeDefined();
    expect(result!.callerAgent).toBe('agent-reader');
    expect(result!.providerAgent).toBe('agent-writer');
    expect(result!.costCharged).toBe(0.02);
    expect(engine.getInvocationLog().length).toBe(1);

    const listing = engine.getListing('s2');
    expect(listing!.totalInvocations).toBe(1);
  });

  it('rates a skill and updates the average', () => {
    const engine = new SwarmMarketplaceEngine();
    engine.registerSkill('s3', 'agent-x', 'format-json', 'utility');
    expect(engine.rateSkill('s3', 4.0)).toBe(true);
    expect(engine.getListing('s3')!.rating).toBeLessThanOrEqual(5.0);
    expect(engine.rateSkill('missing', 3.0)).toBe(false);
  });
});
