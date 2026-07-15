import { describe, it, expect } from 'vitest';
import { AlpGraph } from '../src/index';

describe('AlpGraph - Topological Sort', () => {
  it('should correctly sort a valid DAG', () => {
    const graph = new AlpGraph();
    const objects = [
      { _type: 'task', id: 'task-a', depends_on: ['-> task-b'] },
      { _type: 'task', id: 'task-b' }
    ];
    
    graph.buildGraph(objects);
    const sorted = graph.topologicalSort();
    
    // task-b has no dependencies, it should run first
    expect(sorted[0].id).toBe('task-b');
    expect(sorted[1].id).toBe('task-a');
  });

  it('should detect cycles and throw ValidationError', () => {
    const graph = new AlpGraph();
    const objects = [
      { _type: 'task', id: 'task-1', depends_on: ['-> task-2'] },
      { _type: 'task', id: 'task-2', depends_on: ['-> task-1'] }
    ];
    
    graph.buildGraph(objects);
    
    expect(() => graph.detectCycles()).toThrow(/Dependency cycle detected/);
  });
});
