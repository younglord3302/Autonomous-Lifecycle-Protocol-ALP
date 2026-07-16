import { describe, it, expect, afterEach } from 'vitest';
import { spawn, ChildProcess } from 'node:child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'node:http';

const CLI = path.resolve(process.cwd(), 'cli/dist/index.js');

function call(port: number, method: string, pathname: string, body?: any): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      { host: '127.0.0.1', port, method, path: pathname, headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => resolve({ status: res.statusCode || 0, json: raw ? JSON.parse(raw) : null }));
      },
    );
    req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error('timeout')));
    if (data) req.write(data);
    req.end();
  });
}

async function waitFor(port: number) {
  for (let i = 0; i < 40; i++) {
    try { await call(port, 'GET', '/api/state'); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('server did not start');
}

describe('alp serve federation (Pillar 1: networked swarm)', () => {
  let proc: ChildProcess | null = null;
  const dirs: string[] = [];
  afterEach(() => {
    if (proc) proc.kill('SIGKILL');
    proc = null;
    for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
    dirs.length = 0;
  });

  it('registers nodes, accepts coordinated claims, and lists the roster', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alp-serve-swarm-'));
    dirs.push(tmp);
    fs.mkdirSync(path.join(tmp, '.alp', '.runtime'), { recursive: true });

    const port = 4222;
    proc = spawn('node', [CLI, 'serve', '--port', String(port)], { cwd: tmp });
    await waitFor(port);

    const join = await call(port, 'POST', '/api/swarm/join', { swarm_id: 'swarm-1', node_id: 'node-a' });
    expect(join.status).toBe(200);
    expect(join.json.node_id).toBe('node-a');

    const claim = await call(port, 'POST', '/api/swarm/claim', { swarm_id: 'swarm-1', node_id: 'node-a', task_id: 'task-1', agent: 'a1' });
    expect(claim.status).toBe(200);
    expect(claim.json.task_id).toBe('task-1');

    const dup = await call(port, 'POST', '/api/swarm/claim', { swarm_id: 'swarm-1', node_id: 'node-b', task_id: 'task-1', agent: 'a2' });
    expect(dup.status).toBe(409);

    const roster = await call(port, 'GET', '/api/swarm/roster?swarm_id=swarm-1');
    expect(roster.json.length).toBe(1);

    await call(port, 'POST', '/api/swarm/release', { swarm_id: 'swarm-1', task_id: 'task-1' });
    await call(port, 'POST', '/api/swarm/leave', { swarm_id: 'swarm-1', node_id: 'node-a' });
  });
});
