import * as fs from 'fs';
import * as path from 'path';

export interface RuntimeLock {
  task_id: string;
  agent_id: string;
  claimed_at: string;
  pid: number;
}

export class LockManager {
  private lockDir: string;
  private lockFile: string;

  constructor(workspaceRoot: string) {
    this.lockDir = path.join(workspaceRoot, '.alp', '.runtime');
    this.lockFile = path.join(this.lockDir, 'locks.json');
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.lockDir)) {
      fs.mkdirSync(this.lockDir, { recursive: true });
    }
  }

  private readLocks(): Record<string, RuntimeLock> {
    this.ensureDir();
    if (!fs.existsSync(this.lockFile)) {
      return {};
    }
    try {
      return JSON.parse(fs.readFileSync(this.lockFile, 'utf-8'));
    } catch {
      return {};
    }
  }

  private writeLocks(locks: Record<string, RuntimeLock>): void {
    this.ensureDir();
    fs.writeFileSync(this.lockFile, JSON.stringify(locks, null, 2), 'utf-8');
  }

  /**
   * Atomically claim a task for an agent.
   * Returns true if successful, false if already claimed.
   */
  claim(taskId: string, agentId: string): boolean {
    const locks = this.readLocks();

    // Already locked by an active process?
    const existing = locks[taskId];
    if (existing) {
      // Check if the process is still alive
      try {
        process.kill(existing.pid, 0); // Signal 0 just checks existence
        return false; // Process alive → task is claimed
      } catch {
        // Process is dead → stale lock, we can steal it
        delete locks[taskId];
      }
    }

    locks[taskId] = {
      task_id: taskId,
      agent_id: agentId,
      claimed_at: new Date().toISOString(),
      pid: process.pid
    };

    this.writeLocks(locks);
    return true;
  }

  /**
   * Release a task lock.
   */
  release(taskId: string): void {
    const locks = this.readLocks();
    delete locks[taskId];
    this.writeLocks(locks);
  }

  /**
   * Get all currently active locks.
   */
  getActiveLocks(): RuntimeLock[] {
    return Object.values(this.readLocks());
  }

  /**
   * Get IDs of all currently locked task IDs.
   */
  getLockedTaskIds(): Set<string> {
    return new Set(Object.keys(this.readLocks()));
  }

  /**
   * Clear all stale locks (from dead processes).
   */
  cleanup(): number {
    const locks = this.readLocks();
    let cleaned = 0;

    for (const [taskId, lock] of Object.entries(locks)) {
      try {
        process.kill(lock.pid, 0);
      } catch {
        delete locks[taskId];
        cleaned++;
      }
    }

    this.writeLocks(locks);
    return cleaned;
  }
}
