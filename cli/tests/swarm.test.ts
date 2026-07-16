import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CLI = path.resolve(process.cwd(), 'cli/dist/index.js');
const EXAMPLE = path.resolve(process.cwd(), 'examples/todo-app');

/**
 * End-to-end regression test for V3 swarm mode (`alp run --concurrent`).
 *
 * Guards against the deadlock bug where `extractDependencies` treated
 * `feature:`/`owner:` references as blocking dependencies, causing the
 * orchestrator to wait forever on "dependencies to unblock".
 */
describe('alp run --concurrent (swarm mode)', () => {
  it('completes and marks an actionable task [x] without deadlocking', () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alp-swarm-'));
    try {
      fs.cpSync(EXAMPLE, tmp, { recursive: true });

      // Flip one in-progress task to actionable ([ ]).
      const file = path.join(tmp, '.alp', 'features', 'user-auth.alp');
      const content = fs.readFileSync(file, 'utf-8');
      const updated = content.replace(
        /(?<=id: task-login-ui[\s\S]*?status: )\[~\]/,
        '[ ]',
      );
      fs.writeFileSync(file, updated);

      const output = execFileSync(
        'node',
        [CLI, 'run', '--concurrent', '2', '--dry-run'],
        { cwd: tmp, encoding: 'utf-8', timeout: 30000 },
      );

      // No infinite "Waiting for dependencies to unblock" loop.
      expect(output).toContain('Swarm Execution Complete');
      expect(output).toContain('Claimed task: task-login-ui');

      // The task must be persisted as done on disk.
      const after = fs.readFileSync(
        path.join(tmp, '.alp', 'features', 'user-auth.alp'),
        'utf-8',
      );
      expect(after).toMatch(/id: task-login-ui[\s\S]*?status: \[x\]/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('exits immediately when there are no actionable tasks', () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alp-swarm-'));
    try {
      fs.cpSync(EXAMPLE, tmp, { recursive: true });

      const output = execFileSync(
        'node',
        [CLI, 'run', '--concurrent', '2', '--dry-run'],
        { cwd: tmp, encoding: 'utf-8', timeout: 30000 },
      );

      expect(output).toContain('Swarm Execution Complete');
      expect(output).toContain('No actionable tasks found');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('clears a stale lock from a dead process instead of deadlocking', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alp-swarm-'));
    try {
      fs.cpSync(EXAMPLE, tmp, { recursive: true });

      // Make task-login-ui actionable.
      const file = path.join(tmp, '.alp', 'features', 'user-auth.alp');
      const content = fs.readFileSync(file, 'utf-8');
      fs.writeFileSync(
        file,
        content.replace(/(?<=id: task-login-ui[\s\S]*?status: )\[~\]/, '[ ]'),
      );

      // Simulate a leaked lock from a previous crashed run. PID 999999 is
      // effectively guaranteed not to exist, so it must be treated as stale.
      const runtime = path.join(tmp, '.alp', '.runtime');
      fs.mkdirSync(runtime, { recursive: true });
      fs.writeFileSync(
        path.join(runtime, 'locks.json'),
        JSON.stringify(
          {
            'task-login-ui': {
              task_id: 'task-login-ui',
              agent_id: 'ghost',
              claimed_at: '2020-01-01T00:00:00Z',
              pid: 999999,
            },
          },
          null,
          2,
        ),
      );

      const output = execFileSync(
        'node',
        [CLI, 'run', '--concurrent', '2', '--dry-run'],
        { cwd: tmp, encoding: 'utf-8', timeout: 30000 },
      );

      // The swarm must reclaim the stale lock and finish — not hang.
      expect(output).toContain('stale lock');
      expect(output).toContain('Claimed task: task-login-ui');
      expect(output).toContain('Swarm Execution Complete');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 40000);

  it('does not leak a lock after a single (non-concurrent) run', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alp-single-'));
    try {
      fs.cpSync(EXAMPLE, tmp, { recursive: true });

      const file = path.join(tmp, '.alp', 'features', 'user-auth.alp');
      const content = fs.readFileSync(file, 'utf-8');
      fs.writeFileSync(
        file,
        content.replace(/(?<=id: task-login-ui[\s\S]*?status: )\[~\]/, '[ ]'),
      );

      execFileSync('node', [CLI, 'run', '--dry-run'], {
        cwd: tmp,
        encoding: 'utf-8',
        timeout: 30000,
      });

      const lockFile = path.join(tmp, '.alp', '.runtime', 'locks.json');
      if (fs.existsSync(lockFile)) {
        const locks = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
        expect(Object.keys(locks)).toHaveLength(0);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 40000);
});
