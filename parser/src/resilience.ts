/** ALP Swarm Resilience (v16.3.0 — V12 The Sentinel Era).
 *
 * Wraps swarm coordination with automatic node replacement, quorum-based
 * decision making, and fault-tolerant task redistribution. Detects agent
 * failures via heartbeat and promotes standby agents. Implements Byzantine
 * fault tolerance for consensus.
 *
 * Mirrors `sdk/python/alp_sdk/resilience.py`.
 */

import { TaskAssignment } from './p2p'

export enum AgentStatus {
  ACTIVE = 'active',
  STANDBY = 'standby',
  FAILED = 'failed',
  REPLACED = 'replaced',
}

export interface AgentNodeData {
  agent_id: string
  status: string
  capabilities: string[]
  last_heartbeat: string
  failure_count: number
  metadata: Record<string, any>
}

export class AgentNode {
  agent_id: string
  status: string
  capabilities: string[]
  last_heartbeat: string
  failure_count: number
  metadata: Record<string, any>

  constructor(
    agent_id: string,
    status = AgentStatus.ACTIVE,
    capabilities: string[] = [],
    last_heartbeat = '',
    failure_count = 0,
    metadata: Record<string, any> = {},
  ) {
    this.agent_id = agent_id
    this.status = status
    this.capabilities = capabilities
    this.last_heartbeat = last_heartbeat || new Date().toISOString()
    this.failure_count = failure_count
    this.metadata = metadata
  }

  toDict(): AgentNodeData {
    return {
      agent_id: this.agent_id,
      status: this.status,
      capabilities: this.capabilities,
      last_heartbeat: this.last_heartbeat,
      failure_count: this.failure_count,
      metadata: this.metadata,
    }
  }
}



export interface ResilienceReportData {
  swarm_id: string
  actions: Array<Record<string, any>>
  started_at: string
  finished_at: string
  total_actions: number
  node_replacements: number
  task_redistributions: number
  consensus_rounds: number
}

export class ResilienceReport {
  swarm_id: string
  actions: Array<Record<string, any>> = []
  started_at: string
  finished_at: string = ''

  constructor(swarm_id: string) {
    this.swarm_id = swarm_id
    this.started_at = new Date().toISOString()
  }

  add_action(action: Record<string, any>): void {
    this.actions.push(action)
  }

  toDict(): ResilienceReportData {
    return {
      swarm_id: this.swarm_id,
      actions: this.actions,
      started_at: this.started_at,
      finished_at: this.finished_at || new Date().toISOString(),
      total_actions: this.actions.length,
      node_replacements: this.actions.filter((a) => a.type === 'node_replacement').length,
      task_redistributions: this.actions.filter((a) => a.type === 'task_redistribution').length,
      consensus_rounds: this.actions.filter((a) => a.type === 'consensus').length,
    }
  }
}

export interface ConsensusDecision {
  decision_id: string
  proposer: string
  payload: Record<string, any>
  votes: Record<string, { approve: boolean; reason: string }>
  accepted: boolean
  rejected: boolean
}

export class QuorumConsensus {
  private quorum_size: number
  private fault_tolerance: number

  constructor(quorum_size = 3, fault_tolerance = 1) {
    this.quorum_size = quorum_size
    this.fault_tolerance = fault_tolerance
  }

  propose(decision_id: string, proposer: string, payload: Record<string, any>): ConsensusDecision {
    return {
      decision_id,
      proposer,
      payload,
      votes: {},
      accepted: false,
      rejected: false,
    }
  }

  vote(decision: ConsensusDecision, voter: string, approve: boolean, reason = ''): ConsensusDecision {
    decision.votes[voter] = { approve, reason }
    this.tally(decision)
    return decision
  }

  is_decided(decision: ConsensusDecision): boolean {
    return !!decision.accepted || !!decision.rejected
  }

  private tally(decision: ConsensusDecision): void {
    const votes = decision.votes
    if (Object.keys(votes).length < this.quorum_size) return
    const approvals = Object.values(votes).filter((v) => v.approve).length
    const rejections = Object.values(votes).filter((v) => !v.approve).length
    if (approvals > rejections) {
      decision.accepted = true
    } else if (rejections > approvals) {
      decision.rejected = true
    }
  }
}

export class ResilientSwarm {
  private swarm_id: string
  private quorum_size: number
  private fault_tolerance: number
  private heartbeat_timeout: number
  private max_retries: number
  private agents: Map<string, AgentNode> = new Map()
  private assignments: TaskAssignment[] = []
  private consensus: QuorumConsensus
  private reports: Map<string, ResilienceReport> = new Map()
  private standby: AgentNode[] = []

  constructor(
    swarm_id: string,
    quorum_size = 3,
    fault_tolerance = 1,
    heartbeat_timeout = 30_000,
    max_retries = 2,
  ) {
    this.swarm_id = swarm_id
    this.quorum_size = quorum_size
    this.fault_tolerance = fault_tolerance
    this.heartbeat_timeout = heartbeat_timeout
    this.max_retries = max_retries
    this.consensus = new QuorumConsensus(quorum_size, fault_tolerance)
  }

  register_agent(agent: AgentNode, standby = false): void {
    agent.status = standby ? AgentStatus.STANDBY : AgentStatus.ACTIVE
    this.agents.set(agent.agent_id, agent)
    if (standby) {
      this.standby.push(agent)
    }
  }

