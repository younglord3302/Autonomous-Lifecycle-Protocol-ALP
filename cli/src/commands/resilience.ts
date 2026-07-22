import * as fs from 'fs';
import * as path from 'path';
import { ResilientSwarm, AgentStatus } from '@alp/parser';

export function resilienceCommand(subcommand: string, ...args: string[]) {
  const cwd = process.cwd();
  const alpDir = path.join(cwd, '.alp');
  if (!fs.existsSync(alpDir)) {
    console.error('Error: .alp directory not found. Run `alp init` first.');
    process.exit(1);
  }

  switch (subcommand) {
    case 'agents': {
      const swarm_id = args[0] || 'default';
      const swarm = new ResilientSwarm(swarm_id);
      const active = swarm.active_agents();
      if (active.length === 0) {
        console.log('No active agents.');
        return;
      }
      for (const a of active) {
        console.log(`- ${a.agent_id} (${a.status}) capabilities=${a.capabilities.join(',') || 'none'}`);
      }
      break;
    }
    case 'report': {
      const swarm_id = args[0] || 'default';
      const swarm = new ResilientSwarm(swarm_id);
      const report = swarm.get_report(swarm_id);
      if (!report) {
        console.log(`No resilience report for swarm '${swarm_id}'.`);
        process.exit(1);
      }
      const dict = report.toDict();
      console.log(`ResilienceReport(swarm=${dict.swarm_id}, actions=${dict.total_actions}, node_replacements=${dict.node_replacements}, task_redistributions=${dict.task_redistributions})`);
      break;
    }
    default:
      console.error(`Unknown resilience subcommand: ${subcommand}`);
      console.error('Usage: alp resilience agents [swarm-id] | report [swarm-id]');
      process.exit(1);
  }
}
