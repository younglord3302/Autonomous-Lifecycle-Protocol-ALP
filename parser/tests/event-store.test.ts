import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventStore } from '../src/index';
import { WorkflowVisualizer } from '../src/index';

describe('EventStore (v10.1.0)', () => {
  function tmpStore(): { store: EventStore; dir: string; cleanup: () => void } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alp-events-'));
    const alpDir = path.join(dir, '.alp');
    fs.mkdirSync(alpDir, { recursive: true });
    return { store: new EventStore(alpDir), dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
  }

  it('appends and reads back events', () => {
    const { store, cleanup } = tmpStore();
    try {
      store.append('object_created', { object_id: 'task-1', type: 'task' });
      store.append('status_changed', { object_id: 'task-1', status: '[x]' });
      const events = store.readAll();
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('object_created');
      expect(events[1].type).toBe('status_changed');
      expect(events[0].schemaVersion).toBe(1);
    } finally {
      cleanup();
    }
  });

  it('replays events filtered by type', () => {
    const { store, cleanup } = tmpStore();
    try {
      store.append('object_created', { object_id: 'task-1' });
      store.append('status_changed', { object_id: 'task-1' });
      store.append('file_mutated', { object_id: 'task-2' });
      const r = store.replay({ types: ['status_changed', 'object_created'] });
      expect(r.applied).toBe(2);
      expect(r.skipped).toBe(1);
    } finally {
      cleanup();
    }
  });

  it('replays events filtered by object_id', () => {
    const { store, cleanup } = tmpStore();
    try {
      store.append('object_created', { object_id: 'task-1' });
      store.append('status_changed', { object_id: 'task-2' });
      const r = store.replay({ objectId: 'task-1' });
      expect(r.applied).toBe(1);
      expect(r.events[0].payload['object_id']).toBe('task-1');
    } finally {
      cleanup();
    }
  });
});

describe('WorkflowVisualizer (v10.2.0)', () => {
  const obj = (id: string) => ({
    _type: 'workflow',
    id,
    name: `Workflow ${id}`,
    steps: [
      { name: 'Step A', task: '-> task-a', agent: '-> agent-x' },
      { name: 'Step B', task: '-> task-b', parallel_group: 'impl' },
      { name: 'Step C', task: '-> task-c', parallel_group: 'impl' },
      { name: 'Step D', wait_for: 'impl' },
    ],
  });

  it('parses @workflow objects', () => {
    const v = new WorkflowVisualizer();
    const wfs = v.parseWorkflows([obj('wf-1'), { _type: 'task', id: 't1' }]);
    expect(wfs).toHaveLength(1);
    expect(wfs[0].steps).toHaveLength(4);
    expect(wfs[0].steps[0].task).toBe('-> task-a');
  });

  it('renders a mermaid flowchart', () => {
    const v = new WorkflowVisualizer();
    const out = v.toMermaid(v.parseWorkflows([obj('wf-1')]));
    expect(out).toContain('flowchart TD');
    expect(out).toContain('subgraph');
    expect(out).toContain('grp_impl');
  });

  it('renders a graphviz dot diagram', () => {
    const v = new WorkflowVisualizer();
    const out = v.toDot(v.parseWorkflows([obj('wf-1')]));
    expect(out).toContain('digraph ALP');
    expect(out).toContain('cluster_');
  });

  it('renders structured json', () => {
    const v = new WorkflowVisualizer();
    const out = v.toJson(v.parseWorkflows([obj('wf-1')]));
    expect(out).toContain('"id": "wf-1"');
    expect(out).toContain('"steps"');
  });
});
