import { describe, it, expect } from 'vitest';
import { PromptOptimizerEngine } from '../src/prompt-optimizer';

describe('PromptOptimizerEngine (v32.0.0)', () => {
  it('optimizes prompt using chain_of_thought strategy', () => {
    const engine = new PromptOptimizerEngine();
    const result = engine.optimizePrompt('opt-1', 'coder-agent', 'Solve math problem', 'chain_of_thought', 0.70);

    expect(result.id).toBe('opt-1');
    expect(result.targetAgent).toBe('coder-agent');
    expect(result.strategy).toBe('chain_of_thought');
    expect(result.optimizedPrompt).toContain('Think step by step');
    expect(result.newScore).toBeGreaterThan(0.70);
    expect(result.scoreImprovement).toBe(0.15);
    expect(result.iteration).toBe(1);
  });

  it('tracks optimization history per agent', () => {
    const engine = new PromptOptimizerEngine();
    engine.optimizePrompt('opt-1', 'agent-a', 'Task 1', 'role_spec');
    engine.optimizePrompt('opt-2', 'agent-a', 'Task 2', 'few_shot');

    const history = engine.getHistory('agent-a');
    expect(history.length).toBe(2);
    expect(history[1].iteration).toBe(2);
    expect(history[1].strategy).toBe('few_shot');
  });

  it('caps max optimized score at 1.0', () => {
    const engine = new PromptOptimizerEngine();
    const result = engine.optimizePrompt('opt-max', 'agent-b', 'Prompt', 'auto_dpo', 0.95);
    expect(result.newScore).toBe(1.0);
  });
});
