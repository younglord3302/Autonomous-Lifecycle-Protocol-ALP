import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CLI = path.resolve(process.cwd(), 'cli/dist/index.js');
const EXAMPLE = path.resolve(process.cwd(), 'examples/todo-app');

/**
 * Regression test for `alp validate <dir>`.
 *
 * The CLI used to crash with EISDIR when given a directory (it only
 * handled a single file or the implicit cwd `.alp`). It must now walk
 * the directory recursively and validate every nested `.alp` file.
 */
describe('alp validate <dir>', () => {
  it('validates a directory recursively and exits 0', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alp-validate-'));
    try {
      fs.cpSync(EXAMPLE, tmp, { recursive: true });

      const output = execFileSync(
        'node',
        [CLI, 'validate', path.join(tmp, '.alp')],
        { cwd: tmp, encoding: 'utf-8', timeout: 30000 },
      );

      expect(output).toContain('All ALP files are valid');
      // Nested feature files must be visited, not just top-level ones.
      expect(output).toContain('features' + path.sep + 'user-auth.alp');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('reports errors and exits non-zero on an invalid workspace', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alp-validate-bad-'));
    try {
      fs.mkdirSync(path.join(tmp, '.alp'), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, '.alp', 'broken.alp'),
        '!alp-version: 1.0.0\n\n@task\n  description: "Task without an ID"\n',
        'utf-8',
      );

      let failed = false;
      try {
        execFileSync('node', [CLI, 'validate', path.join(tmp, '.alp')], {
          cwd: tmp,
          encoding: 'utf-8',
          timeout: 30000,
        });
      } catch (err: any) {
        failed = true;
        const out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
        expect(out).toContain('[ERROR]');
      }
      expect(failed).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
