/** ALP Self-Healing Workflows (v16.1.0 — V12 The Sentinel Era).
 *
 * - `HealingStrategy`: enum of recovery strategies (retry, skip, rollback, escalate).
 * - `CircuitBreaker`: prevents cascading retries on repeated failures.
 * - `HealingEngine`: monitors workflow/task failures and selects/applies recovery.
 * - `HealingReport`: structured record of all recovery actions taken.
 *
 * Mirrors `sdk/python/alp_sdk/healing.py`.
 */

import * as fs from 'fs'
import * as path from 'path'

export const HEALING_DIR = '.healing'
export const HEALING_FILE = 'healing.jsonl'

export enum HealingStrategy {
  RETRY = 'retry',
  SKIP = 'skip',
  ROLLBACK = 'rollback',
  ESCALATE = 'escalate',
}

export interface HealingContextData {
  task_id: string
  workflow_id?: string
  attempt: number
  error: string
  timestamp: string
  metadata: Record<string, any>
}

export class HealingContext {
  task_id: string
  workflow_id?: string
  attempt: number
  error: string
  timestamp: string
  metadata: Record<string, any>

  constructor(task_id: string, workflow_id?: string, attempt = 0, error = '', timestamp = '', metadata: Record<string, any> = {}) {
    this.task_id = task_id
    this.workflow_id = workflow_id
    this.attempt = attempt
    this.error = error
    this.timestamp = timestamp || new Date().toISOString()
    this.metadata = metadata
  }

  toDict(): HealingContextData {
    return {
      task_id: this.task_id,
      workflow_id: this.workflow_id,
      attempt: this.attempt,
      error: this.error,
      timestamp: this.timestamp,
      metadata: this.metadata,
    }
  }
}

export interface HealingActionData {
  strategy: string
  task_id: string
  workflow_id?: string
  attempt: number
  reason: string
  succeeded: boolean
  timestamp: string
  metadata: Record<string, any>
}

export class HealingAction {
  strategy: string
  task_id: string
  workflow_id?: string
  attempt: number
  reason: string
  succeeded: boolean
  timestamp: string
  metadata: Record<string, any>

  constructor(
    strategy: string,
    task_id: string,
    workflow_id?: string,
    attempt = 0,
    reason = '',
    succeeded = false,
    timestamp = '',
    metadata: Record<string, any> = {},
  ) {
    this.strategy = strategy
    this.task_id = task_id
    this.workflow_id = workflow_id
    this.attempt = attempt
    this.reason = reason
    this.succeeded = succeeded
    this.timestamp = timestamp || new Date().toISOString()
    this.metadata = metadata
  }

  toDict(): HealingActionData {
    return {
      strategy: this.strategy,
      task_id: this.task_id,
      workflow_id: this.workflow_id,
      attempt: this.attempt,
      reason: this.reason,
      succeeded: this.succeeded,
      timestamp: this.timestamp,
      metadata: this.metadata,
    }
  }
}

export interface HealingReportData {
  workflow_id: string
  actions: HealingActionData[]
  started_at: string
  finished_at: string
  total_actions: number
  succeeded: number
  failed: number
}

export class HealingReport {
  workflow_id: string
  actions: HealingAction[] = []
  started_at: string
  finished_at: string = ''

  constructor(workflow_id: string) {
    this.workflow_id = workflow_id
    this.started_at = new Date().toISOString()
  }

  add_action(action: HealingAction): void {
    this.actions.push(action)
  }

  toDict(): HealingReportData {
    return {
      workflow_id: this.workflow_id,
      actions: this.actions.map(a => a.toDict()),
      started_at: this.started_at,
      finished_at: this.finished_at || new Date().toISOString(),
      total_actions: this.actions.length,
      succeeded: this.actions.filter(a => a.succeeded).length,
      failed: this.actions.filter(a => !a.succeeded).length,
    }
  }

  summary(): string {
    const d = this.toDict()
    return `HealingReport(workflow=${d.workflow_id}, actions=${d.total_actions}, succeeded=${d.succeeded}, failed=${d.failed})`
  }
}

export class CircuitBreaker {
  private failure_threshold: number
  private recovery_timeout: number
  private failures: Map<string, number> = new Map()
  private last_failure_ts: Map<string, number> = new Map()

  constructor(failure_threshold = 3, recovery_timeout = 60_000) {
    this.failure_threshold = failure_threshold
    this.recovery_timeout = recovery_timeout
  }

  record_failure(task_id: string): void {
    this.failures.set(task_id, (this.failures.get(task_id) || 0) + 1)
    this.last_failure_ts.set(task_id, Date.now())
  }

