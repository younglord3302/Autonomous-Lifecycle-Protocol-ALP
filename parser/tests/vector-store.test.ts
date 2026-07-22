import { describe, it, expect } from 'vitest';
import { VectorStoreEngine } from '../src/vector-store';

describe('VectorStoreEngine (v19.0.0)', () => {
  it('adds and retrieves vector entries', () => {
    const engine = new VectorStoreEngine();
    engine.addEntry({ id: 'entry-1', text: 'Authentication module', vector: [0.1, 0.2, 0.3] });

    expect(engine.size()).toBe(1);
    const item = engine.getEntry('entry-1');
    expect(item?.text).toBe('Authentication module');
  });

  it('calculates cosine similarity correctly', () => {
    const engine = new VectorStoreEngine();
    const vecA = [1, 0, 0];
    const vecB = [1, 0, 0];
    const vecC = [0, 1, 0];

    expect(engine.cosineSimilarity(vecA, vecB)).toBeCloseTo(1.0);
    expect(engine.cosineSimilarity(vecA, vecC)).toBeCloseTo(0.0);
  });

  it('queries most similar vector results in descending order', () => {
    const engine = new VectorStoreEngine();
    engine.addEntry({ id: 'doc-auth', text: 'Auth feature', vector: [1, 0, 0] });
    engine.addEntry({ id: 'doc-db', text: 'DB schema', vector: [0, 1, 0] });

    const results = engine.querySimilar([0.9, 0.1, 0], 2);
    expect(results.length).toBe(2);
    expect(results[0].id).toBe('doc-auth');
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });
});
