import { describe, it, expect } from 'vitest';
import { GoalDecomposer, Planner, Reflector, Plan, PlanNode, Lesson } from '../src/planner';

describe('GoalDecomposer', () => {
  it('decomposes a goal into a plan', () => {
    const gd = new GoalDecomposer();
    const plan = gd.decompose('Build and test and deploy');
    expect(plan).toBeInstanceOf(Plan);
    expect(plan.nodes.length).toBeGreaterThanOrEqual(1);
  });

  it('throws on empty goal', () => {
    const gd = new GoalDecomposer();
    expect(() => gd.decompose('')).toThrow('Goal must not be empty.');
  });

  it('round-trips through toWorkflow', () => {
    const gd = new GoalDecomposer();
    const plan = gd.decompose('Ship feature X');
    const wf = gd.toWorkflow(plan);
    expect(wf.plan_id).toBe(plan.plan_id);
    expect(wf.goal).toBe('Ship feature X');
  });
});

describe('Planner', () => {
  const fakeEstimator = {
    estimate: () => ({ failure_risk: 0.1, confidence: 'high' }),
  };

  it('ranks plans by composite score', () => {
    const planner = new Planner();
    const p1 = new Plan('p1', 'Goal A', [new PlanNode('s1', 'task', 'A')]);
    const p2 = new Plan('p2', 'Goal B', [
      new PlanNode('s1', 'task', 'B'),
      new PlanNode('s2', 'task', 'C', ['s1']),
    ]);
    const ranked = planner.rank([p1, p2]);
    expect(ranked.length).toBe(2);
    expect(ranked[0].plan.plan_id).toBe('p1');
  });

  it('uses estimator when provided', () => {
    const planner = new Planner(fakeEstimator);
    const p1 = new Plan('p1', 'Goal A', [new PlanNode('s1', 'task', 'A')]);
    const ranked = planner.rank([p1]);
    expect(ranked[0].rank).toBe(1);
    expect(ranked[0].score.confidence).toBe('high');
  });

  it('score contains expected fields', () => {
    const planner = new Planner();
    const p = new Plan('p1', 'Goal', [new PlanNode('s1', 'task', 'A')]);
    const ranked = planner.rank([p]);
    const score = ranked[0].score;
    expect(score).toHaveProperty('composite');
    expect(score).toHaveProperty('risk');
    expect(score).toHaveProperty('depth');
  });
});

describe('Reflector', () => {
  const events = [
    { type: 'task_status', task_id: 't1', status: '[!]', timestamp: '2026-01-01T00:00:00Z' },
    { type: 'task_status', task_id: 't1', status: '[!]', timestamp: '2026-01-01T00:00:01Z' },
    { type: 'task_claim', task_id: 't1', timestamp: '2026-01-01T00:00:02Z' },
    { type: 'human_handoff', task_id: 't1', status: '[?]', timestamp: '2026-01-01T00:00:03Z' },
    { type: 'human_handoff', task_id: 't2', status: '[?]', timestamp: '2026-01-01T00:00:04Z' },
  ];

  it('detects failure patterns', () => {
    const ref = new Reflector(events);
    const lessons = ref.reflect('run-1');
    const failure = lessons.filter((l) => l.insight.includes('failed'));
    expect(failure.length).toBeGreaterThanOrEqual(1);
  });

  it('detects handoff patterns', () => {
    const ref = new Reflector(events);
    const lessons = ref.reflect('run-1');
    const handoffs = lessons.filter((l) => l.insight.includes('handoffs'));
    expect(handoffs.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty for no events', () => {
    const ref = new Reflector([]);
    expect(ref.reflect('run-1')).toEqual([]);
  });
});
