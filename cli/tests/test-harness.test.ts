import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as path from 'path';

const CLI = path.resolve(process.cwd(), 'cli/dist/index.js');
const SUITE = path.resolve(process.cwd(), 'tests/compliance');

describe('alp test-harness', () => {
  it('runs the bundled compliance suite and exits 0', () => {
    const out = execFileSync('node', [CLI, 'test-harness', '--suite', SUITE], {
      encoding: 'utf-8',
    });
    expect(out).toContain('Compliance suite:');
    expect(out).toContain('0 failed');
  });
});
