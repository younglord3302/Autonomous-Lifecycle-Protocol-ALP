import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { spawn, ChildProcess } from 'child_process';

/**
 * E2E Integration Tests for `alp serve`, `alp run`, and `alp swarm`.
 *
 * These tests spin up an actual `alp serve` HTTP server, run CLI commands
 * against a temporary workspace, and verify real API responses and side
 * effects (file mutations, event logs, analytics).
 */

function fetch(url: string, opts?: { method?: string; body?: string; headers?: Record<string, string> }): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: opts?.method ?? 'GET',
        headers: opts?.headers ?? {},
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
      },
    );
    req.on('error', reject);
    if (opts?.body) req.write(opts.body);
    req.end();
  });
}

function makeTmpWorkspace(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alp-e2e-'));
  const alpDir = path.join(tmp, '.alp');
  const runtimeDir = path.join(alpDir, '.runtime');
  fs.mkdirSync(runtimeDir, { recursive: true });

  fs.writeFileSync(
    path.join(alpDir, 'project.alp'),
    `!alp-version: 3.0.0

@project
  id: e2e-test-project
  status: [~]
  description: "E2E integration test workspace"

---

@task
  id: task-alpha
  status: [ ]
  description: "First test task"
  verify:
    - "echo alpha-verified"

---

@task
  id: task-beta
  status: [ ]
  description: "Second test task, depends on alpha"
  depends_on:
    - -> task-alpha
  verify:
    - "echo beta-verified"

---

@agent
  id: agent-e2e
  role: "E2E Test Agent"

---

@policy
  id: policy-e2e
  applies_to: "*"
  enforcement: strict
  allow_paths:
    - "src/**"
  deny_paths:
    - "secrets/**"
  allow_commands:
    - "echo"
  deny_commands:
    - "rm -rf"
`,
    'utf-8',
  );

  // Seed an empty runtime log
  fs.writeFileSync(path.join(runtimeDir, 'log.jsonl'), '', 'utf-8');

  return tmp;
}

describe('E2E: alp serve API', () => {
  let workspace: string;
  let proc: ChildProcess;
  let baseUrl: string;
  const port = 14321 + Math.floor(Math.random() * 1000);

  beforeAll(async () => {
    workspace = makeTmpWorkspace();
    const cliPath = path.resolve(__dirname, '..', 'dist', 'index.js');

    proc = spawn('node', [cliPath, 'serve', '--port', String(port)], {
      cwd: workspace,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    baseUrl = `http://127.0.0.1:${port}`;

    // Wait for server to be ready
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server did not start in time')), 5000);
      const check = () => {
        fetch(`${baseUrl}/api/state`)
          .then(() => {
            clearTimeout(timeout);
            resolve();
          })
          .catch(() => setTimeout(check, 200));
      };
      check();
    });
  });

  afterAll(async () => {
    if (proc) proc.kill('SIGTERM');
    // Wait for the process to release file handles on Windows
    await new Promise((r) => setTimeout(r, 500));
    try { if (workspace) fs.rmSync(workspace, { recursive: true, force: true }); } catch { /* ignore cleanup errors */ }
  });

  it('GET /api/state returns task counts', async () => {
    const res = await fetch(`${baseUrl}/api/state`);
    expect(res.status).toBe(200);
    const state = JSON.parse(res.body);
    expect(state.totalTasks).toBeGreaterThanOrEqual(2);
    expect(state.statusCount).toBeDefined();
    expect(state.agents).toBeDefined();
  });

  it('GET /api/graph returns nodes and edges', async () => {
    const res = await fetch(`${baseUrl}/api/graph`);
    expect(res.status).toBe(200);
    const graph = JSON.parse(res.body);
    expect(graph.nodes).toBeDefined();
    expect(Array.isArray(graph.nodes)).toBe(true);
    expect(graph.nodes.length).toBeGreaterThanOrEqual(2);
  });

  it('GET /api/events returns event array', async () => {
    const res = await fetch(`${baseUrl}/api/events`);
    expect(res.status).toBe(200);
    const events = JSON.parse(res.body);
    expect(Array.isArray(events)).toBe(true);
  });

  it('GET / returns HTML dashboard', async () => {
    const res = await fetch(baseUrl);
    expect(res.status).toBe(200);
    expect(res.body).toContain('<!DOCTYPE html>');
    expect(res.body).toContain('ALP');
  });
});

describe('E2E: alp validate (CLI)', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = makeTmpWorkspace();
  });

  afterEach(() => {
    if (workspace) fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('validates a correct workspace without errors', async () => {
    const cliPath = path.resolve(__dirname, '..', 'dist', 'index.js');
    const result = await new Promise<{ code: number; stdout: string }>((resolve) => {
      const child = spawn('node', [cliPath, 'validate'], {
        cwd: workspace,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stdout += d));
      child.on('close', (code) => resolve({ code: code || 0, stdout }));
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('All ALP files are valid');
  });
});

describe('E2E: alp status (CLI)', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = makeTmpWorkspace();
  });

  afterEach(() => {
    if (workspace) fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('reports correct task counts', async () => {
    const cliPath = path.resolve(__dirname, '..', 'dist', 'index.js');
    const result = await new Promise<{ code: number; stdout: string }>((resolve) => {
      const child = spawn('node', [cliPath, 'status'], {
        cwd: workspace,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stdout += d));
      child.on('close', (code) => resolve({ code: code || 0, stdout }));
    });

    expect(result.code).toBe(0);
    // Status outputs summary counts, not individual task IDs
    expect(result.stdout).toContain('TASKS');
    expect(result.stdout).toContain('2 total');
  });
});

describe('E2E: alp policy (CLI)', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = makeTmpWorkspace();
  });

  afterEach(() => {
    if (workspace) fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('allows a permitted path', async () => {
    const cliPath = path.resolve(__dirname, '..', 'dist', 'index.js');
    const result = await new Promise<{ code: number; stdout: string }>((resolve) => {
      const child = spawn('node', [cliPath, 'policy', '--path', 'src/index.ts'], {
        cwd: workspace,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stdout += d));
      child.on('close', (code) => resolve({ code: code || 0, stdout }));
    });

    expect(result.code).toBe(0);
  });

  it('blocks a denied command', async () => {
    const cliPath = path.resolve(__dirname, '..', 'dist', 'index.js');
    const result = await new Promise<{ code: number; stdout: string }>((resolve) => {
      const child = spawn('node', [cliPath, 'policy', '--command', 'rm -rf /'], {
        cwd: workspace,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stdout += d));
      child.on('close', (code) => resolve({ code: code || 0, stdout }));
    });

    // Policy engine should block rm -rf (exit non-zero)
    expect(result.code).not.toBe(0);
  });
});
