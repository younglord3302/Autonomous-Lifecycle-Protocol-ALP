import * as fs from 'fs';
import * as path from 'path';

/**
 * ALP State Store & Analytics (v4 — The Federation Era, Pillar 5)
 *
 * A durable, dependency-free store that ingests runtime events and computes
 * queryable analytics: task cycle times, agent utilization, failure
 * hotspots, and event throughput. Backs `alp serve --db` so history survives
 * process restarts and long-running clusters, and feeds `alp evolve` with
 * richer signal than a raw JSONL tail.
 *
 * We persist a compact JSON snapshot (`.alp/.runtime/state.db.json`) rather
 * than requiring a native SQLite binding, keeping the CLI zero-dependency and
 * portable across every platform.
 */

export interface StoredEvent {
  timestamp: string;
  type: string;
  task_id?: string;
  agent?: string;
  status?: string;
  worker?: number;
  source?: string;
  [key: string]: unknown;
}

export interface TaskAnalytics {
  task_id: string;
  /** Number of times the task was claimed. */
  claims: number;
  /** Number of times the task failed ([!]). */
  failures: number;
  /** Number of times the task was handed to a human ([?]). */
  handoffs: number;
  /** Whether the task reached done ([x]). */
  completed: boolean;
  /** Wall-clock ms from first claim to first done, when both exist. */
  cycle_time_ms: number | null;
}

export interface AgentAnalytics {
  agent: string;
  claims: number;
  completions: number;
  failures: number;
}

export interface Analytics {
  total_events: number;
  event_counts: Record<string, number>;
  runs: number;
  tasks: TaskAnalytics[];
  agents: AgentAnalytics[];
  /** Tasks ranked by failures then handoffs — where the swarm struggles. */
  failure_hotspots: { task_id: string; failures: number; handoffs: number }[];
  /** Average cycle time across completed tasks with timing data. */
  avg_cycle_time_ms: number | null;
  first_event: string | null;
  last_event: string | null;
}

interface Snapshot {
  version: 1;
  ingested: number;
  events: StoredEvent[];
}

export interface TokenUsage {
  task_id: string;
  agent: string;
  input_tokens: number;
  output_tokens: number;
  operations: number;
  started_at: string;
  finished_at: string;
}

export interface MeteringEntry {
  timestamp: string;
  task_id: string;
  agent: string;
  input_tokens: number;
  output_tokens: number;
  operations: number;
  duration_ms: number;
}

export class MeteringStore {
  private meteringPath: string;

  constructor(alpDir: string) {
    this.meteringPath = path.join(alpDir, '.runtime', 'metering.jsonl');
  }

  append(entry: Omit<MeteringEntry, 'timestamp'>): void {
    const record: MeteringEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
    };
    const dir = path.dirname(this.meteringPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(this.meteringPath, JSON.stringify(record) + '\n', 'utf-8');
  }

  readAll(): MeteringEntry[] {
    if (!fs.existsSync(this.meteringPath)) return [];
    const raw = fs.readFileSync(this.meteringPath, 'utf-8');
    const entries: MeteringEntry[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        entries.push(JSON.parse(trimmed) as MeteringEntry);
      } catch {
        /* skip malformed */
      }
    }
    return entries;
  }

  costEstimate(taskId: string): { tokens: number; operations: number; estimated_cost: number } {
    const entries = this.readAll().filter((e) => e.task_id === taskId);
    const tokens = entries.reduce((s, e) => s + e.input_tokens + e.output_tokens, 0);
    const operations = entries.reduce((s, e) => s + e.operations, 0);
    const estimated_cost = +(tokens * 0.000002 + operations * 0.001).toFixed(6);
    return { tokens, operations, estimated_cost };
  }

  rateLimiter(ns: string): { remaining: number; resetAt: string } {
    const key = `rate:${ns}`;
    const now = Date.now();
    const windowMs = 60_000;
    const limit = 100;
    return { remaining: limit, resetAt: new Date(now + windowMs).toISOString() };
  }
}

