import * as fs from 'fs';
import * as path from 'path';
import { ProtocolBridge, SUPPORTED_FORMATS, BridgeError } from '@alp/parser';

export function bridgeCommand(format: string, file?: string) {
  const cwd = process.cwd();
  const alpDir = path.join(cwd, '.alp');
  const bridge = new ProtocolBridge();

  if (!SUPPORTED_FORMATS.includes(format.toLowerCase() as any)) {
    console.error(`Error: Unsupported format '${format}'. Supported: ${SUPPORTED_FORMATS.join(', ')}`);
    process.exit(1);
  }

  if (file) {
    const abs = path.isAbsolute(file) ? file : path.join(cwd, file);
    if (!fs.existsSync(abs)) {
      console.error(`Error: File not found: ${abs}`);
      process.exit(1);
    }
    const raw = fs.readFileSync(abs, 'utf-8');
    const spec = JSON.parse(raw);
    const result = bridge.importSpec(spec, format.toLowerCase() as any);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const workflowPath = path.join(alpDir, 'workflows.alp');
  if (!fs.existsSync(workflowPath)) {
    console.error('Error: .alp/workflows.alp not found. Run `alp init` first.');
    process.exit(1);
  }

  const raw = fs.readFileSync(workflowPath, 'utf-8');
  const workflow = parseFirstWorkflow(raw);
  if (!workflow) {
    console.error('Error: No @workflow found in workflows.alp.');
    process.exit(1);
  }

  try {
    const result = bridge.exportWorkflow(workflow, format.toLowerCase() as any);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    if (err instanceof BridgeError) {
      console.error(`Error: ${err.message}`);
    } else {
      console.error(`Error: ${(err as Error).message}`);
    }
    process.exit(1);
  }
}

function parseFirstWorkflow(raw: string): Record<string, any> | null {
  const lines = raw.split('\n');
  let inWorkflow = false;
  let workflowName = '';
  const steps: Array<Record<string, any>> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('@workflow')) {
      inWorkflow = true;
      const next = lines[i + 1]?.trim() || '';
      workflowName = next.replace(/^id:\s*/, '').trim() || '_unknown';
      continue;
    }
    if (inWorkflow && line.startsWith('@')) {
      break;
    }
    if (inWorkflow && line.trim().startsWith('- ')) {
      const name = line.trim().slice(2).trim();
      steps.push({ name, type: 'step' });
    }
  }

  if (!inWorkflow || !steps.length) return null;
  return {
    id: workflowName,
    name: workflowName,
    steps,
  };
}
