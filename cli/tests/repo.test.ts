import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CLI = path.resolve(process.cwd(), 'cli/dist/index.js');

describe('alp repo (Pillar 2: cross-repo CLI)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
    dirs.length = 0;
  });

  function makeFederation(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alp-cli-repo-'));
    dirs.push(root);
    const wsAlp = path.join(root, '.alp');
    fs.mkdirSync(wsAlp, { recursive: true });
    const billing = path.join(root, 'billing');
    fs.mkdirSync(path.join(billing, '.alp'), { recursive: true });
    fs.writeFileSync(path.join(billing, '.alp', 'tasks.alp'), `
@task
  id: task-stripe
  status: "[x]"
`);
    fs.writeFileSync(path.join(wsAlp, 'repos.alp'), `
@repo
  id: billing
  src: "${billing.replace(/\\/g, '/')}"
`);
    fs.writeFileSync(path.join(wsAlp, 'tasks.alp'), `
@task
  id: task-checkout
  depends_on:
    - -> billing::task-stripe | blocks
`);
    return root;
  }

  it('resolves cross-repo references and flags the graph', () => {
    const root = makeFederation();
    const out = execFileSync('node', [CLI, 'repo', 'resolve'], { cwd: root, encoding: 'utf-8', timeout: 20000 });
    expect(out).toContain('All cross-repo references resolve');
    const graph = execFileSync('node', [CLI, 'repo', 'graph'], { cwd: root, encoding: 'utf-8', timeout: 20000 });
    expect(graph).toContain('billing');
    expect(graph).toContain('[billing] task-stripe');
  });

  it('lists declared repos with ls', () => {
    const root = makeFederation();
    const out = execFileSync('node', [CLI, 'repo', 'ls'], { cwd: root, encoding: 'utf-8', timeout: 20000 });
    expect(out).toContain('billing');
  });
});
