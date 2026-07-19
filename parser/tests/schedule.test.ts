import { describe, it, expect } from 'vitest';
import { AlpParser, TimelineEngine } from '../src/index';

function engineFrom(src: string): TimelineEngine {
  return new TimelineEngine(new AlpParser().parse(src));
}

describe('TimelineEngine (v8.2.0)', () => {
  it('matches a cron expression at the scheduled minute', () => {
    const src = `
@timeline
  id: tl-morning
  cron: "0 9 * * 1-5"
  task: -> task-standup
`;
    const mon = new Date(Date.UTC(2026, 6, 20, 9, 0)); // Monday 09:00 UTC
    const results = engineFrom(src).evaluate(mon);
    expect(results.map((r) => r.task)).toContain('-> task-standup');
  });

  it('skips a cron outside the window', () => {
    const src = `
@timeline
  id: tl-morning
  cron: "0 9 * * 1-5"
  task: -> task-standup
`;
    const sat = new Date(Date.UTC(2026, 6, 25, 9, 0)); // Saturday 09:00 UTC
    expect(engineFrom(src).evaluate(sat)).toHaveLength(0);
  });

  it('fires a one-shot `at` timeline after the trigger time', () => {
    const src = `
@timeline
  id: tl-once
  at: "2026-08-01T09:00:00Z"
  task: -> task-q3-review
`;
    const after = new Date(Date.UTC(2026, 7, 1, 10, 0));
    const results = engineFrom(src).evaluate(after);
    expect(results.map((r) => r.task)).toContain('-> task-q3-review');
    expect(results[0].reason).toBe('at');
  });

  it('does not fire an `at` timeline before the trigger time', () => {
    const src = `
@timeline
  id: tl-once
  at: "2026-08-01T09:00:00Z"
  task: -> task-q3-review
`;
    const before = new Date(Date.UTC(2026, 7, 1, 8, 0));
    expect(engineFrom(src).evaluate(before)).toHaveLength(0);
  });

  it('skips disabled timelines', () => {
    const src = `
@timeline
  id: tl-off
  cron: "0 9 * * *"
  task: -> task-standup
  enabled: false
`;
    const mon = new Date(Date.UTC(2026, 6, 20, 9, 0));
    expect(engineFrom(src).evaluate(mon)).toHaveLength(0);
  });

  it('lists all timelines', () => {
    const src = `
@timeline
  id: tl-1
  cron: "0 9 * * *"
  task: -> task-a
@timeline
  id: tl-2
  at: "2026-08-01T09:00:00Z"
  task: -> task-b
`;
    const list = engineFrom(src).list();
    expect(list).toHaveLength(2);
    expect(list.map((l) => l.id)).toContain('tl-1');
    expect(list.map((l) => l.id)).toContain('tl-2');
  });
});
