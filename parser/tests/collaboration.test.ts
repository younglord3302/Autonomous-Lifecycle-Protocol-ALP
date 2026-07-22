import { describe, it, expect } from 'vitest';
import { CollaborationEngine } from '../src/collaboration';

describe('CollaborationEngine (v37.0.0)', () => {
  it('manages sessions and agent presence', () => {
    const engine = new CollaborationEngine();
    const session = engine.createSession('doc-1');
    expect(session.docId).toBe('doc-1');

    const p1 = engine.joinSession('doc-1', 'agent-a');
    expect(p1?.agentId).toBe('agent-a');
    expect(p1?.status).toBe('active');

    const presence = engine.getPresence('doc-1');
    expect(presence.length).toBe(1);

    const left = engine.leaveSession('doc-1', 'agent-a');
    expect(left).toBe(true);
    expect(engine.getPresence('doc-1').length).toBe(0);
  });

  it('applies operations with LWW state convergence', () => {
    const engine = new CollaborationEngine();
    engine.createSession('doc-state');
    engine.joinSession('doc-state', 'agent-1');

    const op1 = engine.applyOperation('doc-state', 'insert', 'title', 'agent-1', 'Initial Title');
    expect(op1?.value).toBe('Initial Title');
    expect(engine.getSnapshot('doc-state').title).toBe('Initial Title');

    engine.applyOperation('doc-state', 'update', 'title', 'agent-1', 'Updated Title');
    expect(engine.getSnapshot('doc-state').title).toBe('Updated Title');
    expect(engine.getOperationLog('doc-state').length).toBe(2);
  });

  it('handles branch and three-way merge', () => {
    const engine = new CollaborationEngine();
    engine.createSession('doc-main', { status: 'draft', version: '1.0' });

    const branch = engine.fork('doc-main', 'feature-branch');
    expect(branch?.branchId).toBe('feature-branch');

    // Make edits on branch
    branch!.state.status = 'review';
    branch!.state.author = 'agent-dev';
    branch!.operations.push({
      id: 'op-b1',
      docId: 'doc-main',
      type: 'update',
      path: 'status',
      agentId: 'agent-dev',
      timestamp: Date.now(),
      vectorClock: {},
    });

    const mergeResult = engine.mergeBranch('doc-main', 'feature-branch');
    expect(mergeResult).not.toBeNull();
    expect(mergeResult!.merged.status).toBe('review');
    expect(mergeResult!.merged.author).toBe('agent-dev');
  });
});
