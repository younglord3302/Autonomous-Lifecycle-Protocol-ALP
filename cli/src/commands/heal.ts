import { Command } from 'commander';
import { SelfHealingEngine } from '@alp/parser';

export function registerHealCommand(program: Command) {
  const heal = program
    .command('heal')
    .description('Self-healing AST diagnostics and auto-patching (v22.0.0)');

  heal
    .command('diagnose')
    .description('Scan .alp content for AST-level issues and generate diagnostics')
    .argument('<content>', 'Raw ALP spec content to diagnose')
    .action((content) => {
      const engine = new SelfHealingEngine();
      const diagnostics = engine.diagnose(content);

      console.log('\n🩺 Self-Healing AST Diagnostics (v22.0.0)');
      console.log('==========================================');
      if (diagnostics.length === 0) {
        console.log('  ✅ No issues detected.\n');
      } else {
        diagnostics.forEach((d) => {
          const icon = d.severity === 'error' ? '❌' : d.severity === 'warning' ? '⚠️' : 'ℹ️';
          console.log(`  ${icon} Line ${d.line}: ${d.message}`);
        });
        console.log('');
      }
    });

  heal
    .command('patch')
    .description('Auto-generate and apply healing patches')
    .argument('<content>', 'Raw ALP spec content to auto-patch')
    .action((content) => {
      const engine = new SelfHealingEngine();
      const patches = engine.generatePatches(content);
      const healed = engine.applyPatches(content, patches);

      console.log('\n🔧 Self-Healing Auto-Patch Report (v22.0.0)');
      console.log('============================================');
      console.log(`  Patches Generated: ${patches.length}`);
      console.log(`  Patches Applied:   ${patches.filter((p) => p.applied).length}`);
      console.log(`\n  Healed Output:\n${healed}\n`);
    });
}