export class StateStore {
  private dbPath: string;
  private events: StoredEvent[] = [];

  constructor(alpDir: string) {
    this.dbPath = path.join(alpDir, '.runtime', 'state.db.json');
    this.load();
  }

  private load(): void {
    if (!fs.existsSync(this.dbPath)) return;
    try {
      const snap = JSON.parse(fs.readFileSync(this.dbPath, 'utf-8')) as Snapshot;
      if (snap && Array.isArray(snap.events)) this.events = snap.events;
    } catch {
      this.events = [];
    }
  }

  /** Persist the current event set to disk. */
  save(): void {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const snap: Snapshot = { version: 1, ingested: this.events.length, events: this.events };
    fs.writeFileSync(this.dbPath, JSON.stringify(snap), 'utf-8');
  }

  get size(): number {
    return this.events.length;
  }

  /**
   * Ingest a batch of events, de-duplicating against what is already stored
   * (by timestamp+type+task_id+status). Returns the number of new events.
   */
  ingest(incoming: StoredEvent[]): number {
    const seen = new Set(this.events.map(keyOf));
    let added = 0;
    for (const e of incoming) {
      const k = keyOf(e);
      if (seen.has(k)) continue;
      seen.add(k);
      this.events.push(e);
      added++;
    }
    if (added > 0) {
      this.events.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
    }
    return added;
  }

  /** Compute analytics over all stored events. */
  analytics(): Analytics {
    return computeAnalytics(this.events);
  }
}

function keyOf(e: StoredEvent): string {
  return `${e.timestamp}|${e.type}|${e.task_id ?? ''}|${e.status ?? ''}|${e.agent ?? ''}`;
}

/**
 * Pure analytics computation over an event list. Exported so it can run
 * against a raw JSONL tail without instantiating a store.
 */
export function computeAnalytics(events: StoredEvent[]): Analytics {
  const eventCounts: Record<string, number> = {};
  const taskMap = new Map<string, TaskAnalytics & { firstClaim?: number; firstDone?: number }>();
  const agentMap = new Map<string, AgentAnalytics>();
  let runs = 0;

  const getTask = (id: string) => {
    let t = taskMap.get(id);
    if (!t) {
      t = { task_id: id, claims: 0, failures: 0, handoffs: 0, completed: false, cycle_time_ms: null };
      taskMap.set(id, t);
    }
    return t;
  };
  const getAgent = (id: string) => {
    let a = agentMap.get(id);
    if (!a) {
      a = { agent: id, claims: 0, completions: 0, failures: 0 };
      agentMap.set(id, a);
    }
    return a;
  };

  for (const e of events) {
    eventCounts[e.type] = (eventCounts[e.type] || 0) + 1;
    if (e.type === 'run_start') runs++;

    const ts = Date.parse(e.timestamp);
    const id = e.task_id;
    const agent = e.agent;

    if (e.type === 'task_claim' && id) {
      const t = getTask(id);
      t.claims++;
      if (t.firstClaim === undefined && !Number.isNaN(ts)) t.firstClaim = ts;
      if (agent) getAgent(agent).claims++;
    }

    if (e.type === 'task_status' && id) {
      const t = getTask(id);
      if (e.status === '[x]') {
        t.completed = true;
        if (t.firstDone === undefined && !Number.isNaN(ts)) t.firstDone = ts;
        if (agent) getAgent(agent).completions++;
      } else if (e.status === '[!]') {
        t.failures++;
        if (agent) getAgent(agent).failures++;
      }
    }

    if (e.type === 'workflow_fail' && id) {
      getTask(id).failures++;
    }

    if ((e.type === 'human_handoff' || e.status === '[?]') && id) {
      getTask(id).handoffs++;
    }
  }

  const tasks: TaskAnalytics[] = [];
  const cycleTimes: number[] = [];
  for (const t of taskMap.values()) {
    if (t.firstClaim !== undefined && t.firstDone !== undefined && t.firstDone >= t.firstClaim) {
      t.cycle_time_ms = t.firstDone - t.firstClaim;
      cycleTimes.push(t.cycle_time_ms);
    }
    tasks.push({
      task_id: t.task_id,
      claims: t.claims,
      failures: t.failures,
      handoffs: t.handoffs,
      completed: t.completed,
      cycle_time_ms: t.cycle_time_ms,
    });
  }

  const failureHotspots = tasks
    .filter((t) => t.failures > 0 || t.handoffs > 0)
    .map((t) => ({ task_id: t.task_id, failures: t.failures, handoffs: t.handoffs }))
    .sort((a, b) => b.failures - a.failures || b.handoffs - a.handoffs);

  const avgCycle = cycleTimes.length
    ? Math.round(cycleTimes.reduce((s, n) => s + n, 0) / cycleTimes.length)
    : null;

  return {
    total_events: events.length,
    event_counts: eventCounts,
    runs,
    tasks: tasks.sort((a, b) => a.task_id.localeCompare(b.task_id)),
    agents: [...agentMap.values()].sort((a, b) => a.agent.localeCompare(b.agent)),
    failure_hotspots: failureHotspots,
    avg_cycle_time_ms: avgCycle,
    first_event: events.length ? events[0].timestamp : null,
    last_event: events.length ? events[events.length - 1].timestamp : null,
  };
}

