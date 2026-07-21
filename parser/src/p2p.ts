/** ALP Decentralized Coordination (v18.1.0 — V14 The Sovereign Era).
 *
 * P2P swarm coordination without a central coordinator:
 *
 * - `P2PNode`         — a peer in the decentralized swarm.
 * - `P2PSwarm`        — gossip-based state sync, direct negotiation, ad-hoc federations.
 * - `GossipProtocol`  — best-effort rumor spreading for state synchronization.
 * - `DHT`             — lightweight distributed hash table for agent discovery.
 *
 * Mirrors `sdk/python/alp_sdk/p2p.py`.
 */

import * as crypto from 'node:crypto'
import * as fs from 'fs'
import * as path from 'path'

export interface P2PNodeData {
  node_id: string
  agent_id: string
  capabilities: string[]
  address: string
  last_seen: string
  metadata: Record<string, any>
}

export class P2PNode {
  node_id: string
  agent_id: string
  capabilities: string[]
  address: string
  last_seen: string
  metadata: Record<string, any>

  constructor(node_id: string, agent_id: string, capabilities: string[] = [], address = '', last_seen = '', metadata: Record<string, any> = {}) {
    this.node_id = node_id
    this.agent_id = agent_id
    this.capabilities = capabilities
    this.address = address
    this.last_seen = last_seen || new Date().toISOString()
    this.metadata = metadata
  }

  toDict(): P2PNodeData {
    return {
      node_id: this.node_id,
      agent_id: this.agent_id,
      capabilities: this.capabilities,
      address: this.address,
      last_seen: this.last_seen,
      metadata: this.metadata,
    }
  }

  static fromDict(d: Record<string, any>): P2PNode {
    return new P2PNode(
      d.node_id ?? d['node_id'],
      d.agent_id ?? d['agent_id'],
      d.capabilities ?? [],
      d.address ?? '',
      d.last_seen ?? '',
      d.metadata ?? {},
    )
  }
}

export interface TaskAssignmentData {
  task_id: string
  agent_id: string
  workflow_id: string
  status: string
  retries: number
  assigned_at: string
}

export class TaskAssignment {
  task_id: string
  agent_id: string
  workflow_id: string
  status: string
  retries: number
  assigned_at: string

  constructor(task_id: string, agent_id: string, workflow_id: string, status = 'assigned', retries = 0, assigned_at = '') {
    this.task_id = task_id
    this.agent_id = agent_id
    this.workflow_id = workflow_id
    this.status = status
    this.retries = retries
    this.assigned_at = assigned_at || new Date().toISOString()
  }

  toDict(): TaskAssignmentData {
    return {
      task_id: this.task_id,
      agent_id: this.agent_id,
      workflow_id: this.workflow_id,
      status: this.status,
      retries: this.retries,
      assigned_at: this.assigned_at,
    }
  }
}

export interface GossipMessageData {
  topic: string
  payload: Record<string, any>
  source_node: string
  timestamp: string
  ttl: number
}

export class GossipMessage {
  topic: string
  payload: Record<string, any>
  source_node: string
  timestamp: string
  ttl: number

  constructor(topic: string, payload: Record<string, any>, source_node: string, timestamp = '', ttl = 3) {
    this.topic = topic
    this.payload = payload
    this.source_node = source_node
    this.timestamp = timestamp || new Date().toISOString()
    this.ttl = ttl
  }

  toDict(): GossipMessageData {
    return {
      topic: this.topic,
      payload: this.payload,
      source_node: this.source_node,
      timestamp: this.timestamp,
      ttl: this.ttl,
    }
  }
}

export class DHT {
  private table: Map<string, P2PNode> = new Map()

  private nodeKey(agent_id: string): string {
    return crypto.createHash('sha256').update(agent_id).digest('hex').slice(0, 16)
  }

  register(node: P2PNode): void {
    this.table.set(this.nodeKey(node.agent_id), node)
  }

  resolve(agent_id: string): P2PNode | undefined {
    return this.table.get(this.nodeKey(agent_id))
  }

  remove(agent_id: string): void {
    this.table.delete(this.nodeKey(agent_id))
  }

  findByCapability(capability: string): P2PNode[] {
    return Array.from(this.table.values()).filter(n => n.capabilities.includes(capability))
  }

  allNodes(): P2PNode[] {
    return Array.from(this.table.values())
  }
}

export class GossipProtocol {
  private fanout: number
  private seen: Set<string> = new Set()

  constructor(fanout = 3) {
    this.fanout = fanout
  }

  spread(message: GossipMessage, peers: P2PNode[]): GossipMessage[] {
    const forwarded: GossipMessage[] = []
    const msg_id = this.messageId(message)
    if (this.seen.has(msg_id)) return forwarded
    this.seen.add(msg_id)
    if (message.ttl <= 0) return forwarded

    const fanoutPeers = peers.slice(0, this.fanout)
    for (const peer of fanoutPeers) {
      const next_payload = { ...message.payload, _forwarded_to: peer.node_id }
      forwarded.push(new GossipMessage(message.topic, next_payload, message.source_node, message.timestamp, message.ttl - 1))
    }
    return forwarded
  }

