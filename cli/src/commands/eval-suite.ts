import { Command } from 'commander';
import { EvalSuiteEngine } from '@alp/parser';

export function registerEvalSuiteCommand(program: Command) {
  const evalCmd = program
    .command('eval')
    .description('Agentic benchmark and self-evaluation suite (v31.0.0)');

  evalCmd
    .command('run')
    .description('Run evaluation suite benchmark against a target agent')
    .argument('<suiteId>', 'Evaluation Suite ID')
    .argument('<targetAgent>', 'Target Agent ID')
    .option('--threshold <t>', 'Passing score threshold (0.0-1.0)', '0.8')
    .action((suiteId, targetAgent, options) => {
      const engine = new EvalSuiteEngine();
      engine.registerSuite(
        suiteId,
        targetAgent,
        [
          { id: 'case-1', inputPrompt: 'Write a Fibonacci function', expectedOutput: 'Fibonacci', weight: 1.0 },
          { id: 'case-2', inputPrompt: 'Handle invalid JSON input safely', expectedOutput: 'JSON', weight: 1.0 },
        ],
        parseFloat(options.threshold)
      );

      const report = engine.runEvaluation(suiteId);

      console.log('\n📊 Agent Evaluation Benchmark Report (v31.0.0)');
      console.log('============================================');
      console.log(`  Suite ID:      ${report.suiteId}`);
      console.log(`  Target Agent:  ${report.targetAgent}`);
      console.log(`  Total Score:   ${(report.totalScore * 100).toFixed(1)}%`);
      console.log(`  Status:        ${report.passed ? '✅ PASSED' : '❌ FAILED'}`);
      console.log(`  Threshold:     ${(report.passingThreshold * 100).toFixed(1)}%`);
      console.log('\n  Metric Breakdown:');
      console.log(`    - Accuracy:         ${(report.metricBreakdown.accuracy * 100).toFixed(1)}%`);
      console.log(`    - Speed:            ${(report.metricBreakdown.speed * 100).toFixed(1)}%`);
      console.log(`    - Token Efficiency: ${(report.metricBreakdown.token_efficiency * 100).toFixed(1)}%`);
      console.log(`    - Safety:           ${(report.metricBreakdown.safety * 100).toFixed(1)}%\n`);
    });
}
