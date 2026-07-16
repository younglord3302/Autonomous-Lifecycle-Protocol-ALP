import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const SERVER = path.resolve(process.cwd(), 'mcp-server/dist/index.js');
const EXAMPLE = path.resolve(process.cwd(), 'examples/todo-app');

interface JsonRpc {
  id?: number;
  result?: any;
  error?: any;
}

function callTool(
  proc: any,
  pending: Map<number, (r: JsonRpc) => void>,
  name: string,
  args: Record<string, unknown>,
): Promise<JsonRpc> {
  const id = Math.floor(Math.random() * 1e9);
  return new Promise((resolve) => {
    pending.set(id, resolve);
    proc.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }) + '\n',
    );
  });
}

/** A strict policy that denies all source writes except src/**. */
const STRICT_POLICY = `!alp-version: 3.1.0

@policy
  id: policy-lockdown
  applies_to: "*"
  enforcement: strict
  allow_paths:
    - "src/**"
  deny_paths:
    - ".alp/.runtime/**"
`;

describe('mcp-server policy enforcement (v4 capability scoping)', () => {
  it('audits an allowed status update and does not block protocol writes', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alp-mcp-pol-'));
    try {
      fs.cpSync(EXAMPLE, tmp, { recursive: true });
      // Replace the example policy with a strict lockdown one.
      fs.writeFileSync(path.join(tmp, '.alp', 'governance.alp'), STRICT_POLICY);

      const proc = spawn('node', [SERVER], { cwd: tmp, stdio: ['pipe', 'pipe', 'ignore'] });
      const pending = new Map<number, (r: JsonRpc) => void>();
      let buf = '';
      proc.stdout.on('data', (chunk: Buffer) => {
        buf += chunk.toString();
        let idx: number;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          const msg = JSON.parse(line) as JsonRpc;
          if (msg.id !== undefined && pending.has(msg.id)) {
            pending.get(msg.id)!(msg);
            pending.delete(msg.id);
          }
        }
      });
      proc.stdin.write(
        JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } } }) + '\n',
      );

      // Status update touches a task file under .alp/ — a protocol file, so it
      // is allowed (deny-only) even though src/** is the source allow-list.
      const updated = await callTool(proc, pending, 'alp_update_status', {
        id: 'task-login-ui',
        status: '[x]',
        agent: 'agent-developer',
      });
      expect(updated.result.isError).toBeFalsy();
      expect(updated.result.content[0].text).toContain('updated to [x]');

      // Delegation writes a new task under .alp/tasks — also allowed.
      const delegated = await callTool(proc, pending, 'alp_delegate', {
        title: 'Add password reset',
        agent: 'agent-developer',
      });
      expect(delegated.result.isError).toBeFalsy();

      // The audit trail must have recorded the mutations.
      const log = fs.readFileSync(path.join(tmp, '.alp/.runtime/log.jsonl'), 'utf-8');
      expect(log).toContain('"source":"mcp-server"');
      expect(log).toContain('task_status');
      expect(log).toContain('file_mutation');

      proc.kill();
    } finally {
      for (let i = 0; i < 5; i++) {
        try {
          fs.rmSync(tmp, { recursive: true, force: true });
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 200));
        }
      }
    }
  }, 20000);

  it('blocks a mutation that writes into a denied path', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alp-mcp-deny-'));
    try {
      fs.cpSync(EXAMPLE, tmp, { recursive: true });
      // Deny all .alp writes so even task creation is blocked.
      fs.writeFileSync(
        path.join(tmp, '.alp', 'governance.alp'),
        `!alp-version: 3.1.0\n\n@policy\n  id: policy-deny-alp\n  applies_to: "*"\n  enforcement: strict\n  deny_paths:\n    - ".alp/**"\n`,
      );

      const proc = spawn('node', [SERVER], { cwd: tmp, stdio: ['pipe', 'pipe', 'ignore'] });
      const pending = new Map<number, (r: JsonRpc) => void>();
      let buf = '';
      proc.stdout.on('data', (chunk: Buffer) => {
        buf += chunk.toString();
        let idx: number;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          const msg = JSON.parse(line) as JsonRpc;
          if (msg.id !== undefined && pending.has(msg.id)) {
            pending.get(msg.id)!(msg);
            pending.delete(msg.id);
          }
        }
      });
      proc.stdin.write(
        JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } } }) + '\n',
      );

      const delegated = await callTool(proc, pending, 'alp_delegate', {
        title: 'Should be blocked',
        agent: 'agent-developer',
      });
      expect(delegated.result.isError).toBe(true);
      expect(delegated.result.content[0].text).toContain('Policy denied');

      // No task file should have been written.
      expect(fs.existsSync(path.join(tmp, '.alp/tasks/should-be-blocked.alp'))).toBe(false);

      proc.kill();
    } finally {
      for (let i = 0; i < 5; i++) {
        try {
          fs.rmSync(tmp, { recursive: true, force: true });
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 200));
        }
      }
    }
  }, 20000);
});
