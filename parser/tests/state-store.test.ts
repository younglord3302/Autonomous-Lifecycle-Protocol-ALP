import { describe, it, expect } from 'vitest';
import { computeAnalytics, StateStore } from '../src/index';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function ev(p: Partial<{
  timestamp: string; type: string; task_id: string; agent: string; status: string;
}>) {
  return { timestamp: p.timestamp ?? '2026-01-01T00:00:00.000Z', type: p.type ?? 'run_start', ...p } as any;
}

describe('computeAnalytics', () => {
  it('counts events and runs', () => {
    const a = computeAnalytics([ev({ type: 'run_start' }), ev({ type: 'run_start' }), ev({ type: 'task_status' })]);
    expect(a.total_events).toBe(3);
    expect(a.runs).toBe(2);
    expect(a.event_counts.task_status).toBe(1);
  });

  it('computes task cycle time from claim to done', () => {
    const t0 = '2026-01-01T00:00:00.000Z';
    const t1 = '2026-01-01T00:00:10.000Z';
    const events = [
      ev({ timestamp: t0, type: 'task_claim', task_id: 'T1', agent: 'a1' }),
      ev({ timestamp: t1, type: 'task_status', task_id: 'T1', status: '[x]', agent: 'a1' }),
    ];
    const a = computeAnalytics(events);
    const t = a.tasks.find((x) => x.task_id === 'T1')!;
    expect(t.completed).toBe(true);
    expect(t.cycle_time_ms).toBe(10000);
    expect(a.avg_cycle_time_ms).toBe(10000);
    expect(a.agents.find((x) => x.agent === 'a1')!.completions).toBe(1);
  });

  it('ranks failure hotspots by failures then handoffs', () => {
    const events = [
      ev({ type: 'task_claim', task_id: 'T1' }),
      ev({ type: 'task_status', task_id: 'T1', status: '[!]' }),
      ev({ type: 'task_claim', task_id: 'T2' }),
      ev({ type: 'task_status', task_id: 'T2', status: '[!]' }),
      ev({ type: 'task_status', task_id: 'T2', status: '[!]' }),
      ev({ type: 'human_handoff', task_id: 'T3' }),
    ];
    const a = computeAnalytics(events);
    expect(a.failure_hotspots[0].task_id).toBe('T2');
    expect(a.failure_hotspots[0].failures).toBe(2);
    expect(a.failure_hotspots.map((h) => h.task_id)).toContain('T3');
  });

  it('returns null cycle time when no timing data', () => {
    const a = computeAnalytics([ev({ type: 'task_status', task_id: 'T1', status: '[x]' })]);
    expect(a.avg_cycle_time_ms).toBeNull();
    expect(a.tasks[0].cycle_time_ms).toBeNull();
  });
});

describe('StateStore', () => {
  it('persists, de-duplicates and reloads events', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alp-store-'));
    const p = path.join(dir, '.alp');
    fs.mkdirSync(path.join(p, '.runtime'), { recursive: true });
    const store = new StateStore(p);
    const added1 = store.ingest([ev({ type: 'run_start', task_id: 'a' }), ev({ type: 'run_start', task_id: 'b' })]);
    store.save();
    expect(added1).toBe(2);

    const reopened = new StateStore(p);
    expect(reopened.size).toBe(2);
    const added2 = reopened.ingest([ev({ type: 'run_start', task_id: 'a' }), ev({ type: 'run_end' })]);
    expect(added2).toBe(1);
    expect(reopened.size).toBe(3);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
