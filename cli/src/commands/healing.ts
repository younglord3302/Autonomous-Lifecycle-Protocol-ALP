import * as fs from 'fs';
import * as path from 'path';
import { HealingEngine, HEALING_DIR } from '@alp/parser';

export function healingCommand(subcommand: string, ...args: string[]) {
  const cwd = process.cwd();
  const alpDir = path.join(cwd, '.alp');
  if (!fs.existsSync(alpDir)) {
    console.error('Error: .alp directory not found. Run `alp init` first.');
    process.exit(1);
  }

  const engine = new HealingEngine(alpDir);

  switch (subcommand) {
    case 'history': {
      const workflow_id = args[0];
      const actions = engine.read_past_actions(workflow_id);
      if (actions.length === 0) {
        console.log('No healing actions recorded.');
        return;
      }
      for (const a of actions) {
        console.log(`- ${a.timestamp} [${a.strategy}] ${a.task_id} (${a.workflow_id || '_global'}): ${a.reason}`);
      }
      break;
    }
    case 'report': {
      const workflow_id = args[0] || '_global';
      const report = engine.get_report(workflow_id);
      if (!report) {
        console.log(`No healing report for workflow '${workflow_id}'.`);
        process.exit(1);
      }
      console.log(`HealingReport(workflow=${report.workflow_id}, actions=${report.toDict().total_actions}, succeeded=${report.toDict().succeeded}, failed=${report.toDict().failed})`);
      break;
    }
    default:
      console.error(`Unknown healing subcommand: ${subcommand}`);
      console.error('Usage: alp healing history [workflow-id] | report [workflow-id]');
      process.exit(1);
  }
}
