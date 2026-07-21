/** ALP Cost Optimization (v16.0.0 — V12 The Sentinel Era).
 *
 * Extends the runtime CostAnalyzer with workflow-level optimization:
 *
 * - `CostEstimator`    — predicts execution cost before a workflow runs.
 * - `CostOptimizer`    — analyzes a workflow graph and emits an
 *   `OptimizationPlan` with cheaper execution paths (parallelization,
 *   caching, agent reassignment).
 * - `AutoScaleRecommendation` — throughput-based scaling advice.
 *
 * Mirrors `sdk/python/alp_sdk/cost_optimizer.py`.
 */

export interface OptimizationSuggestion {
  kind: string
  description: string
  estimated_savings: number
  confidence: number
  metadata?: Record<string, any>
}

export interface OptimizationPlan {
  workflow_id: string
  current_estimated_cost: number
  optimized_estimated_cost: number
  savings: number
  savings_percent: number
  suggestions: OptimizationSuggestion[]
  generated_at: string
}

export interface AutoScaleRecommendation {
  metric: string
  current_value: number
  recommended_value: number
  reason: string
}

export interface CostEstimate {
  workflow_id: string
  total_tokens: number
  total_operations: number
  estimated_cost: number
  step_estimates: Array<{
    name: string
    tokens: number
    operations: number
    cost: number
  }>
}

export interface TaskCostEstimate {
  task_id: string
  tokens: number
  operations: number
  estimated_cost: number
}

export class CostEstimator {
  private tokenCost: number
  private operationCost: number
  private meteringLog: any

  constructor(
    meteringLog: any,
    tokenCost = 0.000002,
    operationCost = 0.001,
  ) {
    this.meteringLog = meteringLog
    this.tokenCost = tokenCost
    this.operationCost = operationCost
  }

  estimateWorkflow(workflow: Record<string, any>): CostEstimate {
    const steps = workflow.steps || []
    let totalTokens = 0
    let totalOperations = 0
    const stepEstimates: Array<{ name: string; tokens: number; operations: number; cost: number }> = []

    for (const step of steps) {
      const name = String(step.name ?? step.id ?? '<unnamed>')
      const estimatedTokens = Number(step.estimated_tokens ?? 1000)
      const estimatedOps = Number(step.estimated_operations ?? 10)
      totalTokens += estimatedTokens
      totalOperations += estimatedOps
      stepEstimates.push({
        name,
        tokens: estimatedTokens,
        operations: estimatedOps,
        cost: round(estimatedTokens * this.tokenCost + estimatedOps * this.operationCost, 6),
      })
    }

    const totalCost = round(totalTokens * this.tokenCost + totalOperations * this.operationCost, 6)
    return {
      workflow_id: String(workflow.id ?? workflow.name ?? '_unknown'),
      total_tokens: totalTokens,
      total_operations: totalOperations,
      estimated_cost: totalCost,
      step_estimates: stepEstimates,
    }
  }

  estimateTask(taskId: string, defaultTokens = 1000, defaultOps = 10): TaskCostEstimate {
    let tokens = defaultTokens
    let operations = defaultOps
    if (this.meteringLog?.cost_estimate) {
      const historical = this.meteringLog.cost_estimate(taskId) || {}
      tokens = historical.tokens ?? defaultTokens
      operations = historical.operations ?? defaultOps
    }
    const cost = round(tokens * this.tokenCost + operations * this.operationCost, 6)
    return { task_id: taskId, tokens, operations, estimated_cost: cost }
  }
}

export class CostOptimizer {
  private meteringLog: any
  private costEstimator: CostEstimator
  private agentCosts: Record<string, number>

  constructor(
    meteringLog: any,
    costEstimator?: CostEstimator,
    agentCosts?: Record<string, number>,
  ) {
    this.meteringLog = meteringLog
    this.costEstimator = costEstimator || new CostEstimator(meteringLog)
    this.agentCosts = agentCosts || {}
  }

  optimize(workflow: Record<string, any>): OptimizationPlan {
    const pre = this.costEstimator.estimateWorkflow(workflow)
    const currentCost = pre.estimated_cost
    const suggestions = this.suggest(workflow, pre)
    const optimizedCost = this.applySavings(currentCost, suggestions)
    return {
      workflow_id: pre.workflow_id,
      current_estimated_cost: currentCost,
      optimized_estimated_cost: optimizedCost,
      savings: round(currentCost - optimizedCost, 6),
      savings_percent: percent(currentCost, optimizedCost),
      suggestions,
      generated_at: new Date().toISOString(),
    }
  }

  suggest(workflow: Record<string, any>, pre: CostEstimate): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = []
    const steps = workflow.steps || []

    const parallelGroups = this.findParallelGroups(steps)
    if (parallelGroups.length > 0) {
      const savings = this.parallelizationSavings(parallelGroups, pre)
      if (savings > 0) {
        suggestions.push({
          kind: 'parallelization',
          description: `Parallelize ${parallelGroups.length} independent step groups`,
          estimated_savings: round(savings, 6),
          confidence: 0.8,
          metadata: { groups: parallelGroups },
        })
      }
    }

