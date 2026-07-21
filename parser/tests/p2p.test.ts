import { describe, it, expect } from 'vitest'
import { P2PNode, P2PSwarm, GossipMessage, GossipProtocol, DHT, TaskAssignment, P2PReport } from '../src/p2p'

describe('P2PNode (v18.1.0)', () => {
  it('round-trips through toDict/fromDict', () => {
    const node = new P2PNode('n1', 'agent-1', ['build', 'test'], 'addr-1', '2026-01-01T00:00:00Z')
    const dict = node.toDict()
    const restored = P2PNode.fromDict(dict)
    expect(restored.node_id).toBe('n1')
    expect(restored.agent_id).toBe('agent-1')
    expect(restored.capabilities).toEqual(['build', 'test'])
    expect(restored.address).toBe('addr-1')
  })

  it('defaults last_seen to now', () => {
    const node = new P2PNode('n1', 'agent-1')
    expect(node.last_seen.length).toBeGreaterThan(0)
  })
})

describe('TaskAssignment (v18.1.0)', () => {
  it('round-trips through toDict', () => {
    const assignment = new TaskAssignment('t1', 'agent-1', 'wf-1', 'assigned', 0, '2026-01-01T00:00:00Z')
    const dict = assignment.toDict()
    expect(dict.task_id).toBe('t1')
    expect(dict.agent_id).toBe('agent-1')
    expect(dict.workflow_id).toBe('wf-1')
    expect(dict.status).toBe('assigned')
  })
})

describe('GossipMessage (v18.1.0)', () => {
  it('round-trips through toDict', () => {
    const msg = new GossipMessage('task.assign', { task_id: 't1' }, 'n1', '2026-01-01T00:00:00Z', 2)
    const dict = msg.toDict()
    expect(dict.topic).toBe('task.assign')
    expect(dict.source_node).toBe('n1')
    expect(dict.ttl).toBe(2)
  })
})

describe('GossipProtocol (v18.1.0)', () => {
  it('spreads a message to fanout peers', () => {
    const protocol = new GossipProtocol(2)
    const peers = [
      new P2PNode('n1', 'agent-1'),
      new P2PNode('n2', 'agent-2'),
      new P2PNode('n3', 'agent-3'),
    ]
    const msg = new GossipMessage('topic', { data: 1 }, 'source')
    const forwarded = protocol.spread(msg, peers)
    expect(forwarded).toHaveLength(2)
    expect(forwarded[0].ttl).toBe(2)
    expect(forwarded[0].payload._forwarded_to).toBe('n1')
  })

  it('does not re-spread seen messages', () => {
    const protocol = new GossipProtocol()
    const peers = [new P2PNode('n1', 'agent-1')]
    const msg = new GossipMessage('topic', {}, 'src')
    protocol.spread(msg, peers)
    const again = protocol.spread(msg, peers)
    expect(again).toHaveLength(0)
  })

  it('does not spread when ttl is 0', () => {
    const protocol = new GossipProtocol()
    const peers = [new P2PNode('n1', 'agent-1')]
    const msg = new GossipMessage('topic', {}, 'src', '', 0)
    const forwarded = protocol.spread(msg, peers)
    expect(forwarded).toHaveLength(0)
  })
})

describe('DHT (v18.1.0)', () => {
  it('registers, resolves, and removes nodes', () => {
    const dht = new DHT()
    const node = new P2PNode('n1', 'agent-1', ['build'])
    dht.register(node)
    expect(dht.resolve('agent-1')?.node_id).toBe('n1')
    dht.remove('agent-1')
    expect(dht.resolve('agent-1')).toBeUndefined()
  })

  it('finds nodes by capability', () => {
    const dht = new DHT()
    dht.register(new P2PNode('n1', 'agent-1', ['build', 'test']))
    dht.register(new P2PNode('n2', 'agent-2', ['test']))
    const found = dht.findByCapability('test')
    expect(found).toHaveLength(2)
  })

  it('returns all nodes', () => {
    const dht = new DHT()
    dht.register(new P2PNode('n1', 'agent-1'))
    dht.register(new P2PNode('n2', 'agent-2'))
    expect(dht.allNodes()).toHaveLength(2)
  })
})

describe('P2PSwarm (v18.1.0)', () => {
  it('joins, leaves, and discovers nodes', () => {
    const swarm = new P2PSwarm('/tmp/alp')
    swarm.join(new P2PNode('n1', 'agent-1', ['build']))
    swarm.join(new P2PNode('n2', 'agent-2', ['test']))
    expect(swarm.discover('build')).toHaveLength(1)
    swarm.leave('agent-1')
    expect(swarm.discover('build')).toHaveLength(0)
  })

  it('gossips messages to peers', () => {
    const swarm = new P2PSwarm('/tmp/alp')
    swarm.join(new P2PNode('n1', 'agent-1'))
    swarm.join(new P2PNode('n2', 'agent-2'))
    const msg = new GossipMessage('topic', { data: 1 }, 'n1')
    const forwarded = swarm.gossip(msg)
    expect(forwarded.length).toBeGreaterThan(0)
  })

  it('assigns and runs tasks', () => {
    const swarm = new P2PSwarm('/tmp/alp')
    swarm.join(new P2PNode('n1', 'agent-1'))
    swarm.assign_task('t1', 'agent-1')
    const tasks = [{ task_id: 't1' }]
    const report = swarm.run((task_id) => {}, tasks)
    expect(report.toDict().total_actions).toBe(1)
    expect(report.toDict().completed).toBe(1)
  })

  it('fails tasks when node is missing', () => {
    const swarm = new P2PSwarm('/tmp/alp')
    swarm.join(new P2PNode('n1', 'agent-1'))
    swarm.assign_task('t1', 'agent-1')
    swarm.leave('agent-1')
    const tasks = [{ task_id: 't1' }]
    const report = swarm.run((task_id) => {}, tasks)
    expect(report.toDict().failed).toBe(1)
  })

  it('retries failed tasks up to max_retries', () => {
    let attempts = 0
    const swarm = new P2PSwarm('/tmp/alp', 3, 30_000, 2)
    swarm.join(new P2PNode('n1', 'agent-1'))
    swarm.assign_task('t1', 'agent-1')
    const report = swarm.run(() => { throw new Error('fail') }, [{ task_id: 't1' }])
    expect(report.toDict().failed).toBe(1)
  })
})

describe('P2PReport (v18.1.0)', () => {
  it('round-trips through toDict', () => {
    const report = new P2PReport('swarm-1')
    report.addAction({ type: 'task_completed', task_id: 't1' })
    report.addAction({ type: 'task_failed', task_id: 't2' })
    const dict = report.toDict()
    expect(dict.swarm_id).toBe('swarm-1')
    expect(dict.total_actions).toBe(2)
    expect(dict.completed).toBe(1)
    expect(dict.failed).toBe(1)
  })
})
