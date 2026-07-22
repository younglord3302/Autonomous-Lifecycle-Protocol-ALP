import { describe, it, expect } from 'vitest';
import { EvalSuiteEngine } from '../src/eval-suite';

describe('EvalSuiteEngine (v31.0.0)', () => {
  it('registers an evaluation suite and executes benchmark evaluation', () => {
    const engine = new EvalSuiteEngine();
    const config = engine.registerSuite(
      'suite-qa',
      'agent-coder',
      [
        { id: 't1', inputPrompt: 'Write unit tests', expectedOutput: 'unit tests', weight: 1.0 },
        { id: 't2', inputPrompt: 'Fix bug', expectedOutput: 'bug', weight: 2.0 },
      ],
      0.75
    );

    expect(config.id).toBe('suite-qa');
    expect(config.targetAgent).toBe('agent-coder');
    expect(config.testCases.length).toBe(2);

    const report = engine.runEvaluation('suite-qa');
    expect(report.passed).toBe(true);
    expect(report.totalScore).toBeGreaterThanOrEqual(0.75);
    expect(report.caseResults.length).toBe(2);
    expect(report.metricBreakdown.accuracy).toBeGreaterThan(0);
  });

  it('evaluates with custom agent executor function', () => {
    const engine = new EvalSuiteEngine();
    engine.registerSuite('suite-custom', 'agent-fast', [
      { id: 'c1', inputPrompt: 'hello', expectedOutput: 'world' },
    ]);

    const customExecutor = (prompt: string) => ({
      output: 'world',
      latencyMs: 15,
      tokensUsed: 10,
    });

    const report = engine.runEvaluation('suite-custom', customExecutor);
    expect(report.totalScore).toBe(1.0);
    expect(report.passed).toBe(true);
    expect(report.caseResults[0].latencyMs).toBe(15);
  });

  it('handles unknown suite gracefully', () => {
    const engine = new EvalSuiteEngine();
    const report = engine.runEvaluation('non-existent');
    expect(report.passed).toBe(false);
    expect(report.totalScore).toBe(0);
  });
});
