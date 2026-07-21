import * as fs from 'fs';
import * as path from 'path';

export type EventType =
  | 'object_created'
  | 'object_updated'
  | 'object_deleted'
  | 'status_changed'
  | 'file_mutated'
  | 'task_claimed'
  | 'task_released'
  | 'checkpoint_created'
  | 'policy_evaluated'
  | 'contract_checked'
  | 'vault_accessed'
  | 'timeline_fired'
  | 'workflow_started'
  | 'workflow_completed'
  | 'workflow_failed'
  | 'snapshot';

export interface Event {
  id: string;
  timestamp: string;
  type: EventType;
  payload: Record<string, unknown>;
  version: string;
  schemaVersion: number;
}

export interface ReplayOptions {
  from?: string;
  to?: string;
  types?: EventType[];
  objectId?: string;
}

export interface ReplayResult {
  events: Event[];
  applied: number;
  skipped: number;
}

const EVENT_SCHEMA_VERSION = 1;
const EVENT_DIR = '.events';
const EVENT_FILE = 'events.jsonl';

function eventsDir(alpDir: string): string {
  return path.join(alpDir, EVENT_DIR);
}

function eventsPath(alpDir: string): string {
  return path.join(eventsDir(alpDir), EVENT_FILE);
}

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class EventStore {
  private alpDir: string;

  constructor(alpDir: string) {
    this.alpDir = alpDir;
  }

  ensureDir(): void {
    const dir = eventsDir(this.alpDir);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  append(type: EventType, payload: Record<string, unknown> = {}): Event {
    const event: Event = {
      id: generateId(),
      timestamp: new Date().toISOString(),
      type,
      payload,
      version: '10.1.0',
      schemaVersion: EVENT_SCHEMA_VERSION,
    };
    this.ensureDir();
    fs.appendFileSync(eventsPath(this.alpDir), JSON.stringify(event) + '\n', 'utf-8');
    return event;
  }

  readAll(): Event[] {
    const p = eventsPath(this.alpDir);
    if (!fs.existsSync(p)) return [];
    const raw = fs.readFileSync(p, 'utf-8');
    const events: Event[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as Event;
        if (parsed.schemaVersion === EVENT_SCHEMA_VERSION && parsed.version) {
          events.push(parsed);
        }
      } catch {
        /* skip malformed lines */
      }
    }
    return events;
  }

  filter(events: Event[], opts: ReplayOptions): Event[] {
    let result = events;
    if (opts.types && opts.types.length > 0) {
      result = result.filter((e) => opts.types!.includes(e.type));
    }
    if (opts.objectId) {
      result = result.filter((e) => e.payload.object_id === opts.objectId);
    }
    if (opts.from) {
      result = result.filter((e) => e.timestamp >= opts.from!);
    }
    if (opts.to) {
      result = result.filter((e) => e.timestamp <= opts.to!);
    }
    return result;
  }

  replay(opts: ReplayOptions = {}): ReplayResult {
    const all = this.readAll();
    const filtered = this.filter(all, opts);
    return {
      events: filtered,
      applied: filtered.length,
      skipped: all.length - filtered.length,
    };
  }

  count(): number {
    return this.readAll().length;
  }
}
