import * as fs from 'fs';
import * as path from 'path';
import { MeteringStore } from '@alp/parser';

export function costCommand(taskId?: string) {
  const cwd = process.cwd();
  const alpDir = path.join(cwd, '.alp');
  if (!fs.existsSync(alpDir)) {
    console.error('Error: .alp directory not found. Run `alp init` first.');
    process.exit(1);
  }

  const id = taskId || inferLatestTask(alpDir);
  if (!id) {
    console.error('Error: No task id provided and no active tasks found.');
    process.exit(1);
  }

  const store = new MeteringStore(alpDir);
  const estimate = store.costEstimate(id);

  console.log(`\n💰 Cost Estimate for Task: ${id}`);
  console.log('==============================');
  console.log(`  Total tokens:   ${estimate.tokens}`);
  console.log(`  Operations:     ${estimate.operations}`);
  console.log(`  Estimated cost: $${estimate.estimated_cost.toFixed(6)}`);

  const entries = store.readAll().filter((e) => e.task_id === id);
  if (entries.length > 0) {
    const agents = [...new Set(entries.map((e) => e.agent))];
    console.log(`  Agents:         ${agents.join(', ') || 'none'}`);
    const totalDuration = entries.reduce((s, e) => s + e.duration_ms, 0);
    console.log(`  Total duration: ${totalDuration}ms`);
  }

  const rate = store.rateLimiter('default');
  console.log(`  Rate limit:     ${rate.remaining} req/min (resets at ${rate.resetAt})`);
  console.log('');
}

function inferLatestTask(alpDir: string): string | null {
  const meteringPath = path.join(alpDir, '.runtime', 'metering.jsonl');
  if (!fs.existsSync(meteringPath)) return null;
  try {
    const raw = fs.readFileSync(meteringPath, 'utf-8');
    const lastLine = raw.trim().split('\n').filter(Boolean).pop();
    if (!lastLine) return null;
    const parsed = JSON.parse(lastLine);
    return parsed.task_id || null;
  } catch {
    return null;
  }
}
