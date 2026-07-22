import { describe, it, expect } from 'vitest';
import { MemoryMeshEngine } from '../src/memory-mesh';

describe('MemoryMeshEngine (v38.0.0)', () => {
  it('stores and queries memories with decay scoring', () => {
    const engine = new MemoryMeshEngine();
    engine.storeMemory('mem-1', 'agent-coder', 'auth-refactor', 'Refactored auth module with JWT tokens', ['security', 'auth']);
    engine.storeMemory('mem-2', 'agent-tester', 'test-coverage', 'Added vitest integration tests for auth', ['testing', 'auth']);

    const results = engine.queryMemoryMesh('auth JWT', { topK: 2 });
    expect(results.length).toBe(2);
    expect(results[0].node.id).toBe('mem-1');
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('syncs memory nodes between agents', () => {
    const engine = new MemoryMeshEngine();
    const remoteMemories = [
      {
        id: 'r1',
        agentId: 'agent-remote',
        key: 'remote-cache',
        content: 'Remote data payload',
        tags: ['remote'],
        timestamp: Date.now(),
        accessCount: 1,
        lastAccessed: Date.now(),
      },
    ];

    const count = engine.syncNodeMemories('agent-local', remoteMemories);
    expect(count).toBe(1);
    expect(engine.getMeshStats().totalMemories).toBe(1);
  });

  it('computes mesh statistics correctly', () => {
    const engine = new MemoryMeshEngine();
    engine.storeMemory('m1', 'agent-a', 'k1', 'c1', ['core']);
    engine.storeMemory('m2', 'agent-b', 'k2', 'c2', ['core', 'v38']);

    const stats = engine.getMeshStats();
    expect(stats.totalMemories).toBe(2);
    expect(stats.activeAgents).toBe(2);
    expect(stats.tagCounts['core']).toBe(2);
    expect(stats.tagCounts['v38']).toBe(1);
  });
});
