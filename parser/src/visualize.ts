import { AlpObject } from './reader';

export type DiagramFormat = 'mermaid' | 'dot' | 'json';

export interface WorkflowStep {
  name: string;
  task?: string;
  agent?: string;
  condition?: string;
  parallelGroup?: string;
  waitFor?: string;
  onSuccess?: string;
  onFailure?: string;
}

export interface ParsedWorkflow {
  id: string;
  name: string;
  goal?: string;
  steps: WorkflowStep[];
}

function readWorkflow(obj: AlpObject): ParsedWorkflow {
  const steps: WorkflowStep[] = [];
  const rawSteps = (obj as any).steps;
  if (Array.isArray(rawSteps)) {
    for (const s of rawSteps) {
      if (typeof s === 'object' && s !== null) {
        steps.push({
          name: typeof s.name === 'string' ? s.name : '(unnamed)',
          task: typeof s.task === 'string' ? s.task : undefined,
          agent: typeof s.agent === 'string' ? s.agent : undefined,
          condition: typeof s.condition === 'string' ? s.condition : undefined,
          parallelGroup: typeof s.parallel_group === 'string' ? s.parallel_group : undefined,
          waitFor: typeof s.wait_for === 'string' ? s.wait_for : undefined,
          onSuccess: typeof s.on_success === 'string' ? s.on_success : undefined,
          onFailure: typeof s.on_failure === 'string' ? s.on_failure : undefined,
        });
      } else if (typeof s === 'string') {
        steps.push({ name: s });
      }
    }
  }
  return {
    id: (obj.id as string) || 'unnamed',
    name: (obj.name as string) || (obj.id as string) || 'unnamed',
    goal: (obj.goal as string) || undefined,
    steps,
  };
}

export class WorkflowVisualizer {
  /** Parse all @workflow objects from a list of ALP objects. */
  parseWorkflows(objects: AlpObject[]): ParsedWorkflow[] {
    return objects
      .filter((o) => o._type === 'workflow')
      .map(readWorkflow);
  }

  /** Generate a Mermaid `flowchart` diagram for one or more workflows. */
  toMermaid(workflows: ParsedWorkflow[]): string {
    const lines: string[] = ['flowchart TD'];
    for (const wf of workflows) {
      lines.push(`  subgraph ${sanitize(wf.id)}["${escapeMermaid(wf.name)}"]`);
      wf.steps.forEach((step, i) => {
        const nodeId = stepId(wf.id, i);
        const label = stepLabel(step);
        const shape = step.parallelGroup ? `{{${label}}}` : `[${label}]`;
        lines.push(`    ${nodeId}${shape}`);
        if (i > 0) {
          const prev = stepId(wf.id, i - 1);
          if (step.waitFor) {
            lines.push(`    ${sanitize(`grp_${step.waitFor}`)} --> ${nodeId}`);
          } else {
            lines.push(`    ${prev} --> ${nodeId}`);
          }
        }
      });
      if (wf.steps.length > 0) {
        lines.push(`    ${stepId(wf.id, wf.steps.length - 1)} --> ${sanitize(wf.id)}_done(["✅ Done"])`);
      }
      lines.push('  end');
    }
    return lines.join('\n');
  }

  /** Generate a Graphviz DOT diagram. */
  toDot(workflows: ParsedWorkflow[]): string {
    const lines: string[] = ['digraph ALP {', '  rankdir=TD;', '  node [shape=box];'];
    for (const wf of workflows) {
      lines.push(`  subgraph cluster_${sanitize(wf.id)} {`);
      lines.push(`    label="${escapeDot(wf.name)}";`);
      wf.steps.forEach((step, i) => {
        const nodeId = stepId(wf.id, i);
        lines.push(`    ${nodeId} [label="${escapeDot(stepLabel(step))}"];`);
        if (i > 0) {
          const prev = stepId(wf.id, i - 1);
          if (step.waitFor) {
            lines.push(`    grp_${sanitize(step.waitFor)} -> ${nodeId};`);
          } else {
            lines.push(`    ${prev} -> ${nodeId};`);
          }
        }
      });
      lines.push('  }');
    }
    lines.push('}');
    return lines.join('\n');
  }

  /** Generate a structured JSON representation. */
  toJson(workflows: ParsedWorkflow[]): string {
    return JSON.stringify(workflows, null, 2);
  }

  generate(workflows: ParsedWorkflow[], format: DiagramFormat): string {
    switch (format) {
      case 'dot':
        return this.toDot(workflows);
      case 'json':
        return this.toJson(workflows);
      case 'mermaid':
      default:
        return this.toMermaid(workflows);
    }
  }
}

function stepId(wfId: string, index: number): string {
  return `s_${sanitize(wfId)}_${index}`;
}

function stepLabel(step: WorkflowStep): string {
  const parts: string[] = [step.name];
  if (step.task) parts.push(`task: ${step.task.replace(/^->\s*/, '')}`);
  if (step.agent) parts.push(`agent: ${step.agent.replace(/^->\s*/, '')}`);
  if (step.condition) parts.push(`if: ${step.condition}`);
  if (step.parallelGroup) parts.push(`group: ${step.parallelGroup}`);
  return parts.join('\\n');
}

function sanitize(input: string): string {
  return input.replace(/[^a-zA-Z0-9_]/g, '_');
}

function escapeMermaid(input: string): string {
  return input.replace(/"/g, "'").replace(/\[|\]/g, '');
}

function escapeDot(input: string): string {
  return input.replace(/"/g, '\\"');
}
