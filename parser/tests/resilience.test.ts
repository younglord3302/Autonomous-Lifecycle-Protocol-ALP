import { describe, it, expect } from 'vitest'
import {
  AgentStatus,
  AgentNode,
  ResilienceReport,
  QuorumConsensus,
  ResilientSwarm,
} from '../src/resilience'
import { TaskAssignment } from '../src/p2p'

describe('AgentNode (v16.3.0)', () => {
  it('round-trips through toDict', () => {
    const node = new AgentNode('a1', AgentStatus.ACTIVE, ['build', 'test'], '2026-01-01T00:00:00Z', 0, { region: 'us' })
    const dict = node.toDict()
    expect(dict.agent_id).toBe('a1')
    expect(dict.status).toBe('active')
    expect(dict.capabilities).toEqual(['build', 'test'])
    expect(dict.metadata).toEqual({ region: 'us' })
  })
})

describe('TaskAssignment (v16.3.0)', () => {
  it('round-trips through toDict', () => {
    const assignment = new TaskAssignment('t1', 'a1', 'wf-1', 'assigned', 0, '2026-01-01T00:00:00Z')
    const dict = assignment.toDict()
    expect(dict.task_id).toBe('t1')
    expect(dict.agent_id).toBe('a1')
    expect(dict.status).toBe('assigned')
  })
})

describe('QuorumConsensus (v16.3.0)', () => {
  it('accepts a proposal with majority approval', () => {
    const qc = new QuorumConsensus(3, 1)
    const decision = qc.propose('d1', 'p1', { action: 'scale' })
    qc.vote(decision, 'a1', true)
    qc.vote(decision, 'a2', true)
    qc.vote(decision, 'a3', false)
    expect(qc.is_decided(decision)).toBe(true)
    expect(decision.accepted).toBe(true)
    expect(decision.rejected).toBe(false)
  })

  it('rejects a proposal with majority disapproval', () => {
    const qc = new QuorumConsensus(3, 1)
    const decision = qc.propose('d1', 'p1', { action: 'scale' })
    qc.vote(decision, 'a1', false)
    qc.vote(decision, 'a2', false)
    qc.vote(decision, 'a3', true)
    expect(qc.is_decided(decision)).toBe(true)
    expect(decision.rejected).toBe(true)
  })

  it('does not decide before quorum is met', () => {
    const qc = new QuorumConsensus(3, 1)
    const decision = qc.propose('d1', 'p1', {})
    qc.vote(decision, 'a1', true)
    expect(qc.is_decided(decision)).toBe(false)
  })
})

describe('ResilientSwarm (v16.3.0)', () => {
  it('registers active and standby agents', () => {
    const swarm = new ResilientSwarm('swarm-1')
    swarm.register_agent(new AgentNode('a1', AgentStatus.ACTIVE, ['build']))
    swarm.register_agent(new AgentNode('a2', AgentStatus.STANDBY, ['test']), true)
    expect(swarm.active_agents()).toHaveLength(1)
    expect(swarm.active_agents()[0].agent_id).toBe('a1')
  })

  it('assigns tasks to known agents', () => {
    const swarm = new ResilientSwarm('swarm-1')
    swarm.register_agent(new AgentNode('a1', AgentStatus.ACTIVE))
    const assignment = swarm.assign_task('t1', 'a1')
    expect(assignment).toBeDefined()
    expect(assignment?.task_id).toBe('t1')
    expect(swarm.assign_task('t2', 'missing')).toBeUndefined()
  })

  it('records heartbeats', () => {
    const swarm = new ResilientSwarm('swarm-1')
    swarm.register_agent(new AgentNode('a1'))
    expect(swarm.record_heartbeat('a1')).toBe(true)
    expect(swarm.record_heartbeat('missing')).toBe(false)
  })

  it('detects failed agents by heartbeat timeout', () => {
    const swarm = new ResilientSwarm('swarm-1', 3, 1, 1)
    const node = new AgentNode('a1', AgentStatus.ACTIVE, [], new Date(Date.now() - 10_000).toISOString())
    swarm.register_agent(node)
    const failed = swarm.detect_failures()
    expect(failed).toContain('a1')
    expect(swarm.active_agents()).toHaveLength(0)
  })

  it('promotes standby agent on failure', () => {
    const swarm = new ResilientSwarm('swarm-1')
    swarm.register_agent(new AgentNode('a1', AgentStatus.ACTIVE))
    swarm.register_agent(new AgentNode('a2', AgentStatus.STANDBY, ['test']), true)
    swarm.agents.get('a1')!.status = AgentStatus.FAILED
    const replacement = swarm.promote_standby('a1')
    expect(replacement).toBeDefined()
    expect(replacement!.agent_id).toBe('a2')
    expect(swarm.active_agents()).toHaveLength(1)
  })

  it('redistributes tasks from failed agents', () => {
    const swarm = new ResilientSwarm('swarm-1')
    swarm.register_agent(new AgentNode('a1', AgentStatus.ACTIVE))
    swarm.assign_task('t1', 'a1')
    const redistributed = swarm.redistribute_tasks('a1', 'a1')
    expect(redistributed).toHaveLength(1)
    expect(redistributed[0].agent_id).toBe('a1')
  })

  it('runs tasks and records report', () => {
    const swarm = new ResilientSwarm('swarm-1')
    swarm.register_agent(new AgentNode('a1', AgentStatus.ACTIVE))
    swarm.assign_task('t1', 'a1')
    const report = swarm.run((task_id) => {}, [{ task_id: 't1' }])
    const dict = report.toDict()
    expect(dict.total_actions).toBeGreaterThan(0)
    expect(dict.consensus_rounds).toBeGreaterThanOrEqual(0)
  })

  it('fails and retries tasks on exception', () => {
    const swarm = new ResilientSwarm('swarm-1', 3, 1, 30_000, 1)
    swarm.register_agent(new AgentNode('a1', AgentStatus.ACTIVE))
    swarm.assign_task('t1', 'a1')
    const report = swarm.run(() => { throw new Error('boom') }, [{ task_id: 't1' }])
    const dict = report.toDict()
    expect(dict.total_actions).toBeGreaterThan(0)
    expect(report.toDict().actions.some((a) => a.type === 'task_retry')).toBe(true)
  })
})
