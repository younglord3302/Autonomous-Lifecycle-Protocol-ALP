import { Command } from 'commander';
import { SandboxEnvEngine, SandboxEngineType } from '@alp/parser';

export function registerSandboxCommand(program: Command) {
  const sandbox = program
    .command('sandbox')
    .description('Wasm sandbox & micro-VM isolated execution engine (v26.0.0)');

  sandbox
    .command('create')
    .description('Create an isolated micro-sandbox environment')
    .argument('<id>', 'Sandbox environment ID')
    .option('--engine <type>', 'Sandbox engine type: wasm | firecracker | chroot', 'wasm')
    .option('--mem <mb>', 'Memory limit in MB', '128')
    .action((id, options) => {
      const engine = new SandboxEnvEngine();
      const sb = engine.createSandbox(id, options.engine as SandboxEngineType, parseInt(options.mem, 10));

      console.log('\n📦 Wasm Micro-Sandbox Environment Created (v26.0.0)');
      console.log('==================================================');
      console.log(`  Sandbox ID:   ${sb.id}`);
      console.log(`  Engine:       ${sb.engineType}`);
      console.log(`  Memory Limit: ${sb.memoryMB} MB`);
      console.log(`  Read-Only FS: ${sb.readOnlyFS ? '🔒 YES' : '🔓 NO'}`);
      console.log(`  Status:       ${sb.status}\n`);
    });

  sandbox
    .command('run')
    .description('Execute shell command inside an isolated micro-sandbox')
    .argument('<sandboxId>', 'Sandbox ID')
    .argument('<cmd...>', 'Command to execute')
    .action((sandboxId, cmdParts) => {
      const engine = new SandboxEnvEngine();
      engine.createSandbox(sandboxId, 'wasm', 128);

      const fullCmd = cmdParts.join(' ');
      const result = engine.executeInSandbox(sandboxId, fullCmd);

      console.log('\n⚡ Sandbox Execution Receipt (v26.0.0)');
      console.log('=====================================');
      console.log(`  Sandbox ID: ${result.sandboxId}`);
      console.log(`  Command:    ${result.command}`);
      console.log(`  Exit Code:  ${result.exitCode}`);
      console.log(`  Isolated:   ${result.isolated ? '🛡️ TRUE' : '⚠️ UNISOLATED'}`);
      console.log(`  Output:     ${result.stdout || result.stderr}\n`);
    });
}
