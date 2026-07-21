/** ALP edge-native runtime (v11.1.0 — The Ambient Era). */

export interface LWWEntry {
  value: any;
  node_id: string;
  timestamp: number;
}

export class LWWRegister {
  constructor(public nodeId: string, public value: any = null, public timestamp: number = Date.now()) {}

  set(value: any, nodeId?: string): LWWEntry {
    const node = nodeId ?? this.nodeId;
    const now = Date.now();
    const entry: LWWEntry = { value, node_id: node, timestamp: now };
    if (now >= this.timestamp) {
      this.value = value;
      this.timestamp = now;
    }
    return entry;
  }

  get(): any {
    return this.value;
  }

  merge(other: LWWEntry): void {
    if (other.timestamp >= this.timestamp) {
      this.value = other.value;
      this.timestamp = other.timestamp;
    }
  }

  toJSON(): LWWEntry {
    return { value: this.value, node_id: this.nodeId, timestamp: this.timestamp };
  }
}

export interface ORSetEntry {
  item: any;
  tag: string;
  node_id: string;
  op: 'add' | 'remove';
}

export class ORSet {
  private items: Map<string, ORSetEntry[]> = new Map();

  constructor(public nodeId: string) {}

  add(item: any): ORSetEntry {
    const tag = `${this.nodeId}-${Date.now()}-${Math.random()}`;
    const entry: ORSetEntry = { item, tag, node_id: this.nodeId, op: 'add' };
    const key = String(item);
    const existing = this.items.get(key) ?? [];
    existing.push(entry);
    this.items.set(key, existing);
    return entry;
  }

  remove(item: any): void {
    this.items.delete(String(item));
  }

  has(item: any): boolean {
    return this.items.has(String(item));
  }

  values(): any[] {
    const out: any[] = [];
    for (const entries of this.items.values()) {
      if (entries.length > 0) out.push(entries[0].item);
    }
    return out;
  }

  merge(other: Map<string, ORSetEntry[]> | Record<string, ORSetEntry[]>): void {
    const source = other instanceof Map ? other : new Map(Object.entries(other));
    for (const [key, entries] of source) {
      const existing = this.items.get(key) ?? [];
      const existingTags = new Set(existing.map((e) => e.tag));
      for (const entry of entries) {
        if (entry.op === 'add' && !existingTags.has(entry.tag)) {
          existing.push(entry);
        } else if (entry.op === 'remove') {
          this.items.delete(key);
        }
      }
      if (existing.length) this.items.set(key, existing);
    }
  }

  toJSON(): Record<string, ORSetEntry[]> {
    const out: Record<string, ORSetEntry[]> = {};
    for (const [k, v] of this.items) out[k] = v;
    return out;
  }
}

export interface Peer {
  node_id: string;
  region: string;
  online: boolean;
  latency_ms?: number;
}

export class EdgeRuntime {
  private state: Map<string, LWWRegister> = new Map();
  private pending: any[] = [];
  public online = true;
  public peers: Peer[] = [];

  constructor(public nodeId: string, public region = 'local') {}

  registerPeer(peer: Peer): void {
    this.peers.push(peer);
  }

  setState(key: string, value: any): LWWEntry {
    let reg = this.state.get(key);
    if (!reg) {
      reg = new LWWRegister(this.nodeId);
      this.state.set(key, reg);
    }
    return reg.set(value);
  }

  getState(key: string): any {
    const reg = this.state.get(key);
    return reg?.get() ?? null;
  }

  queueTask(task: any): void {
    if (!this.online) {
      this.pending.push(task);
    } else {
      this.execute(task);
    }
  }

  resync(): { applied: number; remaining: number } {
    let applied = 0;
    for (const task of [...this.pending]) {
      this.execute(task);
      const idx = this.pending.indexOf(task);
      if (idx >= 0) this.pending.splice(idx, 1);
      applied++;
    }
    return { applied, remaining: this.pending.length };
  }

  goOffline(): void {
    this.online = false;
  }

  goOnline(): void {
    this.online = true;
    this.resync();
  }

  nearestPeer(task: any): Peer | undefined {
    const candidates = this.peers.filter((p) => p.online);
    if (!candidates.length) return undefined;
    return candidates.reduce((best, p) => (p.latency_ms ?? Infinity) < (best.latency_ms ?? Infinity) ? p : best);
  }

  private execute(task: any): void {
    task.executed_by = this.nodeId;
    task.executed_at = new Date().toISOString();
  }
}
