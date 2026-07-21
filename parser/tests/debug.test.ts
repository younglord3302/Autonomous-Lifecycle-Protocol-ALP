import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SnapshotStore, DebugSession, EngineSnapshot } from '../src/debug';

function tmpDebugDir(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alp-debug-'));
  fs.mkdirSync(path.join(dir, '.runtime'), { recursive: true });
  return {
    dir,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

function snap(id: string, runId: string, stage: string, state: Record<string, unknown>): EngineSnapshot {
  return { id, run_id: runId, stage, timestamp: new Date(0).toISOString(), state, event_ids: [id] };
}

describe('SnapshotStore (v10.8.0)', () => {
  it('persists and loads snapshots for a run', () => {
    const { dir, cleanup } = tmpDebugDir();
    try {
      const store = new SnapshotStore(dir);
      store.save(snap('s1', 'run-1', 'init', { x: 1 }));
      store.save(snap('s2', 'run-1', 'parse', { x: 2 }));
      store.save(snap('s3', 'run-2', 'init', { x: 3 }));
      const loaded = store.loadForRun('run-1');
      expect(loaded).toHaveLength(2);
      expect(loaded[0].id).toBe('s1');
      expect(loaded[1].id).toBe('s2');
    } finally {
      cleanup();
    }
  });

  it('returns empty array when no snapshots exist', () => {
    const { dir, cleanup } = tmpDebugDir();
    try {
      const store = new SnapshotStore(dir);
      expect(store.loadForRun('run-1')).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it('skips malformed lines', () => {
    const { dir, cleanup } = tmpDebugDir();
    try {
      const p = path.join(dir, '.runtime', 'snapshots.jsonl');
      fs.writeFileSync(p, '{"run_id":"any","id":"s1"}\nnot json\n{"run_id":"any","id":"s2"}\n', 'utf-8');
      const store = new SnapshotStore(dir);
      expect(store.loadForRun('any')).toHaveLength(2);
    } finally {
      cleanup();
    }
  });

  it('creates parent directory on first save', () => {
    const { dir, cleanup } = tmpDebugDir();
    try {
      const store = new SnapshotStore(dir);
      store.save(snap('s1', 'run-1', 'init', { a: 1 }));
      expect(fs.existsSync(path.join(dir, '.runtime', 'snapshots.jsonl'))).toBe(true);
    } finally {
      cleanup();
    }
  });
});

describe('DebugSession (v10.8.0)', () => {
  it('stepForward returns first snapshot', () => {
    const s = new DebugSession([snap('s1', 'run-1', 'init', { x: 1 }), snap('s2', 'run-1', 'parse', { x: 2 })]);
    const f = s.stepForward();
    expect(f).not.toBeNull();
    expect(f!.id).toBe('s1');
  });

  it('stepForward returns null when empty', () => {
    const s = new DebugSession([]);
    expect(s.stepForward()).toBeNull();
  });

  it('stepBackward returns last snapshot', () => {
    const s = new DebugSession([snap('s1', 'run-1', 'init', { x: 1 }), snap('s2', 'run-1', 'parse', { x: 2 })]);
    const b = s.stepBackward();
    expect(b).not.toBeNull();
    expect(b!.id).toBe('s2');
  });

  it('stepBackward returns null when empty', () => {
    const s = new DebugSession([]);
    expect(s.stepBackward()).toBeNull();
  });

  it('toStage returns matching snapshot', () => {
    const s = new DebugSession([snap('s1', 'run-1', 'init', { x: 1 }), snap('s2', 'run-1', 'parse', { x: 2 })]);
    const found = s.toStage('parse');
    expect(found).not.toBeNull();
    expect(found!.id).toBe('s2');
  });

  it('toStage returns null when stage not found', () => {
    const s = new DebugSession([snap('s1', 'run-1', 'init', { x: 1 })]);
    expect(s.toStage('missing')).toBeNull();
  });

  it('diffSnapshots detects added keys', () => {
    const s = new DebugSession([]);
    const a = snap('s1', 'run-1', 'init', { x: 1 });
    const b = snap('s2', 'run-1', 'parse', { x: 1, y: 2 });
    const diff = s.diffSnapshots(a, b);
    expect(diff.added).toEqual({ y: 2 });
    expect(diff.removed).toEqual({});
    expect(diff.changed).toHaveLength(0);
  });

  it('diffSnapshots detects removed keys', () => {
    const s = new DebugSession([]);
    const a = snap('s1', 'run-1', 'init', { x: 1, y: 2 });
    const b = snap('s2', 'run-1', 'parse', { x: 1 });
    const diff = s.diffSnapshots(a, b);
    expect(diff.removed).toEqual({ y: 2 });
    expect(diff.added).toEqual({});
  });

  it('diffSnapshots detects changed values', () => {
    const s = new DebugSession([]);
    const a = snap('s1', 'run-1', 'init', { x: 1 });
    const b = snap('s2', 'run-1', 'parse', { x: 2 });
    const diff = s.diffSnapshots(a, b);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].key).toBe('x');
    expect(diff.changed[0].from).toBe(1);
    expect(diff.changed[0].to).toBe(2);
  });

  it('diffSnapshots handles identical snapshots', () => {
    const s = new DebugSession([]);
    const a = snap('s1', 'run-1', 'init', { x: 1 });
    const diff = s.diffSnapshots(a, a);
    expect(diff.added).toEqual({});
    expect(diff.removed).toEqual({});
    expect(diff.changed).toHaveLength(0);
  });
});
