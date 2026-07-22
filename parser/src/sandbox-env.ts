export type SandboxEngineType = 'wasm' | 'firecracker' | 'chroot';

export interface SandboxInstance {
  id: string;
  engineType: SandboxEngineType;
  memoryMB: number;
  readOnlyFS: boolean;
  allowedCommands: string[];
  status: 'READY' | 'RUNNING' | 'TERMINATED';
  createdAt: string;
}

export interface SandboxExecutionResult {
  sandboxId: string;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  executionTimeMs: number;
  isolated: boolean;
}

export class SandboxEnvEngine {
  private sandboxes: Map<string, SandboxInstance> = new Map();

  public createSandbox(
    id: string,
    engineType: SandboxEngineType = 'wasm',
    memoryMB: number = 128,
    readOnlyFS: boolean = true,
    allowedCommands: string[] = ['npm test', 'node index.js', 'python main.py']
  ): SandboxInstance {
    const instance: SandboxInstance = {
      id,
      engineType,
      memoryMB,
      readOnlyFS,
      allowedCommands,
      status: 'READY',
      createdAt: new Date().toISOString(),
    };

    this.sandboxes.set(id, instance);
    return instance;
  }

  public executeInSandbox(sandboxId: string, command: string, env?: Record<string, string>): SandboxExecutionResult {
    const instance = this.sandboxes.get(sandboxId);
    const startTime = Date.now();

    if (!instance) {
      return {
        sandboxId,
        command,
        exitCode: 1,
        stdout: '',
        stderr: `Error: Sandbox environment '${sandboxId}' not found.`,
        executionTimeMs: 0,
        isolated: false,
      };
    }

    const isAllowed = instance.allowedCommands.some((cmd) => command.startsWith(cmd.split(' ')[0]));
    if (!isAllowed) {
      return {
        sandboxId,
        command,
        exitCode: 126,
        stdout: '',
        stderr: `Permission Denied: Command '${command}' not in sandbox allowed_commands whitelist.`,
        executionTimeMs: Date.now() - startTime,
        isolated: true,
      };
    }

    instance.status = 'RUNNING';
    const executionTimeMs = Date.now() - startTime + 5; // Simulating micro-sandbox spinup & execution
    instance.status = 'READY';

    return {
      sandboxId,
      command,
      exitCode: 0,
      stdout: `[Wasm Sandbox Exec: ${instance.engineType}] ${command} executed cleanly (${instance.memoryMB}MB isolated stack)`,
      stderr: '',
      executionTimeMs,
      isolated: true,
    };
  }

  public verifySandboxIsolation(result: SandboxExecutionResult): boolean {
    return result.isolated && (result.exitCode === 0 || result.stderr.includes('Permission Denied'));
  }

  public getSandbox(id: string): SandboxInstance | undefined {
    return this.sandboxes.get(id);
  }
}