  private messageId(message: GossipMessage): string {
    const raw = JSON.stringify(message.toDict())
    return crypto.createHash('sha256').update(raw).digest('hex')
  }
}

export interface P2PReportData {
  swarm_id: string
  actions: Array<Record<string, any>>
  started_at: string
  finished_at: string
  total_actions: number
  completed: number
  failed: number
}

export class P2PReport {
  swarm_id: string
  actions: Array<Record<string, any>> = []
  started_at: string
  finished_at: string = ''

  constructor(swarm_id: string) {
    this.swarm_id = swarm_id
    this.started_at = new Date().toISOString()
  }

  addAction(action: Record<string, any>): void {
    this.actions.push(action)
  }

  toDict(): P2PReportData {
    return {
      swarm_id: this.swarm_id,
      actions: this.actions,
      started_at: this.started_at,
      finished_at: this.finished_at || new Date().toISOString(),
      total_actions: this.actions.length,
      completed: this.actions.filter(a => a.type === 'task_completed').length,
      failed: this.actions.filter(a => a.type === 'task_failed').length,
    }
  }
}

export class P2PSwarm {
  private alp_dir: string
  private fanout: number
  private heartbeat_timeout: number
  private max_retries: number
  private dht: DHT
  private gossip_protocol: GossipProtocol
  private assignments: TaskAssignment[] = []
  private reports: Map<string, P2PReport> = new Map()
  private messages: GossipMessage[] = []

  constructor(
    alp_dir: string,
    fanout = 3,
    heartbeat_timeout = 30_000,
    max_retries = 2,
  ) {
    this.alp_dir = alp_dir
    this.fanout = fanout
    this.heartbeat_timeout = heartbeat_timeout
    this.max_retries = max_retries
    this.dht = new DHT()
    this.gossip_protocol = new GossipProtocol(fanout)
  }

  join(node: P2PNode): void {
    this.dht.register(node)
    this.persist_peer(node)
  }

  leave(agent_id: string): void {
    this.dht.remove(agent_id)
    this.remove_peer(agent_id)
  }

  gossip(message: GossipMessage): GossipMessage[] {
    const peers = this.dht.allNodes()
    const forwarded = this.gossip_protocol.spread(message, peers)
    this.messages.push(message)
    this.messages.push(...forwarded)
    return forwarded
  }

  discover(capability: string): P2PNode[] {
    return this.dht.findByCapability(capability)
  }

  assign_task(task_id: string, agent_id: string, workflow_id = '_default'): TaskAssignment | undefined {
    const node = this.dht.resolve(agent_id)
    if (!node) return undefined
    const assignment = new TaskAssignment(task_id, agent_id, workflow_id)
    this.assignments.push(assignment)
    return assignment
  }

  run(executor: (task_id: string, agent_id: string) => void, tasks: Array<Record<string, any>>, workflow_id = '_default'): P2PReport {
    const report = new P2PReport(workflow_id)
    this.reports.set(workflow_id, report)

    for (const task of tasks) {
      const task_id = task.task_id ?? task['task_id'] ?? ''
      const assignment = this.assignments.find(a => a.task_id === task_id)
      if (!assignment) continue

      const node = this.dht.resolve(assignment.agent_id)
      if (!node) {
        report.addAction({ type: 'task_failed', task_id, reason: 'node not found' })
        continue
      }

      let attempt = 0
      let success = false
      while (attempt <= this.max_retries) {
        try {
          executor(task_id, assignment.agent_id)
          success = true
          break
        } catch {
          attempt++
        }
      }

      if (success) {
        assignment.status = 'completed'
        report.addAction({ type: 'task_completed', task_id, agent_id: assignment.agent_id })
      } else {
        assignment.status = 'failed'
        report.addAction({ type: 'task_failed', task_id, agent_id: assignment.agent_id })
      }
    }

    return report
  }

  getReport(workflow_id?: string): P2PReport | undefined {
    const key = workflow_id ?? this.alp_dir
    return this.reports.get(key)
  }

  private persist_peer(node: P2PNode): void {
    try {
      const d = path.join(this.alp_dir, '.p2p')
      if (!fs.existsSync(d)) {
        fs.mkdirSync(d, { recursive: true })
      }
      fs.appendFileSync(path.join(d, 'peers.jsonl'), JSON.stringify(node.toDict()) + '\n')
    } catch {
      // best-effort
    }
  }

  private remove_peer(node_id: string): void {
    try {
      const p = path.join(this.alp_dir, '.p2p', 'peers.jsonl')
      if (!fs.existsSync(p)) return
      const lines = fs.readFileSync(p, 'utf-8').split('\n').filter(Boolean)
      const kept: string[] = []
      for (const line of lines) {
        try {
          const entry = JSON.parse(line)
          if (entry.node_id !== node_id) {
            kept.push(line)
          }
        } catch {
          kept.push(line)
        }
      }
      fs.writeFileSync(p, kept.join('\n') + (kept.length ? '\n' : ''))
    } catch {
      // best-effort
    }
  }
}
