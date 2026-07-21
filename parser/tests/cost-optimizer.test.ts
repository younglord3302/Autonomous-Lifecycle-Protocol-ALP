import { describe, it, expect } from 'vitest';
import { CostEstimator, CostOptimizer, OptimizationPlan } from '../src/cost-optimizer';

describe('CostOptimizer (v16.0.0)', () => {
  const meteringLog = {
    cost_estimate: (taskId: string) => {
      if (taskId === 't1') return { tokens: 500, operations: 20 }
      return null
    },
  }

  it('estimates workflow tokens and operations', () => {
    const estimator = new CostEstimator(meteringLog)
    const workflow = {
      id: 'wf-1',
      steps: [
        { name: 'a', estimated_tokens: 1000, estimated_operations: 10 },
        { name: 'b', estimated_tokens: 2000, estimated_operations: 20 },
      ],
    }
    const estimate = estimator.estimateWorkflow(workflow)
    expect(estimate.workflow_id).toBe('wf-1')
    expect(estimate.total_tokens).toBe(3000)
    expect(estimate.total_operations).toBe(30)
    expect(estimate.estimated_cost).toBeCloseTo(0.036, 6)
  })

  it('falls back to historical metering for task estimates', () => {
    const estimator = new CostEstimator(meteringLog)
    const estimate = estimator.estimateTask('t1')
    expect(estimate.tokens).toBe(500)
    expect(estimate.operations).toBe(20)
    expect(estimate.estimated_cost).toBeCloseTo(0.021, 6)
  })

  it('suggests parallelization and caching', () => {
    const optimizer = new CostOptimizer(meteringLog)
    const workflow = {
      id: 'wf-2',
      steps: [
        { name: 'a', cache: true, estimated_tokens: 1000, estimated_operations: 10 },
        { name: 'b', deterministic: true, estimated_tokens: 500, estimated_operations: 5 },
        { name: 'c', estimated_tokens: 2000, estimated_operations: 20 },
      ],
    }
    const plan = optimizer.optimize(workflow)
    const kinds = plan.suggestions.map(s => s.kind)
    expect(kinds).toContain('parallelization')
    expect(kinds).toContain('caching')
    expect(plan.savings).toBeGreaterThan(0)
    expect(plan.savings_percent).toBeGreaterThan(0)
  })

  it('suggests agent reassignment when cheaper agent exists', () => {
    const optimizer = new CostOptimizer(meteringLog, undefined, {
      'agent-a': 0.05,
      'agent-b': 0.02,
    })
    const workflow = {
      id: 'wf-3',
      steps: [
        { name: 'step-1', agent: 'agent-a', estimated_tokens: 1000, estimated_operations: 10 },
      ],
    }
    const plan = optimizer.optimize(workflow)
    const reassign = plan.suggestions.find(s => s.kind === 'agent_reassignment')
    expect(reassign).toBeDefined()
    expect(reassign?.estimated_savings).toBeGreaterThan(0)
  })

  it('recommends auto-scaling based on throughput', () => {
    const optimizer = new CostOptimizer(meteringLog)
    const runs = [
      { duration_ms: 1000, tasks_completed: 10, concurrency: 1 },
      { duration_ms: 800, tasks_completed: 20, concurrency: 1 },
    ]
    const recs = optimizer.recommendAutoScale('wf-1', runs)
    expect(recs).toHaveLength(1)
    expect(recs[0].metric).toBe('concurrency')
    expect(recs[0].recommended_value).toBeGreaterThanOrEqual(1)
  })

  it('returns conservative recommendation with no history', () => {
    const optimizer = new CostOptimizer(meteringLog)
    const recs = optimizer.recommendAutoScale('wf-1', [])
    expect(recs).toHaveLength(1)
    expect(recs[0].recommended_value).toBe(2)
  })
})