/** v7.0.0: predictive estimation for task outcomes. */
export class PredictiveEstimator {
  private analytics: ReturnType<typeof computeAnalytics>;
  private baseline: Record<string, any>;

  constructor(events: StoredEvent[]) {
    this.analytics = computeAnalytics(events);
    this.baseline = this.computeBaseline();
  }

  private computeBaseline(): Record<string, any> {
    const tasks = this.analytics.tasks;
    if (!tasks.length) {
      return {
        completion_rate: 0,
        failure_rate: 0,
        avg_cycle_time_ms: null,
        avg_claims: 0,
        avg_handoffs: 0,
        sample_size: 0,
      };
    }
    const completed = tasks.filter((t) => t.completed).length;
    const failed = tasks.filter((t) => t.failures > 0).length;
    const cycleTimes = tasks.filter((t) => t.cycle_time_ms !== null).map((t) => t.cycle_time_ms as number);
    const claims = tasks.map((t) => t.claims);
    const handoffs = tasks.map((t) => t.handoffs);
    return {
      completion_rate: completed / tasks.length,
      failure_rate: failed / tasks.length,
      avg_cycle_time_ms: cycleTimes.length ? Math.round(cycleTimes.reduce((s, n) => s + n, 0) / cycleTimes.length) : null,
      avg_claims: claims.reduce((s, n) => s + n, 0) / claims.length,
      avg_handoffs: handoffs.reduce((s, n) => s + n, 0) / handoffs.length,
      sample_size: tasks.length,
    };
  }

  estimate(taskId: string, agent?: string): Record<string, any> {
    const baseline = this.baseline;
    if (baseline.sample_size === 0) {
      return {
        task_id: taskId,
        agent,
        completion_probability: null,
        expected_cycle_time_ms: null,
        failure_risk: null,
        confidence: 'low',
        sample_size: 0,
      };
    }
    const agentStats = this.analytics.agents.find((a) => a.agent === agent);
    const completionProb = agentStats
      ? agentStats.completions / (agentStats.claims + agentStats.failures || 1)
      : baseline.completion_rate;
    return {
      task_id: taskId,
      agent,
      completion_probability: Math.round(completionProb * 10000) / 10000,
      expected_cycle_time_ms: baseline.avg_cycle_time_ms,
      failure_risk: Math.round(baseline.failure_rate * 10000) / 10000,
      confidence: baseline.sample_size >= 10 ? 'high' : baseline.sample_size >= 3 ? 'medium' : 'low',
      sample_size: baseline.sample_size,
    };
  }

  estimateBatch(taskSpecs: Array<Record<string, any>>): Record<string, any>[] {
    return taskSpecs.map((t) => this.estimate(t.task_id ?? '', t.agent));
  }
}
