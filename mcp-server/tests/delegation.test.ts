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

describe('mcp-server delegation tools', () => {
  it('alp_delegate and alp_decompose create discoverable tasks', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alp-mcp-'));
    try {
      fs.cpSync(EXAMPLE, tmp, { recursive: true });

      const proc = spawn('node', [SERVER], {
        cwd: tmp,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      const pending = new Map<number, (r: JsonRpc) => void>();
      let buf = '';
      const onData = (chunk: Buffer) => {
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
      };
      proc.stdout.on('data', onData);

      const send = (obj: unknown) => proc.stdin.write(JSON.stringify(obj) + '\n');
      send({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } } });

      const delegated = await callTool(proc, pending, 'alp_delegate', {
        title: 'Write integration tests for auth',
        agent: 'agent-qa',
        parent: 'task-login-ui',
      });
      expect(delegated.result.content[0].text).toContain('write-integration-tests-for-auth');

      const decomposed = await callTool(proc, pending, 'alp_decompose', {
        taskId: 'task-login-ui',
        subtasks: ['Build login form', 'Wire up API'],
      });
      expect(decomposed.result.content[0].text).toContain('2 sub-task');

      // Files must exist on disk.
      expect(fs.existsSync(path.join(tmp, '.alp/tasks/write-integration-tests-for-auth.alp'))).toBe(true);
      expect(fs.existsSync(path.join(tmp, '.alp/tasks/task-login-ui-build-login-form.alp'))).toBe(true);

      proc.kill();
    } finally {
      // On Windows the child process may still hold a handle on the temp
      // dir for a moment after kill(); retry cleanup to avoid EPERM flakes.
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
