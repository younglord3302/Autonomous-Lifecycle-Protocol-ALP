import { describe, it, expect } from 'vitest';
import { SandboxEnvEngine } from '../src/sandbox-env';

describe('SandboxEnvEngine (v26.0.0)', () => {
  it('creates and configures micro-VM Wasm sandbox instance', () => {
    const engine = new SandboxEnvEngine();
    const sb = engine.createSandbox('sandbox-test-1', 'wasm', 256, true);

    expect(sb.id).toBe('sandbox-test-1');
    expect(sb.engineType).toBe('wasm');
    expect(sb.memoryMB).toBe(256);
    expect(sb.readOnlyFS).toBe(true);
  });

  it('executes whitelisted command in isolated sandbox', () => {
    const engine = new SandboxEnvEngine();
    engine.createSandbox('sb-run', 'wasm', 128);

    const res = engine.executeInSandbox('sb-run', 'npm test');
    expect(res.exitCode).toBe(0);
    expect(res.isolated).toBe(true);
    expect(engine.verifySandboxIsolation(res)).toBe(true);
  });

  it('blocks un-whitelisted command and enforces isolation policy', () => {
    const engine = new SandboxEnvEngine();
    engine.createSandbox('sb-blocked', 'wasm', 128);

    const res = engine.executeInSandbox('sb-blocked', 'rm -rf /');
    expect(res.exitCode).toBe(126);
    expect(res.stderr).toContain('Permission Denied');
    expect(engine.verifySandboxIsolation(res)).toBe(true);
  });
});
