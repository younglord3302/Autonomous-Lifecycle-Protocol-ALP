import { Command } from 'commander';
import { CostBudgetEngine } from '@alp/parser';

export function registerBudgetCommand(program: Command) {
  const budget = program
    .command('budget')
    .description('Fine-grained token and cost budgeting router (v25.0.0)');

  budget
    .command('set')
    .description('Create a token and dollar cost allocation for a task')
    .argument('<taskId>', 'Task identifier')
    .argument('<maxTokens>', 'Max token limit', parseInt)
    .argument('<maxCostUSD>', 'Max cost in USD ($)', parseFloat)
    .option('--provider <p>', 'Preferred provider', 'openai')
    .action((taskId, maxTokens, maxCostUSD, options) => {
      const engine = new CostBudgetEngine();
      const b = engine.createBudget(taskId, maxTokens, maxCostUSD, options.provider);

      console.log('\n💵 Cost Budget Allocation Created (v25.0.0)');
      console.log('==========================================');
      console.log(`  Budget ID:     ${b.id}`);
      console.log(`  Task Target:   ${b.taskId}`);
      console.log(`  Max Tokens:    ${b.maxTokens.toLocaleString()}`);
      console.log(`  Max Cost Cap:  $${b.maxCostUSD.toFixed(4)} USD`);
      console.log(`  Provider:      ${b.provider}\n`);
    });

  budget
    .command('route')
    .description('Select optimal LLM model & provider based on task complexity & budget')
    .argument('<complexity>', 'Task complexity: low | medium | high')
    .argument('<maxCostUSD>', 'Max budget cap ($)', parseFloat)
    .action((complexity, maxCostUSD) => {
      const engine = new CostBudgetEngine();
      const route = engine.selectOptimalModel(complexity as any, maxCostUSD);

      console.log('\n🎯 Optimal LLM Model Route (v25.0.0)');
      console.log('===================================');
      console.log(`  Complexity:    ${complexity}`);
      console.log(`  Target Provider: ${route.provider}`);
      console.log(`  Selected Model:  ${route.model}`);
      console.log(`  Est. Cost/1k:   $${route.estimatedCostPer1k.toFixed(5)} USD\n`);
    });
}
