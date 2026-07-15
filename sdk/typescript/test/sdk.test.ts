import { describe, it, expect } from 'vitest';
import { AlpWorkspace } from '../src/index';

describe('@alp/sdk — AlpWorkspace', () => {
  const workspace = new AlpWorkspace();
  workspace.load('examples/todo-app');

  it('should load all .alp objects (including nested feature files)', () => {
    expect(workspace.objects.length).toBeGreaterThan(0);
    expect(workspace.findById('todo-app')).toBeDefined();
    // Nested files (features/, worklows/) must be discovered too.
    expect(workspace.findById('feat-user-auth')).toBeDefined();
  });

  it('should build a dependency graph with no cycles', () => {
    const order = workspace.getExecutionOrder();
    expect(order.length).toBe(workspace.objects.length);
  });

  it('should topologically order dependencies before dependents', () => {
    const order = workspace.getExecutionOrder().map((n) => n.id);
    // feat-task-management depends_on feat-user-auth, so the dependency
    // (feat-user-auth) must appear before its dependent (feat-task-management).
    const depIdx = order.indexOf('feat-user-auth');
    const dependentIdx = order.indexOf('feat-task-management');
    expect(depIdx).toBeGreaterThanOrEqual(0);
    expect(dependentIdx).toBeGreaterThanOrEqual(0);
    expect(depIdx).toBeLessThan(dependentIdx);
  });
});
