import * as fs from 'fs';
import * as path from 'path';
import { MeteringStore, CostOptimizer, CostEstimator } from '@alp/parser';

export function costCommand(taskId?: string, opts?: { workflow?: string }) {
  const cwd = process.cwd();
  const alpDir = path.join(cwd, '.alp');
  if (!fs.existsSync(alpDir)) {
    console.error('Error: .alp directory not found. Run `alp init` first.');
    process.exit(1);
  }

  if (opts?.workflow) {
    printWorkflowOptimization(alpDir, opts.workflow);
    return;
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

function printWorkflowOptimization(alpDir: string, workflowId: string) {
  const workflowPath = path.join(alpDir, 'workflows.alp');
  if (!fs.existsSync(workflowPath)) {
    console.error('Error: workflows.alp not found in .alp directory.');
    process.exit(1);
  }

  const raw = fs.readFileSync(workflowPath, 'utf-8');
  const workflow = parseSimpleWorkflow(raw, workflowId);
  if (!workflow) {
    console.error(`Error: Workflow '${workflowId}' not found.`);
    process.exit(1);
  }

  const estimator = new CostEstimator({ cost_estimate: () => null });
  const optimizer = new CostOptimizer({}, estimator);

  const plan = optimizer.optimize(workflow);
  const d = plan as any;

  console.log(`\n🔍 Cost Optimization for Workflow: ${workflowId}`);
  console.log('==========================================');
  console.log(`  Current cost:      $${d.current_estimated_cost.toFixed(6)}`);
  console.log(`  Optimized cost:    $${d.optimized_estimated_cost.toFixed(6)}`);
  console.log(`  Savings:           $${d.savings.toFixed(6)} (${d.savings_percent.toFixed(1)}%)`);
  console.log(`  Suggestions:`);
  for (const s of d.suggestions) {
    console.log(`    - [${s.kind}] ${s.description} (saves $${s.estimated_savings.toFixed(6)}, confidence ${(s.confidence * 100).toFixed(0)}%)`);
  }
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

function parseSimpleWorkflow(raw: string, workflowId: string): Record<string, any> | null {
  const lines = raw.split('\n');
  let inWorkflow = false;
  let workflowName = '';
  const steps: Array<Record<string, any>> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('@workflow')) {
      inWorkflow = true
      const next = lines[i + 1]?.trim() || ''
      workflowName = next.replace(/^id:\s*/, '').trim() || '_unknown'
      continue
    }
    if (inWorkflow && line.startsWith('@')) {
      break
    }
    if (inWorkflow && line.trim().startsWith('- ')) {
      const name = line.trim().slice(2).trim()
      steps.push({ name, type: 'step' })
    }
  }

  if (!inWorkflow || !steps.length) return null
  return {
    id: workflowId,
    name: workflowName,
    steps,
  }
}
