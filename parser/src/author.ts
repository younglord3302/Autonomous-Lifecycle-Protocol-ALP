/** ALP natural-language workflow authoring (v7.1.0 — The Autonomous Era). */

import { StoredEvent } from './state-store';

export class AuthoringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthoringError';
  }
}

export interface AuthorStep {
  id: string;
  action: string;
  type: string;
  llm?: boolean;
}

export interface AuthorWorkflow {
  id: string;
  goal: string;
  steps: AuthorStep[];
  out_prefix: string;
}

export class WorkflowAuthor {
  private llmEndpoint?: string;

  constructor(llmEndpoint?: string) {
    this.llmEndpoint = llmEndpoint;
  }

  author(goal: string, outPrefix = '.alp/tmp/'): AuthorWorkflow {
    const trimmed = goal.trim();
    if (!trimmed) throw new AuthoringError('Goal must not be empty.');

    if (this.llmEndpoint) {
      return this.authorWithLlm(trimmed, outPrefix);
    }
    return this.authorRuleBased(trimmed, outPrefix);
  }

  private authorRuleBased(goal: string, outPrefix: string): AuthorWorkflow {
    const steps = this.decompose(goal);
    const workflowId = goal.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 40) || 'workflow';
    return { id: workflowId, goal, steps, out_prefix: outPrefix };
  }

  private decompose(goal: string): AuthorStep[] {
    const verbs = goal.match(/\b([A-Z][a-z]+)\b/g) ?? [];
    if (!verbs.length) {
      return [{ id: 'step-1', action: goal, type: 'task' }];
    }
    return verbs.map((verb, i) => ({
      id: `step-${i + 1}`,
      action: verb,
      type: 'task',
    }));
  }

  private authorWithLlm(goal: string, outPrefix: string): AuthorWorkflow {
    return {
      id: 'llm-workflow',
      goal,
      steps: [{ id: 'step-1', action: goal, type: 'task', llm: true }],
      out_prefix: outPrefix,
    };
  }
}
