import { AlpObject } from './reader';

/**
 * ALP Timeline Engine (v8.2.0).
 *
 * Evaluates `@timeline` objects against a reference time and returns the
 * set of tasks that are due. Supports standard 5-field cron expressions
 * and one-shot ISO 8601 `at` triggers.
 */

export interface TimelineResult {
  timeline: AlpObject;
  task: string;
  agent?: string;
  reason: 'cron' | 'at';
}

interface CronParts {
  minute: number[];
  hour: number[];
  dom: number[];
  month: number[];
  dow: number[];
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const DOW_NAMES: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

function parseCron(expr: string): CronParts {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression (expected 5 fields): "${expr}"`);
  }
  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dom: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dow: parseField(parts[4], 0, 7),
  };
}

function parseField(field: string, min: number, max: number): number[] {
  const values: number[] = [];
  for (const segment of field.split(',')) {
    const trimmed = segment.trim();
    if (trimmed === '*') {
      for (let v = min; v <= max; v++) {
        if (!values.includes(v)) values.push(v);
      }
      continue;
    }
    const stepMatch = trimmed.match(/^(.+)\/(\d+)$/);
    let start: number;
    let end: number;
    let step: number;
    if (stepMatch) {
      start = parseRange(stepMatch[1], min, max);
      end = max;
      step = parseInt(stepMatch[2], 10);
    } else {
      start = parseRange(trimmed, min, max);
      end = start;
      step = 1;
    }
    for (let v = start; v <= end; v += step) {
      if (!values.includes(v)) values.push(v);
    }
  }
  return values;
}

function parseRange(segment: string, min: number, max: number): number {
  segment = segment.trim().toLowerCase();
  if (segment === '*') return min;
  const rangeMatch = segment.match(/^(\w+)(?:-(\w+))?$/);
  if (!rangeMatch) throw new Error(`Invalid cron field: "${segment}"`);
  const start = resolveName(rangeMatch[1], min, max);
  const end = rangeMatch[2] ? resolveName(rangeMatch[2], min, max) : start;
  return Math.max(min, Math.min(max, start));
}

function resolveName(token: string, min: number, max: number): number {
  const n = parseInt(token, 10);
  if (!isNaN(n)) return Math.max(min, Math.min(max, n));
  const map = max === 12 ? MONTH_NAMES : DOW_NAMES;
  const v = map[token];
  if (v === undefined) throw new Error(`Unknown cron token: "${token}"`);
  return v;
}

function matchesCron(now: Date, parts: CronParts): boolean {
  return (
    parts.minute.includes(now.getUTCMinutes()) &&
    parts.hour.includes(now.getUTCHours()) &&
    parts.dom.includes(now.getUTCDate()) &&
    parts.month.includes(now.getUTCMonth() + 1) &&
    parts.dow.includes(now.getUTCDay())
  );
}

export class TimelineEngine {
  private timelines: AlpObject[];

  constructor(objects: AlpObject[]) {
    this.timelines = objects.filter((o) => o._type === 'timeline');
  }

  get count(): number {
    return this.timelines.length;
  }

  evaluate(now: Date = new Date()): TimelineResult[] {
    const results: TimelineResult[] = [];
    for (const tl of this.timelines) {
      if (tl.enabled === false || tl.enabled === 'false') continue;
      const cron = tl.cron as string | undefined;
      const at = tl.at as string | undefined;
      if (!cron && !at) continue;

      if (cron) {
        try {
          const parts = parseCron(cron);
          if (matchesCron(now, parts)) {
            results.push({
              timeline: tl,
              task: tl.task as string,
              agent: tl.agent as string | undefined,
              reason: 'cron',
            });
          }
        } catch {
          // Malformed cron: skip silently.
        }
      } else if (at) {
        const fireAt = new Date(at);
        if (now >= fireAt) {
          results.push({
            timeline: tl,
            task: tl.task as string,
            agent: tl.agent as string | undefined,
            reason: 'at',
          });
        }
      }
    }
    return results;
  }

  list(): { id: string; cron?: string; at?: string; enabled: boolean; task: string }[] {
    return this.timelines.map((tl) => ({
      id: tl.id as string,
      cron: tl.cron as string | undefined,
      at: tl.at as string | undefined,
      enabled: tl.enabled !== false && tl.enabled !== 'false',
      task: tl.task as string,
    }));
  }
}
