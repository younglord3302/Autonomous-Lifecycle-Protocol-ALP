import { Command } from 'commander';
import { PromptOptimizerEngine, OptimizationStrategy } from '@alp/parser';

export function registerPromptOptimizerCommand(program: Command) {
  const promptCmd = program
    .command('prompt')
    .description('Continuous self-improving prompt & directive optimizer (v32.0.0)');

  promptCmd
    .command('optimize')
    .description('Optimize a system directive/prompt using target strategy')
    .argument('<id>', 'Optimization ID')
    .argument('<targetAgent>', 'Target Agent ID')
    .argument('<basePrompt>', 'Base prompt or directive text')
    .option('--strategy <s>', 'Optimization strategy (chain_of_thought|few_shot|role_spec|constraint_hardening|auto_dpo)', 'chain_of_thought')
    .option('--baseline <b>', 'Baseline performance score (0.0-1.0)', '0.72')
    .action((id, targetAgent, basePrompt, options) => {
      const engine = new PromptOptimizerEngine();
      const res = engine.optimizePrompt(
        id,
        targetAgent,
        basePrompt,
        options.strategy as OptimizationStrategy,
        parseFloat(options.baseline)
      );

      console.log('\n✨ Prompt Optimization Result (v32.0.0)');
      console.log('====================================');
      console.log(`  Optimization ID:    ${res.id}`);
      console.log(`  Target Agent:       ${res.targetAgent}`);
      console.log(`  Strategy:           ${res.strategy}`);
      console.log(`  Iteration:          #${res.iteration}`);
      console.log(`  Baseline Score:     ${(res.baselineScore * 100).toFixed(1)}%`);
      console.log(`  Optimized Score:    ${(res.newScore * 100).toFixed(1)}%`);
      console.log(`  Score Improvement:  +${(res.scoreImprovement * 100).toFixed(1)}%`);
      console.log('\n  Optimized Directive Prompt:');
      console.log(`  -----------------------------------`);
      console.log(`  ${res.optimizedPrompt.replace(/\n/g, '\n  ')}\n`);
    });
}