  record_success(task_id: string): void {
    this.failures.delete(task_id)
    this.last_failure_ts.delete(task_id)
  }

  is_open(task_id: string): boolean {
    const failures = this.failures.get(task_id) || 0
    if (failures < this.failure_threshold) return false
    const last_ts = this.last_failure_ts.get(task_id) || 0
    if (Date.now() - last_ts > this.recovery_timeout) {
      this.failures.delete(task_id)
      this.last_failure_ts.delete(task_id)
      return false
    }
    return true
  }

  reset(task_id: string): void {
    this.failures.delete(task_id)
    this.last_failure_ts.delete(task_id)
  }
}

export class HealingEngine {
  private alp_dir: string
  private version: string
  private circuit_breaker: CircuitBreaker
  private max_attempts: number
  private default_strategy: HealingStrategy
  private reports: Map<string, HealingReport> = new Map()

  constructor(
    alp_dir: string,
    version = '16.1.0',
    circuit_breaker?: CircuitBreaker,
    max_attempts = 3,
    default_strategy = HealingStrategy.RETRY,
  ) {
    this.alp_dir = alp_dir
    this.version = version
    this.circuit_breaker = circuit_breaker || new CircuitBreaker()
    this.max_attempts = max_attempts
    this.default_strategy = default_strategy
  }

  private healing_path(): string {
    const d = path.join(this.alp_dir, HEALING_DIR)
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })
    return path.join(d, HEALING_FILE)
  }

  private append_action(action: HealingAction): void {
    fs.appendFileSync(this.healing_path(), JSON.stringify(action.toDict()) + '\n')
  }

  private select_strategy(ctx: HealingContext): HealingStrategy {
    if (this.circuit_breaker.is_open(ctx.task_id)) return HealingStrategy.ESCALATE
    if (ctx.attempt >= this.max_attempts) return HealingStrategy.ESCALATE
    if (ctx.error.toLowerCase().includes('cannot retry')) return HealingStrategy.SKIP
    if (ctx.metadata['checkpoint'] && ctx.attempt > 1) return HealingStrategy.ROLLBACK
    return this.default_strategy
  }

  heal(
    task_id: string,
    error: string,
    attempt: number,
    executor: (ctx: HealingContext) => void,
    workflow_id?: string,
    context: Record<string, any> = {},
  ): HealingReport {
    const wf_id = workflow_id || '_global'
    if (!this.reports.has(wf_id)) {
      this.reports.set(wf_id, new HealingReport(wf_id))
    }
    const report = this.reports.get(wf_id)!

    const ctx = new HealingContext(task_id, workflow_id || '', attempt, error, '', context)
    const strategy = this.select_strategy(ctx)
    let succeeded = false
    let reason = ''

    if (strategy === HealingStrategy.RETRY) {
      try {
        executor(ctx)
        succeeded = true
        reason = 'Retry succeeded'
        this.circuit_breaker.record_success(task_id)
      } catch (exc) {
        succeeded = false
        reason = `Retry failed: ${exc}`
        this.circuit_breaker.record_failure(task_id)
      }
    } else if (strategy === HealingStrategy.SKIP) {
      reason = 'Skipped with justification: non-retryable error'
      succeeded = true
    } else if (strategy === HealingStrategy.ROLLBACK) {
      try {
        executor(ctx)
        succeeded = true
        reason = 'Rollback and re-execute succeeded'
        this.circuit_breaker.record_success(task_id)
      } catch (exc) {
        succeeded = false
        reason = `Rollback failed: ${exc}`
        this.circuit_breaker.record_failure(task_id)
      }
    } else if (strategy === HealingStrategy.ESCALATE) {
      reason = 'Escalated to human-in-the-loop: circuit breaker open or max attempts reached'
      succeeded = false
      this.circuit_breaker.record_failure(task_id)
    }

    const action = new HealingAction(
      strategy,
      task_id,
      workflow_id || '',
      attempt,
      reason,
      succeeded,
      '',
      { error },
    )
    report.add_action(action)
    this.append_action(action)
    return report
  }

  get_report(workflow_id: string): HealingReport | undefined {
    return this.reports.get(workflow_id)
  }

  read_past_actions(workflow_id?: string): HealingActionData[] {
    const p = this.healing_path()
    if (!fs.existsSync(p)) return []
    const actions: HealingActionData[] = []
    const lines = fs.readFileSync(p, 'utf-8').split('\n').filter(Boolean)
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as HealingActionData
        if (!workflow_id || parsed.workflow_id === workflow_id) {
          actions.push(parsed)
        }
      } catch {
        // skip malformed lines
      }
    }
    return actions
  }
}
