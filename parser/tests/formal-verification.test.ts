import { describe, it, expect } from 'vitest';
import { FormalVerificationEngine } from '../src/formal-verification';

describe('FormalVerificationEngine (v23.0.0)', () => {
  it('detects deadlock states in non-terminal nodes with zero outgoing transitions', () => {
    const engine = new FormalVerificationEngine();
    const states = ['s1', 's2', 's3'];
    const transitions = [
      { from: 's1', to: 's2' },
      // s2 has no outgoing transition and is not marked terminal
    ];

    const analysis = engine.checkSafetyInvariants(states, transitions, ['s3']);
    expect(analysis.isSafe).toBe(false);
    expect(analysis.deadlocks).toContain('s2');
  });

  it('generates valid TLA+ module specification syntax', () => {
    const engine = new FormalVerificationEngine();
    const tla = engine.generateTLASpec(
      'AuthWorkflow',
      ['idle', 'done'],
      [{ from: 'idle', to: 'done' }]
    );

    expect(tla).toContain('---- MODULE AuthWorkflow ----');
    expect(tla).toContain('Invariant_TypeOK == state \\in {"idle", "done"}');
  });

  it('verifies spec and returns proof receipt with hash', () => {
    const engine = new FormalVerificationEngine();
    const receipt = engine.verifySpec(
      'SpecA',
      ['a', 'b'],
      [{ from: 'a', to: 'b' }],
      ['b']
    );

    expect(receipt.targetSpec).toBe('SpecA');
    expect(receipt.deadlockFree).toBe(true);
    expect(receipt.tlaSpecHash).toBeDefined();
  });
});
