import { describe, it, expect, afterEach } from 'vitest';
import { spawn, ChildProcess } from 'node:child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'node:http';

const CLI = path.resolve(process.cwd(), 'cli/dist/index.js');

function httpGet(port: number, pathname: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: pathname }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode || 0, body: JSON.parse(data) }));
    });
    req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error('timeout')));
  });
}

async function waitForServer(port: number, tries = 40): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      await httpGet(port, '/api/state');
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('server did not start');
}

describe('alp serve --db (Pillar 5: state store)', () => {
  let proc: ChildProcess | null = null;
  const tmpDirs: string[] = [];
  const ports: number[] = [];

  afterEach(async () => {
    if (proc) {
      proc.kill('SIGKILL');
      await new Promise((r) => setTimeout(r, 200));
    }
    proc = null;
    for (const d of tmpDirs) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore EPERM on windows */ }
    }
    tmpDirs.length = 0;
  });

  it('persists events to a state store and serves analytics', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alp-serve-db-'));
    tmpDirs.push(tmp);
    const runtime = path.join(tmp, '.alp', '.runtime');
    fs.mkdirSync(runtime, { recursive: true });
    fs.writeFileSync(
      path.join(runtime, 'log.jsonl'),
      [
        '{"timestamp":"2026-07-17T00:00:00Z","type":"run_start","pid":1}',
        '{"timestamp":"2026-07-17T00:00:01Z","type":"task_claim","task_id":"task-auth","agent":"a1","pid":1}',
        '{"timestamp":"2026-07-17T00:00:11Z","type":"task_status","task_id":"task-auth","status":"[x]","agent":"a1","pid":1}',
      ].join('\n') + '\n',
    );

    const port = 4123;
    ports.push(port);
    proc = spawn('node', [CLI, 'serve', '--db', '--port', String(port)], { cwd: tmp });
    await waitForServer(port);

    const a = await httpGet(port, '/api/analytics');
    expect(a.status).toBe(200);
    expect(a.body.total_events).toBe(3);
    expect(a.body.runs).toBe(1);
    expect(a.body.avg_cycle_time_ms).toBe(10000);
    const t = a.body.tasks.find((x: any) => x.task_id === 'task-auth');
    expect(t.completed).toBe(true);

    const dbFile = path.join(runtime, 'state.db.json');
    expect(fs.existsSync(dbFile)).toBe(true);
    const snap = JSON.parse(fs.readFileSync(dbFile, 'utf-8'));
    expect(snap.events.length).toBe(3);
  });
});
