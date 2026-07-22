import { describe, it, expect } from 'vitest';
import { CostBudgetEngine } from '../src/cost-budget';

describe('CostBudgetEngine (v25.0.0)', () => {
  it('creates and tracks token/cost budget usage', () => {
    const engine = new CostBudgetEngine();
    const budget = engine.createBudget('task-api-crud', 10000, 0.05);

    expect(budget.id).toBe('budget-task-api-crud');
    expect(budget.maxTokens).toBe(10000);
    expect(budget.maxCostUSD).toBe(0.05);

    const update = engine.trackUsage(budget.id, 2000, 0.01);
    expect(update.remainingTokens).toBe(8000);
    expect(update.remainingCostUSD).toBeCloseTo(0.04);
    expect(update.isExceeded).toBe(false);
  });

  it('detects when cost or token budget is exceeded', () => {
    const engine = new CostBudgetEngine();
    const budget = engine.createBudget('task-fuzzing', 1000, 0.01);
    const update = engine.trackUsage(budget.id, 2000, 0.02);

    expect(update.isExceeded).toBe(true);
  });

  it('selects optimal LLM model based on complexity and budget cap', () => {
    const engine = new CostBudgetEngine();
    
    const highTier = engine.selectOptimalModel('high', 0.50);
    expect(highTier.model).toBe('claude-3-5-sonnet');

    const lowTier = engine.selectOptimalModel('low', 0.00);
    expect(lowTier.model).toBe('llama3.2-local');
  });
});
