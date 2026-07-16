import * as fs from 'fs';
import * as path from 'path';

/**
 * ALP Runtime Event Log (v3.1 — The Observability Release)
 *
 * A single append-only JSONL event stream that captures everything the
 * swarm does: task claims, status changes, agent activity, memory writes,
 * file mutations, checkpoints, and human handoffs. The `alp serve` daemon
 * tails this file to power the live dashboard.
 */

export type RuntimeEventType =
  | 'run_start'
  | 'run_end'
  | 'task_claim'
  | 'task_release'
  | 'task_status'
  | 'agent_active'
  | 'agent_idle'
  | 'memory_write'
  | 'file_mutation'
  | 'checkpoint'
  | 'human_handoff'
  | 'workflow_fail'
  | 'error';

export interface RuntimeEvent {
  timestamp: string;
  type: RuntimeEventType;
  task_id?: string;
  agent?: string;
  status?: string;
  message?: string;
  worker?: number;
  pid: number;
  [key: string]: unknown;
}

function runtimeDir(alpDir: string): string {
  return path.join(alpDir, '.runtime');
}

export function runtimeLogPath(alpDir: string): string {
  return path.join(runtimeDir(alpDir), 'log.jsonl');
}

/**
 * Append a structured event to `.alp/.runtime/log.jsonl`.
 * Never throws — observability must not break execution.
 */
export function logEvent(
  alpDir: string,
  type: RuntimeEventType,
  fields: Partial<Omit<RuntimeEvent, 'timestamp' | 'type' | 'pid'>> = {},
): void {
  try {
    const dir = runtimeDir(alpDir);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const entry: RuntimeEvent = {
      timestamp: new Date().toISOString(),
      type,
      pid: process.pid,
      ...fields,
    };
    fs.appendFileSync(runtimeLogPath(alpDir), JSON.stringify(entry) + '\n', 'utf-8');
  } catch {
    /* observability is best-effort */
  }
}

/** Read and parse all events currently in the runtime log. */
export function readEvents(alpDir: string): RuntimeEvent[] {
  const p = runtimeLogPath(alpDir);
  if (!fs.existsSync(p)) return [];
  const raw = fs.readFileSync(p, 'utf-8');
  const events: RuntimeEvent[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as RuntimeEvent);
    } catch {
      /* skip malformed lines */
    }
  }
  return events;
}
