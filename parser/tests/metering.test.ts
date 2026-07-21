import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MeteringStore } from '../src/state-store';

function tmpMeteringDir(): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alp-metering-'));
  fs.mkdirSync(path.join(dir, '.runtime'), { recursive: true });
  return {
    dir,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

describe('MeteringStore (v10.7.0)', () => {
  it('appends metering entries to metering.jsonl', () => {
    const { dir, cleanup } = tmpMeteringDir();
    try {
      const store = new MeteringStore(dir);
      store.append({ task_id: 'T1', agent: 'a1', input_tokens: 10, output_tokens: 20, operations: 3, duration_ms: 150 });
      const raw = fs.readFileSync(path.join(dir, '.runtime', 'metering.jsonl'), 'utf-8');
      expect(raw.trim().split('\n')).toHaveLength(1);
      const parsed = JSON.parse(raw.trim());
      expect(parsed.task_id).toBe('T1');
      expect(parsed.input_tokens).toBe(10);
      expect(parsed.output_tokens).toBe(20);
      expect(parsed.operations).toBe(3);
      expect(parsed.duration_ms).toBe(150);
      expect(parsed.timestamp).toBeTruthy();
    } finally {
      cleanup();
    }
  });

  it('readAll returns parsed entries', () => {
    const { dir, cleanup } = tmpMeteringDir();
    try {
      const store = new MeteringStore(dir);
      store.append({ task_id: 'T1', agent: 'a1', input_tokens: 100, output_tokens: 50, operations: 5, duration_ms: 500 });
      store.append({ task_id: 'T2', agent: 'a2', input_tokens: 30, output_tokens: 10, operations: 2, duration_ms: 120 });
      const entries = store.readAll();
      expect(entries).toHaveLength(2);
      expect(entries[0].task_id).toBe('T1');
      expect(entries[1].task_id).toBe('T2');
    } finally {
      cleanup();
    }
  });

  it('returns empty readAll when file does not exist', () => {
    const { dir, cleanup } = tmpMeteringDir();
    try {
      const store = new MeteringStore(dir);
      expect(store.readAll()).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it('skips malformed lines in metering.jsonl', () => {
    const { dir, cleanup } = tmpMeteringDir();
    try {
      const p = path.join(dir, '.runtime', 'metering.jsonl');
      fs.writeFileSync(p, '{"valid":true}\nnot json\n{"also_valid":true}\n', 'utf-8');
      const store = new MeteringStore(dir);
      expect(store.readAll()).toHaveLength(2);
    } finally {
      cleanup();
    }
  });

  it('costEstimate returns correct token count and cost for a task', () => {
    const { dir, cleanup } = tmpMeteringDir();
    try {
      const store = new MeteringStore(dir);
      store.append({ task_id: 'T1', agent: 'a1', input_tokens: 100, output_tokens: 200, operations: 4, duration_ms: 300 });
      store.append({ task_id: 'T1', agent: 'a1', input_tokens: 50, output_tokens: 50, operations: 1, duration_ms: 100 });
      store.append({ task_id: 'T2', agent: 'a2', input_tokens: 1000, output_tokens: 500, operations: 10, duration_ms: 1000 });
      const est = store.costEstimate('T1');
      expect(est.tokens).toBe(400);
      expect(est.operations).toBe(5);
      expect(est.estimated_cost).toBeCloseTo(0.0058, 6);
    } finally {
      cleanup();
    }
  });

  it('costEstimate ignores entries for other task ids', () => {
    const { dir, cleanup } = tmpMeteringDir();
    try {
      const store = new MeteringStore(dir);
      store.append({ task_id: 'T2', agent: 'a2', input_tokens: 999, output_tokens: 999, operations: 99, duration_ms: 999 });
      const est = store.costEstimate('T1');
      expect(est.tokens).toBe(0);
      expect(est.operations).toBe(0);
      expect(est.estimated_cost).toBe(0);
    } finally {
      cleanup();
    }
  });

  it('costEstimate handles missing file', () => {
    const { dir, cleanup } = tmpMeteringDir();
    try {
      const store = new MeteringStore(dir);
      const est = store.costEstimate('T1');
      expect(est.tokens).toBe(0);
      expect(est.operations).toBe(0);
      expect(est.estimated_cost).toBe(0);
    } finally {
      cleanup();
    }
  });

  it('rateLimiter returns a 60s window with remaining count', () => {
    const { dir, cleanup } = tmpMeteringDir();
    try {
      const store = new MeteringStore(dir);
      const rl = store.rateLimiter('my-project');
      expect(rl.remaining).toBe(100);
      expect(rl.resetAt).toBeTruthy();
      const reset = Date.parse(rl.resetAt);
      const now = Date.now();
      expect(reset - now).toBeGreaterThan(50_000);
      expect(reset - now).toBeLessThanOrEqual(60_000);
    } finally {
      cleanup();
    }
  });

  it('creates parent directory on first append', () => {
    const { dir, cleanup } = tmpMeteringDir();
    try {
      const store = new MeteringStore(dir);
      store.append({ task_id: 'T1', agent: 'a1', input_tokens: 1, output_tokens: 1, operations: 1, duration_ms: 1 });
      expect(fs.existsSync(path.join(dir, '.runtime', 'metering.jsonl'))).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('is append-only — multiple appends keep all records', () => {
    const { dir, cleanup } = tmpMeteringDir();
    try {
      const store = new MeteringStore(dir);
      for (let i = 0; i < 5; i++) {
        store.append({ task_id: 'T1', agent: 'a1', input_tokens: i, output_tokens: i, operations: i, duration_ms: i });
      }
      expect(store.readAll()).toHaveLength(5);
    } finally {
      cleanup();
    }
  });

  it('survives process restart by reading back the same file', () => {
    const { dir, cleanup } = tmpMeteringDir();
    try {
      const store1 = new MeteringStore(dir);
      store1.append({ task_id: 'T1', agent: 'a1', input_tokens: 123, output_tokens: 456, operations: 7, duration_ms: 888 });
      const store2 = new MeteringStore(dir);
      const entries = store2.readAll();
      expect(entries).toHaveLength(1);
      expect(entries[0].input_tokens).toBe(123);
      expect(entries[0].output_tokens).toBe(456);
    } finally {
      cleanup();
    }
  });

  it('costEstimate sums cost across multiple entries correctly', () => {
    const { dir, cleanup } = tmpMeteringDir();
    try {
      const store = new MeteringStore(dir);
      for (let i = 0; i < 3; i++) {
        store.append({ task_id: 'T1', agent: 'a1', input_tokens: 1000, output_tokens: 2000, operations: 100, duration_ms: 1000 });
      }
      const est = store.costEstimate('T1');
      expect(est.tokens).toBe(9000);
      expect(est.operations).toBe(300);
      expect(est.estimated_cost).toBeCloseTo(0.318, 6);
    } finally {
      cleanup();
    }
  });
});
