import * as fs from 'fs';
import * as path from 'path';
import { P2PSwarm, P2PNode, GossipMessage } from '@alp/parser';

export function p2pCommand(subcommand: string, ...args: string[]) {
  const cwd = process.cwd();
  const alpDir = path.join(cwd, '.alp');
  if (!fs.existsSync(alpDir)) {
    console.error('Error: .alp directory not found. Run `alp init` first.');
    process.exit(1);
  }

  const swarm = new P2PSwarm(alpDir);

  switch (subcommand) {
    case 'join': {
      const nodeId = args[0];
      const agentId = args[1];
      const capabilitiesIndex = args.indexOf('--capabilities');
      if (!nodeId || !agentId || capabilitiesIndex === -1) {
        console.error('Usage: alp p2p join <node-id> <agent-id> --capabilities <cap1,cap2>');
        process.exit(1);
      }
      const capabilities = args[capabilitiesIndex + 1]?.split(',').map(s => s.trim()).filter(Boolean) || [];
      const node = new P2PNode(nodeId, agentId, capabilities);
      swarm.join(node);
      console.log(`Node ${nodeId} (agent=${agentId}) joined with capabilities=${capabilities.join(',') || 'none'}`);
      break;
    }
    case 'leave': {
      const agentId = args[0];
      if (!agentId) {
        console.error('Usage: alp p2p leave <agent-id>');
        process.exit(1);
      }
      swarm.leave(agentId);
      console.log(`Agent ${agentId} left the swarm.`);
      break;
    }
    case 'gossip': {
      const topicIndex = args.indexOf('--topic');
      const payloadIndex = args.indexOf('--payload');
      if (topicIndex === -1 || payloadIndex === -1) {
        console.error('Usage: alp p2p gossip --topic <topic> --payload <json>');
        process.exit(1);
      }
      const topic = args[topicIndex + 1];
      const payload = JSON.parse(args[payloadIndex + 1] || '{}');
      const message = new GossipMessage(topic, payload, 'cli');
      const forwarded = swarm.gossip(message);
      console.log(`Gossiped to ${forwarded.length} peers.`);
      break;
    }
    case 'discover': {
      const capability = args[0];
      if (!capability) {
        console.error('Usage: alp p2p discover <capability>');
        process.exit(1);
      }
      const nodes = swarm.discover(capability);
      if (nodes.length === 0) {
        console.log(`No nodes found with capability: ${capability}`);
        return;
      }
      for (const n of nodes) {
        console.log(`- ${n.node_id} (${n.agent_id}) capabilities=${n.capabilities.join(',') || 'none'}`);
      }
      break;
    }
    case 'peers': {
      const peers = swarm.getReport()?.actions || [];
      console.log(`Peers: ${peers.length}`);
      break;
    }
    default:
      console.error(`Unknown p2p subcommand: ${subcommand}`);
      process.exit(1);
  }
}
