import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CLI = path.resolve(process.cwd(), 'cli/dist/index.js');

/**
 * Tests for `alp evolve` (V3 Pillar 5 — Self-Evolving Protocol, v3.1.0).
 *
 * Verifies that recurring failures in the runtime log are surfaced as
 * candidate @rule safety checks, and that `--apply` emits schema-valid ALP.
 */
describe('alp evolve (self-evolving protocol)', () => {
  function makeWorkspace(events: string[]): string {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alp-evolve-'));
    const runtime = path.join(tmp, '.alp', '.runtime');
    fs.mkdirSync(runtime, { recursive: true });
    fs.writeFileSync(path.join(runtime, 'log.jsonl'), events.join('\n') + '\n');
    return tmp;
  }

  it('detects recurring failures and proposes a rule', () => {
    const tmp = makeWorkspace([
      '{"timestamp":"2026-07-17T00:00:00Z","type":"task_status","task_id":"task-auth","status":"[!]","pid":1}',
      '{"timestamp":"2026-07-17T00:01:00Z","type":"task_status","task_id":"task-auth","status":"[!]","pid":1}',
    ]);
    try {
      const output = execFileSync('node', [CLI, 'evolve', '--apply'], {
        cwd: tmp,
        encoding: 'utf-8',
        timeout: 20000,
      });

      expect(output).toContain('Recurring failures');
      expect(output).toContain('task-auth failed 2');

      const evolved = path.join(tmp, '.alp', 'evolved.alp');
      expect(fs.existsSync(evolved)).toBe(true);
      const body = fs.readFileSync(evolved, 'utf-8');
      expect(body).toContain('@rule');
      expect(body).toContain('id: rule-guard-task-auth');

      // The generated file must be valid ALP.
      const validate = execFileSync('node', [CLI, 'validate', '.alp/evolved.alp'], {
        cwd: tmp,
        encoding: 'utf-8',
        timeout: 20000,
      });
      expect(validate).toContain('[OK]');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 30000);

  it('reports a healthy swarm when there are no recurring failures', () => {
    const tmp = makeWorkspace([
      '{"timestamp":"2026-07-17T00:00:00Z","type":"task_status","task_id":"task-a","status":"[x]","pid":1}',
    ]);
    try {
      const output = execFileSync('node', [CLI, 'evolve'], {
        cwd: tmp,
        encoding: 'utf-8',
        timeout: 20000,
      });
      expect(output).toContain('No recurring failure patterns');
      expect(fs.existsSync(path.join(tmp, '.alp', 'evolved.alp'))).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 30000);
});
