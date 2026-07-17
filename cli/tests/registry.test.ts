import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'node:http';

const CLI = path.resolve(process.cwd(), 'cli/dist/index.js');

function waitFor(port: number) {
  return new Promise<void>((resolve, reject) => {
    const tryOnce = (n: number) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/state' }, (r) => { r.resume(); resolve(); });
      req.on('error', () => (n > 40 ? reject(new Error('server timeout')) : setTimeout(() => tryOnce(n + 1), 100)));
    };
    tryOnce(0);
  });
}

describe('alp registry (Pillar 3: hosted registry & marketplace)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
    dirs.length = 0;
  });

  function makeWorkspaceWithPackage(): { root: string; pkgDir: string } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alp-reg-')); dirs.push(root);
    const pkgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alp-pkg-')); dirs.push(pkgDir);
    fs.writeFileSync(path.join(pkgDir, 'alp-package.json'), JSON.stringify({
      name: '@demo/scrum-master', version: '1.0.0', description: 'Scrum objects', files: ['plugin.alp'],
    }));
    fs.writeFileSync(path.join(pkgDir, 'plugin.alp'), '@agent\n  id: agent-scrum\n  name: "Scrum Master"\n');
    return { root, pkgDir };
  }

  it('publishes to local store, serves over HTTP, and installs with integrity', async () => {
    const { root, pkgDir } = makeWorkspaceWithPackage();
    // Init an empty workspace so `alp serve` and `alp publish` find .alp.
    fs.mkdirSync(path.join(root, '.alp'), { recursive: true });
    fs.writeFileSync(path.join(root, '.alp', 'project.alp'), '@project\n  id: demo-ws\n  name: "Demo"\n');

    // Publish into the workspace's local registry.
    execFileSync('node', [CLI, 'registry', 'publish', pkgDir], { cwd: root, encoding: 'utf-8', timeout: 20000 });

    // Start a hosted registry.
    const port = 4321;
    const proc = spawn('node', [CLI, 'serve', '--registry', '--port', String(port)], { cwd: root });
    await waitFor(port);

    try {
      // List via HTTP marketplace.
      const listRaw = await new Promise<string>((res) => {
        http.get({ host: '127.0.0.1', port, path: '/api/registry' }, (r) => {
          let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(d));
        });
      });
      const list = JSON.parse(listRaw);
      expect(list.some((p: any) => p.name === '@demo/scrum-master')).toBe(true);

      // Install from the hosted registry into a fresh consumer workspace.
      const consumer = fs.mkdtempSync(path.join(os.tmpdir(), 'alp-consumer-')); dirs.push(consumer);
      fs.mkdirSync(path.join(consumer, '.alp'), { recursive: true });
      const installed = execFileSync('node', [CLI, 'registry', 'install', '@demo/scrum-master@1.0.0', '--url', `http://127.0.0.1:${port}`], { cwd: consumer, encoding: 'utf-8', timeout: 20000 });
      expect(installed).toContain('Installed');
      expect(fs.existsSync(path.join(consumer, '.alp', 'packages', '_demo_scrum-master', 'plugin.alp'))).toBe(true);
      const lock = JSON.parse(fs.readFileSync(path.join(consumer, '.alp', 'registry.lock.json'), 'utf-8'));
      expect(lock['@demo/scrum-master'].version).toBe('1.0.0');
    } finally {
      proc.kill('SIGKILL');
    }
  });

  it('gates /api/registry with a bearer token (spec/14 §4.2)', async () => {
    const { root, pkgDir } = makeWorkspaceWithPackage();
    fs.mkdirSync(path.join(root, '.alp'), { recursive: true });
    fs.writeFileSync(path.join(root, '.alp', 'project.alp'), '@project\n  id demo-ws\n  name: "Demo"\n');
    execFileSync('node', [CLI, 'registry', 'publish', pkgDir], { cwd: root, encoding: 'utf-8', timeout: 20000 });

    const port = 4322;
    const proc = spawn('node', [CLI, 'serve', '--registry', '--registry-token', 'secret', '--port', String(port)], { cwd: root });
    await waitFor(port);

    const getStatus = (headers: Record<string, string>) =>
      new Promise<number>((resolve) => {
        const req = http.get({ host: '127.0.0.1', port, path: '/api/registry', headers }, (r) => {
          r.resume();
          resolve(r.statusCode || 0);
        });
        req.on('error', () => resolve(0));
      });

    try {
      expect(await getStatus({})).toBe(401);
      expect(await getStatus({ Authorization: 'Bearer wrong' })).toBe(401);
      expect(await getStatus({ Authorization: 'Bearer secret' })).toBe(200);
    } finally {
      proc.kill('SIGKILL');
    }
  });
});
