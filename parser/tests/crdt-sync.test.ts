import { describe, it, expect } from 'vitest';
import { CRDTSyncEngine } from '../src/crdt-sync';

describe('CRDTSyncEngine (v21.0.0)', () => {
  it('updates state and increments Lamport clock', () => {
    const engine = new CRDTSyncEngine();
    engine.set('doc-1', 'peer-a', 'status', '[x]', 100);

    const data = engine.readState('doc-1');
    expect(data.status).toBe('[x]');
  });

  it('deterministically merges concurrent updates using LWW semantics', () => {
    const engineA = new CRDTSyncEngine();
    const stateA = engineA.set('doc-1', 'peer-a', 'title', 'Old Title', 100);

    const engineB = new CRDTSyncEngine();
    const stateB = engineB.set('doc-1', 'peer-b', 'title', 'Newer Title', 200);

    const merged = engineA.merge(stateA, stateB);
    const result = engineA.readState('doc-1');

    expect(result.title).toBe('Newer Title');
    expect(merged.clock).toBeGreaterThan(0);
  });

  it('respects tombstones in removeSet', () => {
    const engine = new CRDTSyncEngine();
    engine.set('doc-1', 'peer-a', 'temp_key', 'val', 100);
    engine.remove('doc-1', 'temp_key', 150);

    const data = engine.readState('doc-1');
    expect(data.temp_key).toBeUndefined();
  });
});
