import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CLI = path.resolve(process.cwd(), 'cli/dist/index.js');

const POLICY = `!alp-version: 3.1.0

@policy
  id: policy-safe-swarm
  applies_to: "*"
  enforcement: strict
  allow_paths:
    - "src/**"
  deny_paths:
    - ".env"
  allow_commands:
    - "npm test"
  deny_commands:
    - "rm -rf"
`;

function makeWorkspace(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alp-policy-'));
  fs.mkdirSync(path.join(tmp, '.alp'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.alp', 'governance.alp'), POLICY);
  return tmp;
}

/** Run the CLI, capturing stdout even on non-zero exit. */
function run(cwd: string, args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync('node', [CLI, ...args], { cwd, encoding: 'utf-8' });
    return { code: 0, out };
  } catch (e: any) {
    return { code: e.status ?? 1, out: (e.stdout ?? '') + (e.stderr ?? '') };
  }
}

describe('alp policy (v4 governance)', () => {
  it('lists defined policies', () => {
    const tmp = makeWorkspace();
    try {
      const { out } = run(tmp, ['policy']);
      expect(out).toContain('policy-safe-swarm');
      expect(out).toContain('allow_paths');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('allows a permitted path (exit 0)', () => {
    const tmp = makeWorkspace();
    try {
      const { code, out } = run(tmp, ['policy', '--path', 'src/index.ts']);
      expect(code).toBe(0);
      expect(out).toContain('Allowed');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('blocks a denied path (exit 1)', () => {
    const tmp = makeWorkspace();
    try {
      const { code, out } = run(tmp, ['policy', '--path', '.env']);
      expect(code).toBe(1);
      expect(out).toContain('BLOCKED');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('blocks a denied command (exit 1)', () => {
    const tmp = makeWorkspace();
    try {
      const { code, out } = run(tmp, ['policy', '--command', 'rm -rf /']);
      expect(code).toBe(1);
      expect(out).toContain('BLOCKED');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('validates the @policy schema', () => {
    const tmp = makeWorkspace();
    try {
      const { out } = run(tmp, ['validate', '.alp/governance.alp']);
      expect(out).toContain('[OK]');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
