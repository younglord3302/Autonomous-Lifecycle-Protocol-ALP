import { Command } from 'commander';
import { CodeTransformEngine, TransformType } from '@alp/parser';

export function registerCodeTransformCommand(program: Command) {
  const transformCmd = program
    .command('transform')
    .description('Automated AST refactoring and code transformation engine (v34.0.0)');

  transformCmd
    .command('apply')
    .description('Apply an AST refactoring transform to a target file')
    .argument('<id>', 'Transform ID')
    .argument('<targetFile>', 'Target file path')
    .option('--type <t>', 'Transform type (rename_symbol|extract_function|inline_variable|add_log_guard|migration_rewrite)', 'rename_symbol')
    .option('--target-symbol <s>', 'Target symbol to rename or inline')
    .option('--new-symbol <n>', 'New symbol or helper name')
    .action((id, targetFile, options) => {
      const engine = new CodeTransformEngine();
      const sampleCode = `
        var legacyCounter = 0;
        function updateCounter(val) {
          legacyCounter += val;
          return legacyCounter;
        }
      `;

      const res = engine.applyTransform(
        id,
        options.type as TransformType,
        targetFile,
        sampleCode,
        options.targetSymbol || 'legacyCounter',
        options.newSymbol || 'activeCounter'
      );

      console.log('\n⚡ Code Transformation Applied (v34.0.0)');
      console.log('=======================================');
      console.log(`  Transform ID:   ${res.id}`);
      console.log(`  Transform Type: ${res.transformType}`);
      console.log(`  Target File:    ${res.targetFile}`);
      console.log(`  Status:         ${res.status.toUpperCase()}`);
      console.log('\n  Diff Preview:');
      console.log(`  -----------------------------------`);
      console.log(`  ${res.diffPreview.replace(/\n/g, '\n  ')}\n`);
    });
}
