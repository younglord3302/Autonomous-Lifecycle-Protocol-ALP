export interface CostBudget {
  id: string;
  taskId: string;
  maxTokens: number;
  maxCostUSD: number;
  usedTokens: number;
  usedCostUSD: number;
  provider: string;
  modelTier: 'standard' | 'premium' | 'economy';
  createdAt: string;
}

export class CostBudgetEngine {
  private budgets: Map<string, CostBudget> = new Map();

  public createBudget(
    taskId: string,
    maxTokens: number,
    maxCostUSD: number,
    provider: string = 'openai',
    modelTier: 'standard' | 'premium' | 'economy' = 'standard'
  ): CostBudget {
    const budget: CostBudget = {
      id: `budget-${taskId}`,
      taskId,
      maxTokens,
      maxCostUSD,
      usedTokens: 0,
      usedCostUSD: 0,
      provider,
      modelTier,
      createdAt: new Date().toISOString(),
    };

    this.budgets.set(budget.id, budget);
    return budget;
  }

  public trackUsage(budgetId: string, tokensUsed: number, costUSD: number): { remainingCostUSD: number; remainingTokens: number; isExceeded: boolean } {
    const budget = this.budgets.get(budgetId);
    if (!budget) {
      return { remainingCostUSD: 0, remainingTokens: 0, isExceeded: true };
    }

    budget.usedTokens += tokensUsed;
    budget.usedCostUSD += costUSD;

    const remainingCostUSD = Math.max(0, budget.maxCostUSD - budget.usedCostUSD);
    const remainingTokens = Math.max(0, budget.maxTokens - budget.usedTokens);
    const isExceeded = budget.usedCostUSD > budget.maxCostUSD || budget.usedTokens > budget.maxTokens;

    return {
      remainingCostUSD,
      remainingTokens,
      isExceeded,
    };
  }

  public selectOptimalModel(taskComplexity: 'low' | 'medium' | 'high', maxCostUSD: number): { provider: string; model: string; estimatedCostPer1k: number } {
    if (taskComplexity === 'high' && maxCostUSD >= 0.10) {
      return { provider: 'anthropic', model: 'claude-3-5-sonnet', estimatedCostPer1k: 0.003 };
    } else if (taskComplexity === 'medium' || maxCostUSD >= 0.02) {
      return { provider: 'openai', model: 'gpt-4o-mini', estimatedCostPer1k: 0.00015 };
    } else {
      return { provider: 'ollama', model: 'llama3.2-local', estimatedCostPer1k: 0.00 };
    }
  }

  public getBudget(id: string): CostBudget | undefined {
    return this.budgets.get(id);
  }
}
