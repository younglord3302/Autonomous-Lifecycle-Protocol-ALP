import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  HealingStrategy,
  HealingContext,
  HealingAction,
  HealingReport,
  CircuitBreaker,
  HealingEngine,
  HEALING_DIR,
  HEALING_FILE,
} from '../src/healing'

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'alp-healing-'))
}

describe('CircuitBreaker (v16.1.0)', () => {
  it('opens after threshold failures', () => {
    const cb = new CircuitBreaker(2, 60_000)
    expect(cb.is_open('t1')).toBe(false)
    cb.record_failure('t1')
    expect(cb.is_open('t1')).toBe(false)
    cb.record_failure('t1')
    expect(cb.is_open('t1')).toBe(true)
  })

  it('closes after success', () => {
    const cb = new CircuitBreaker(2, 60_000)
    cb.record_failure('t1')
    cb.record_failure('t1')
    expect(cb.is_open('t1')).toBe(true)
    cb.record_success('t1')
    expect(cb.is_open('t1')).toBe(false)
  })

  it('resets manually', () => {
    const cb = new CircuitBreaker(1, 60_000)
    cb.record_failure('t1')
    expect(cb.is_open('t1')).toBe(true)
    cb.reset('t1')
    expect(cb.is_open('t1')).toBe(false)
  })
})

describe('HealingEngine (v16.1.0)', () => {
  it('retries on failure and records success', () => {
    const engine = new HealingEngine(tmpDir(), '16.1.0', undefined, 3, HealingStrategy.RETRY)
    let calls = 0
    const report = engine.heal('t1', 'network error', 1, () => { calls++ })
    expect(calls).toBe(1)
    expect(report.toDict().succeeded).toBe(1)
    expect(report.toDict().actions[0].strategy).toBe('retry')
  })

  it('escalates when max attempts reached', () => {
    const engine = new HealingEngine(tmpDir(), '16.1.0', undefined, 2, HealingStrategy.RETRY)
    const report = engine.heal('t1', 'network error', 2, () => { throw new Error('fail') })
    expect(report.toDict().failed).toBe(1)
    expect(report.toDict().actions[0].strategy).toBe('escalate')
  })

  it('skips non-retryable errors', () => {
    const engine = new HealingEngine(tmpDir(), '16.1.0', undefined, 3, HealingStrategy.RETRY)
    const report = engine.heal('t1', 'cannot retry: bad input', 1, () => {})
    expect(report.toDict().succeeded).toBe(1)
    expect(report.toDict().actions[0].strategy).toBe('skip')
  })

  it('rolls back on checkpoint metadata', () => {
    const engine = new HealingEngine(tmpDir(), '16.1.0', undefined, 3, HealingStrategy.RETRY)
    const report = engine.heal('t1', 'error', 2, () => {}, undefined, { checkpoint: true })
    expect(report.toDict().actions[0].strategy).toBe('rollback')
  })

  it('persists actions to disk', () => {
    const dir = tmpDir()
    const engine = new HealingEngine(dir, '16.1.0')
    engine.heal('t1', 'err', 1, () => {})
    const p = path.join(dir, HEALING_DIR, HEALING_FILE)
    expect(fs.existsSync(p)).toBe(true)
    const lines = fs.readFileSync(p, 'utf-8').trim().split('\n')
    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0])
    expect(parsed.task_id).toBe('t1')
  })

  it('reads past actions filtered by workflow', () => {
    const dir = tmpDir()
    const engine = new HealingEngine(dir, '16.1.0')
    engine.heal('t1', 'err', 1, () => {}, 'wf-a')
    engine.heal('t2', 'err', 1, () => {}, 'wf-b')
    const wf_actions = engine.read_past_actions('wf-a')
    expect(wf_actions).toHaveLength(1)
    expect(wf_actions[0].task_id).toBe('t1')
  })
})

describe('HealingReport (v16.1.0)', () => {
  it('summarizes actions correctly', () => {
    const report = new HealingReport('wf-1')
    report.add_action(new HealingAction('retry', 't1', 'wf-1', 1, 'ok', true))
    report.add_action(new HealingAction('escalate', 't2', 'wf-1', 1, 'fail', false))
    const dict = report.toDict()
    expect(dict.total_actions).toBe(2)
    expect(dict.succeeded).toBe(1)
    expect(dict.failed).toBe(1)
  })

  it('summary string contains key info', () => {
    const report = new HealingReport('wf-1')
    report.add_action(new HealingAction('retry', 't1', 'wf-1', 1, 'ok', true))
    const summary = report.summary()
    expect(summary).toContain('wf-1')
    expect(summary).toContain('actions=1')
  })
})