    const cacheable = this.findCacheableSteps(steps)
    if (cacheable.size > 0) {
      const savings = pre.step_estimates
        .filter((s: { name: string; cost: number }) => cacheable.has(s.name))
        .reduce((sum, s) => sum + s.cost, 0)
      suggestions.push({
        kind: 'caching',
        description: `Cache results for ${cacheable.size} deterministic steps`,
        estimated_savings: round(savings, 6),
        confidence: 0.6,
        metadata: { steps: Array.from(cacheable) },
      })
    }

    const reassignments = this.suggestAgentReassignments(steps)
    for (const [target, cheaper] of Object.entries(reassignments)) {
      const stepIdx = steps.findIndex((s: Record<string, any>) => (s.name ?? s.id) === target)
      if (stepIdx === -1) continue
      const stepCost = pre.step_estimates[stepIdx]?.cost ?? 0
      const currentAgentCost = this.agentCosts[target] ?? Infinity
      const cheaperAgentCost = this.agentCosts[cheaper] ?? Infinity
      if (cheaperAgentCost < currentAgentCost) {
        const saved = round(Math.min(stepCost, currentAgentCost - cheaperAgentCost), 6)
        if (saved > 0) {
          suggestions.push({
            kind: 'agent_reassignment',
            description: `Reassign '${target}' from '${target}' to '${cheaper}'`,
            estimated_savings: saved,
            confidence: 0.5,
            metadata: { step: target, from_agent: target, to_agent: cheaper },
          })
        }
      }
    }

    return suggestions
  }

  recommendAutoScale(workflowId: string, recentRuns: Array<Record<string, any>>): AutoScaleRecommendation[] {
    if (!recentRuns.length) {
      return [{
        metric: 'concurrency',
        current_value: 1,
        recommended_value: 2,
        reason: 'No recent runs; recommend conservative scale-up',
      }]
    }

    const throughputs: number[] = []
    for (const r of recentRuns) {
      const d = Number(r.duration_ms ?? 0)
      const tasks = Number(r.tasks_completed ?? 1)
      throughputs.push(tasks / Math.max(d / 1000, 0.001))
    }
    const avgThroughput = throughputs.reduce((a, b) => a + b, 0) / throughputs.length
    const currentConcurrency = Number(recentRuns[recentRuns.length - 1].concurrency ?? 1)
    const recommended = avgThroughput > 0 ? Math.max(1, Math.floor(avgThroughput / 10)) : currentConcurrency

    return [{
      metric: 'concurrency',
      current_value: currentConcurrency,
      recommended_value: recommended,
      reason: `Historical avg throughput: ${avgThroughput.toFixed(2)} tasks/sec`,
    }]
  }

  private findParallelGroups(steps: Array<Record<string, any>>): string[][] {
    const independent: string[] = []
    for (const step of steps) {
      const deps = step.depends_on ?? step.dependencies ?? []
      if (!deps.length) {
        independent.push(String(step.name ?? step.id ?? ''))
      }
    }
    return independent.length > 1 ? [independent] : []
  }

  private findCacheableSteps(steps: Array<Record<string, any>>): Set<string> {
    const cacheable = new Set<string>()
    for (const step of steps) {
      if (step.cache || step.deterministic) {
        cacheable.add(String(step.name ?? step.id ?? ''))
      }
    }
    return cacheable
  }

  private suggestAgentReassignments(steps: Array<Record<string, any>>): Record<string, string> {
    const reassignments: Record<string, string> = {}
    const agentCostEntries = Object.entries(this.agentCosts)
    for (const step of steps) {
      const agent = step.agent ?? step.owner
      if (!agent) continue
      const name = String(step.name ?? step.id ?? '')
      const currentCost = this.agentCosts[agent] ?? Infinity
      for (const [candidate, cost] of agentCostEntries) {
        if (candidate !== agent && cost < currentCost) {
          reassignments[name] = candidate
          break
        }
      }
    }
    return reassignments
  }

  private applySavings(current: number, suggestions: OptimizationSuggestion[]): number {
    const savings = suggestions.reduce((sum, s) => sum + s.estimated_savings, 0)
    return Math.max(0, round(current - savings, 6))
  }

  private parallelizationSavings(groups: string[][], pre: CostEstimate): number {
    const stepMap = new Map(pre.step_estimates.map(s => [s.name, s]))
    let saved = 0
    for (const group of groups) {
      const costs = group.map(name => stepMap.get(name)?.cost ?? 0)
      if (costs.length > 1) {
        saved += Math.min(...costs)
      }
    }
    return round(saved, 6)
  }
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function percent(current: number, optimized: number): number {
  if (current <= 0) return 0
  return round((current - optimized) / current * 100, 2)
}
