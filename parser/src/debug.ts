import * as fs from 'fs';
import * as path from 'path';

/**
 * ALP Time-Travel Debugging (v10.8.0)
 *
 * Persists engine-state snapshots so execution can be stepped forward
 * and backward for deterministic debugging.
 */

export interface EngineSnapshot {
  id: string;
  run_id: string;
  stage: string;
  timestamp: string;
  state: Record<string, unknown>;
  event_ids: string[];
}

export interface DiffResult {
  added: Record<string, unknown>;
  removed: Record<string, unknown>;
  changed: { key: string; from: unknown; to: unknown }[];
}

export class SnapshotStore {
  private snapshotsPath: string;

  constructor(alpDir: string) {
    this.snapshotsPath = path.join(alpDir, '.runtime', 'snapshots.jsonl');
  }

  save(snapshot: EngineSnapshot): void {
    const dir = path.dirname(this.snapshotsPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(this.snapshotsPath, JSON.stringify(snapshot) + '\n', 'utf-8');
  }

  loadForRun(runId: string): EngineSnapshot[] {
    if (!fs.existsSync(this.snapshotsPath)) return [];
    const raw = fs.readFileSync(this.snapshotsPath, 'utf-8');
    const snaps: EngineSnapshot[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as EngineSnapshot;
        if (parsed.run_id === runId) snaps.push(parsed);
      } catch {
        /* skip malformed */
      }
    }
    return snaps.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
  }
}

export class DebugSession {
  private snapshots: EngineSnapshot[] = [];

  constructor(snapshots: EngineSnapshot[] = []) {
    this.snapshots = [...snapshots].sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
  }

  stepForward(): EngineSnapshot | null {
    return this.snapshots[0] ?? null;
  }

  stepBackward(): EngineSnapshot | null {
    return this.snapshots[this.snapshots.length - 1] ?? null;
  }

  toStage(name: string): EngineSnapshot | null {
    return this.snapshots.find((s) => s.stage === name) ?? null;
  }

  diffSnapshots(a: EngineSnapshot, b: EngineSnapshot): DiffResult {
    const keysA = Object.keys(a.state);
    const keysB = Object.keys(b.state);
    const added: Record<string, unknown> = {};
    const removed: Record<string, unknown> = {};
    const changed: { key: string; from: unknown; to: unknown }[] = [];
    for (const k of keysB) {
      if (!(k in a.state)) added[k] = b.state[k];
      else if (a.state[k] !== b.state[k]) changed.push({ key: k, from: a.state[k], to: b.state[k] });
    }
    for (const k of keysA) {
      if (!(k in b.state)) removed[k] = a.state[k];
    }
    return { added, removed, changed };
  }
}
