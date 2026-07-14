import * as fs from 'fs';
import * as path from 'path';

/**
 * ALP Memory Engine.
 *
 * Provides persistent, scoped key-value storage for agent knowledge.
 * Backed by a JSON file at `.alp/.memory.json`.
 *
 * Core principle: An agent should never have to figure out the same thing twice.
 */

export type MemoryType =
  | 'project'
  | 'architecture'
  | 'feature'
  | 'task'
  | 'decision'
  | 'error'
  | 'agent'
  | 'knowledge'
  | 'conversation'
  | 'context';

export type MemoryImportance = 'critical' | 'high' | 'medium' | 'low';

export interface MemoryEntry {
  id: string;
  type: MemoryType;
  key: string;
  value: string;
  scope?: string;
  importance: MemoryImportance;
  source?: string;
  ttl?: number; // milliseconds
  created: string;
  updated: string;
}

export interface MemoryQuery {
  type?: MemoryType;
  scope?: string;
  key?: string;
  importance?: MemoryImportance;
}

export class MemoryStore {
  private entries: Map<string, MemoryEntry> = new Map();
  private filePath: string;

  constructor(projectRoot: string) {
    this.filePath = path.join(projectRoot, '.alp', '.memory.json');
  }

  /**
   * Load memory from disk.
   */
  public load(): void {
    if (fs.existsSync(this.filePath)) {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const data: MemoryEntry[] = JSON.parse(raw);
      this.entries.clear();
      for (const entry of data) {
        this.entries.set(entry.id, entry);
      }
    }
  }

  /**
   * Persist memory to disk.
   */
  public persist(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data = Array.from(this.entries.values());
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  /**
   * Store a new memory entry.
   */
  public store(entry: Omit<MemoryEntry, 'created' | 'updated'>): MemoryEntry {
    const now = new Date().toISOString();
    const full: MemoryEntry = {
      ...entry,
      importance: entry.importance || 'medium',
      created: now,
      updated: now,
    };
    this.entries.set(full.id, full);
    return full;
  }

  /**
   * Retrieve memories matching a query.
   */
  public retrieve(query: MemoryQuery): MemoryEntry[] {
    let results = Array.from(this.entries.values());

    if (query.type) {
      results = results.filter(e => e.type === query.type);
    }
    if (query.scope) {
      results = results.filter(e => e.scope === query.scope);
    }
    if (query.key) {
      results = results.filter(e => e.key.includes(query.key!));
    }
    if (query.importance) {
      results = results.filter(e => e.importance === query.importance);
    }

    return results;
  }

  /**
   * Update an existing memory entry's value.
   */
  public update(id: string, value: string): MemoryEntry | undefined {
    const entry = this.entries.get(id);
    if (entry) {
      entry.value = value;
      entry.updated = new Date().toISOString();
      return entry;
    }
    return undefined;
  }

  /**
   * Delete a memory entry.
   */
  public delete(id: string): boolean {
    return this.entries.delete(id);
  }

  /**
   * Get a summary of all memories for a given scope.
   */
  public summarize(scope?: string): {
    total: number;
    byType: Record<string, number>;
    byImportance: Record<string, number>;
  } {
    let entries = Array.from(this.entries.values());
    if (scope) {
      entries = entries.filter(e => e.scope === scope);
    }

    const byType: Record<string, number> = {};
    const byImportance: Record<string, number> = {};

    for (const entry of entries) {
      byType[entry.type] = (byType[entry.type] || 0) + 1;
      byImportance[entry.importance] = (byImportance[entry.importance] || 0) + 1;
    }

    return { total: entries.length, byType, byImportance };
  }

  /**
   * Remove entries that have exceeded their TTL.
   */
  public expire(): number {
    const now = Date.now();
    let removed = 0;

    for (const [id, entry] of this.entries.entries()) {
      if (entry.ttl) {
        const created = new Date(entry.created).getTime();
        if (now - created > entry.ttl) {
          this.entries.delete(id);
          removed++;
        }
      }
    }

    return removed;
  }

  /**
   * Get all entries (for inspection/debugging).
   */
  public getAll(): MemoryEntry[] {
    return Array.from(this.entries.values());
  }

  /**
   * Get entry count.
   */
  public get size(): number {
    return this.entries.size;
  }
}
