/** ALP planning & reasoning (v8.0.0 — The Cognitive Era). */

export class PlanNode {
  constructor(
    public id: string,
    public kind: string,
    public label: string,
    public depends_on: string[] = [],
  ) {}
}

export class Plan {
  constructor(
    public plan_id: string,
    public goal: string,
    public nodes: PlanNode[] = [],
    public metadata: Record<string, any> = {},
  ) {}

  addNode(node: PlanNode): void {
    this.nodes.push(node);
  }
}

export class Lesson {
  constructor(
    public lesson_id: string,
    public run_id: string,
    public insight: string,
    public severity: string = 'info',
    public tags: string[] = [],
  ) {}
}

export class GoalDecomposer {
  decompose(goal: string, constraints?: Record<string, any>): Plan {
    const trimmed = goal.trim();
    if (!trimmed) throw new Error('Goal must not be empty.');
    const planId = trimmed.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 40) || 'plan';
    const steps = this.extractSteps(trimmed);
    const nodes: PlanNode[] = [];
    steps.forEach((step, i) => {
      nodes.push(new PlanNode(`step-${i + 1}`, 'task', step, i > 0 ? [`step-${i}`] : []));
    });
    return new Plan(planId, trimmed, nodes, { constraints: constraints ?? {} });
  }

  toWorkflow(plan: Plan): Plan {
    return plan;
  }

  private extractSteps(goal: string): string[] {
    const verbs = goal.match(/\b([A-Z][a-z]+)\b/g) ?? [];
    if (!verbs.length) return [goal];
    return verbs;
  }
}

export interface PlannerScore {
  node_count: number;
  depth: number;
  risk: number;
  confidence: string;
  complexity: number;
  composite: number;
}

export interface RankedPlan {
  plan: Plan;
  score: PlannerScore;
  rank: number;
}

export class Planner {
  constructor(private estimator?: any) {}

  rank(plans: Plan[]): RankedPlan[] {
    const scored = plans.map((plan) => ({
      plan,
      score: this.score(plan),
      rank: 0 as number,
    }));
    scored.sort((a, b) => b.score.composite - a.score.composite);
    scored.forEach((entry, i) => { entry.rank = i + 1; });
    return scored;
  }

  score(plan: Plan): PlannerScore {
    const nodeCount = plan.nodes.length;
    const depth = this.maxDepth(plan);
    let risk = 0.5;
    let confidence = 'low';
    if (this.estimator) {
      try {
        const pred = this.estimator.estimate(plan.plan_id);
        risk = pred.failure_risk ?? 0.5;
        confidence = pred.confidence ?? 'low';
      } catch {
        risk = 0.5;
        confidence = 'low';
      }
    }
    const complexity = nodeCount * 0.1 + depth * 0.2;
    const composite = Math.max(0, 1 - risk - complexity * 0.1);
    return { node_count: nodeCount, depth, risk, confidence, complexity: round4(complexity), composite: round4(composite) };
  }

  private maxDepth(plan: Plan): number {
    if (!plan.nodes.length) return 0;
    const depths: Record<string, number> = {};
    plan.nodes.forEach((n) => { depths[n.id] = 1; });
    for (const n of plan.nodes) {
      for (const dep of n.depends_on) {
        if (dep in depths) {
          depths[n.id] = Math.max(depths[n.id], depths[dep] + 1);
        }
      }
    }
    return Math.max(...Object.values(depths));
  }
}

export class Reflector {
  constructor(private events: any[] = []) {}

  reflect(runId: string): Lesson[] {
    const lessons: Lesson[] = [];
    lessons.push(...this.detectFailurePatterns(runId));
    lessons.push(...this.detectInefficiencies(runId));
    lessons.push(...this.detectHandoffPatterns(runId));
    return lessons;
  }

  private detectFailurePatterns(runId: string): Lesson[] {
    const lessons: Lesson[] = [];
    const failures = this.events.filter((e) => e.type === 'task_status' && e.status === '[!]' && e.task_id);
    const tasks: Record<string, number> = {};
    for (const e of failures) {
      tasks[e.task_id] = (tasks[e.task_id] || 0) + 1;
    }
    for (const [tid, count] of Object.entries(tasks)) {
      if (count >= 2) {
        lessons.push(new Lesson(
          `lesson-${lessons.length + 1}`,
          runId,
          `Task '${tid}' failed ${count} times; consider retry or fallback strategy.`,
          'warn',
          ['failure', tid],
        ));
      }
    }
    return lessons;
  }

  private detectInefficiencies(runId: string): Lesson[] {
    const lessons: Lesson[] = [];
    const claims: Record<string, number> = {};
    for (const e of this.events) {
      if (e.type === 'task_claim' && e.task_id) {
        claims[e.task_id] = (claims[e.task_id] || 0) + 1;
      }
    }
    for (const [tid, count] of Object.entries(claims)) {
      if (count >= 3) {
        lessons.push(new Lesson(
          `lesson-${lessons.length + 1}`,
          runId,
          `Task '${tid}' was claimed ${count} times; review ownership logic.`,
          'info',
          ['efficiency', tid],
        ));
      }
    }
    return lessons;
  }

  private detectHandoffPatterns(runId: string): Lesson[] {
    const lessons: Lesson[] = [];
    const handoffs = this.events.filter((e) => e.type === 'human_handoff' || e.status === '[?]');
    if (handoffs.length > 1) {
      lessons.push(new Lesson(
        `lesson-${lessons.length + 1}`,
        runId,
        `Run had ${handoffs.length} human handoffs; consider automating or simplifying decision gates.`,
        'warn',
        ['handoff'],
      ));
    }
    return lessons;
  }
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
