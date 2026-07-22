import { Command } from 'commander';
import { MacroEngine } from '@alp/parser';

export function registerMacroCommand(program: Command) {
  const macroCmd = program
    .command('macro')
    .description('Dynamic @macro object generation (v37.0.0)');

  macroCmd
    .command('expand')
    .description('Expand @macro blocks in an .alp workspace into concrete objects')
    .argument('[file]', 'Optional .alp file to expand macros from')
    .action((_file) => {
      const engine = new MacroEngine();
      const sample = {
        _type: 'macro',
        id: 'demo-macro',
        iterate_over: "['auth', 'billing', 'notifications']",
        as: 'service',
        template: {
          _type: 'task',
          id: 'task-deploy-${service}',
          name: 'Deploy ${service} service',
        },
      };
      const expanded = engine.expand(sample);

      console.log('\n🔄 Macro Expansion (v37.0.0)');
      console.log('============================');
      console.log(`  Macro ID:    ${sample.id}`);
      console.log(`  Iterate:     ${sample.iterate_over}`);
      console.log(`  Generated:   ${expanded.length} objects\n`);
      expanded.forEach((obj, i) => {
        console.log(`  [${i + 1}] @${obj._type}  id: ${obj.id}  name: ${obj.name}`);
      });
      console.log('');
    });

  macroCmd
    .command('dry-run')
    .description('Show what objects a macro would generate without writing')
    .argument('<iterate>', 'JSON array to iterate over (e.g. "[\'a\',\'b\']")')
    .option('--as <var>', 'Variable name for each item', 'item')
    .action((iterate, options) => {
      const engine = new MacroEngine();
      const macro = {
        id: 'dry-run',
        iterate_over: iterate,
        as: options.as,
        template: { _type: 'task', id: 'task-${' + options.as + '}', name: '${' + options.as + '} task' },
      };

      try {
        const expanded = engine.expand(macro);
        console.log(`\n🔍 Dry Run: ${expanded.length} objects would be generated\n`);
        expanded.forEach((obj, i) => {
          console.log(`  [${i + 1}] ${JSON.stringify(obj)}`);
        });
        console.log('');
      } catch (err: any) {
        console.error(`❌ ${err.message}`);
      }
    });
}