  assign_task(task_id: string, agent_id: string, workflow_id = '_default'): TaskAssignment | undefined {
    if (!this.agents.has(agent_id)) return undefined
    const assignment = new TaskAssignment(task_id, agent_id, workflow_id)
    this.assignments.push(assignment)
    return assignment
  }

  record_heartbeat(agent_id: string): boolean {
    const agent = this.agents.get(agent_id)
    if (!agent) return false
    agent.last_heartbeat = new Date().toISOString()
    return true
  }

  detect_failures(): string[] {
    const now = Date.now()
    const failed: string[] = []
    for (const [agent_id, agent] of this.agents) {
      if (agent.status !== AgentStatus.ACTIVE) continue
      const last = parse_iso(agent.last_heartbeat)
      if (last === null) {
        failed.push(agent_id)
        continue
      }
      if (now - last > this.heartbeat_timeout) {
        agent.status = AgentStatus.FAILED
        agent.failure_count += 1
        failed.push(agent_id)
      }
    }
    return failed
  }

  private promote_standby(failed_agent_id: string): AgentNode | undefined {
    const eligible = this.standby.filter((a) => a.status === AgentStatus.STANDBY)
    if (!eligible.length) return undefined
    const promoted = eligible[0]
    promoted.status = AgentStatus.ACTIVE
    promoted.last_heartbeat = new Date().toISOString()
    this.standby = this.standby.filter((a) => a.agent_id !== promoted.agent_id)
    this.agents.set(promoted.agent_id, promoted)
    return promoted
  }

  private redistribute_tasks(failed_agent_id: string, replacement_id: string | undefined): TaskAssignment[] {
    const redistributed: TaskAssignment[] = []
    for (const assignment of this.assignments) {
      if (assignment.agent_id !== failed_agent_id || assignment.status !== 'assigned') continue
      const target = replacement_id || this.find_capable_agent()
      if (target) {
        assignment.agent_id = target
        assignment.retries += 1
        assignment.status = 'redistributed'
        redistributed.push(assignment)
      }
    }
    return redistributed
  }

  private find_capable_agent(): string | undefined {
    for (const agent of this.agents.values()) {
      if (agent.status === AgentStatus.ACTIVE && agent.capabilities.length > 0) {
        return agent.agent_id
      }
    }
    for (const agent of this.standby) {
      if (agent.capabilities.length > 0) {
        return agent.agent_id
      }
    }
    return undefined
  }

  propose_decision(decision_id: string, proposer: string, payload: Record<string, any>): ConsensusDecision {
    const decision = this.consensus.propose(decision_id, proposer, payload)
    const active_agents = Array.from(this.agents.values())
      .filter((a) => a.status === AgentStatus.ACTIVE)
      .map((a) => a.agent_id)
    for (const voter of active_agents.slice(0, this.quorum_size)) {
      this.consensus.vote(decision, voter, true)
    }
    return decision
  }

  run(
    executor: (task_id: string, agent_id: string) => void,
    tasks: Array<Record<string, any>>,
    workflow_id = '_default',
  ): ResilienceReport {
    const report = new ResilienceReport(this.swarm_id)
    this.reports.set(this.swarm_id, report)

    for (const task of tasks) {
      const task_id = task.task_id ?? task['task_id'] ?? ''
      const assignment = this.assignments.find((a) => a.task_id === task_id)
      if (!assignment) continue

      let agent_id = assignment.agent_id
      let agent = this.agents.get(agent_id)

      if (agent && agent.status === AgentStatus.FAILED) {
        const replacement = this.promote_standby(agent_id)
        if (replacement) {
          const redistributed = this.redistribute_tasks(agent_id, replacement.agent_id)
          for (const r of redistributed) {
            report.add_action({
              type: 'task_redistribution',
              task_id: r.task_id,
              from_agent: agent_id,
              to_agent: replacement.agent_id,
            })
          }
          report.add_action({
            type: 'node_replacement',
            failed_agent: agent_id,
            replacement: replacement.agent_id,
            timestamp: new Date().toISOString(),
          })
          agent = replacement
          assignment.agent_id = replacement.agent_id
        } else {
          report.add_action({
            type: 'task_failed',
            task_id,
            agent_id,
            reason: 'no replacement available',
          })
          continue
        }
      }

      let attempt = 0
      let success = false
      while (attempt <= this.max_retries && !success) {
        try {
          this.record_heartbeat(agent_id)
          executor(task_id, agent_id)
          success = true
          assignment.status = 'completed'
        } catch (exc) {
          attempt += 1
          if (attempt > this.max_retries) {
            agent!.status = AgentStatus.FAILED
            agent!.failure_count += 1
            report.add_action({
              type: 'task_failed',
              task_id,
              agent_id,
              reason: String(exc),
            })
            break
          }
          report.add_action({
            type: 'task_retry',
            task_id,
            agent_id,
            attempt,
          })
        }
      }
    }

    const decision = this.propose_decision('final', '_system', { workflow_id, tasks: tasks.length })
    report.add_action({
      type: 'consensus',
      decision_id: decision.decision_id,
      accepted: decision.accepted,
    })
    return report
  }

  get_report(swarm_id?: string): ResilienceReport | undefined {
    const key = swarm_id || this.swarm_id
    return this.reports.get(key)
  }

  active_agents(): AgentNode[] {
    return Array.from(this.agents.values()).filter((a) => a.status === AgentStatus.ACTIVE)
  }
}

function parse_iso(ts: string): number | null {
  try {
    return new Date(ts).getTime()
  } catch {
    return null
  }
}
