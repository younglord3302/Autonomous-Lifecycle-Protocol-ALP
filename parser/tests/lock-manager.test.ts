import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LockManager } from '../src/index';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('LockManager', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'alp-lock-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('claims a free task and records the holding pid', () => {
    const lm = new LockManager(root);
    expect(lm.claim('task-a', 'worker-1')).toBe(true);
    expect(lm.getLockedTaskIds().has('task-a')).toBe(true);
  });

  it('refuses to claim a task already locked by a live process', () => {
    const lm = new LockManager(root);
    expect(lm.claim('task-a', 'worker-1')).toBe(true);
    // A second manager (simulating another worker) must NOT steal a live lock.
    const lm2 = new LockManager(root);
    expect(lm2.claim('task-a', 'worker-2')).toBe(false);
    expect(lm.getLockedTaskIds().has('task-a')).toBe(true);
  });

  it('releases a held lock so another worker can claim it', () => {
    const lm = new LockManager(root);
    lm.claim('task-a', 'worker-1');
    lm.release('task-a');

    const lm2 = new LockManager(root);
    expect(lm2.claim('task-a', 'worker-2')).toBe(true);
    expect(lm2.getLockedTaskIds().has('task-a')).toBe(true);
  });

  it('steals a stale lock left by a dead process', () => {
    const lm = new LockManager(root);
    expect(lm.claim('task-a', 'worker-1')).toBe(true);

    // Simulate a stale lock by overwriting the recorded pid with a dead one.
    const lockFile = path.join(root, '.alp', '.runtime', 'locks.json');
    const locks = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
    locks['task-a'].pid = 999999;
    fs.writeFileSync(lockFile, JSON.stringify(locks));

    const lm2 = new LockManager(root);
    expect(lm2.claim('task-a', 'worker-2')).toBe(true);
  });
});
