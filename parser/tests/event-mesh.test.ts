import { describe, it, expect, vi } from 'vitest';
import { EventMeshEngine } from '../src/event-mesh';

describe('EventMeshEngine (v35.0.0)', () => {
  it('publishes and subscribes to topic events', () => {
    const engine = new EventMeshEngine();
    const handler = vi.fn();

    engine.subscribe('agent.tasks', handler);
    const event = engine.publish('e1', 'agent.tasks', 'agent-alpha', 'Task 1 updated', 'task_update');

    expect(event.id).toBe('e1');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'agent.tasks',
      senderAgent: 'agent-alpha',
      payload: 'Task 1 updated',
    }));
  });

  it('receives events via wildcard subscriber', () => {
    const engine = new EventMeshEngine();
    const wildcardHandler = vi.fn();

    engine.subscribe('*', wildcardHandler);
    engine.publish('e2', 'system.alerts', 'guard-agent', 'High memory usage', 'alert');

    expect(wildcardHandler).toHaveBeenCalledTimes(1);
    expect(engine.getEventHistory().length).toBe(1);
  });

  it('filters event history by topic', () => {
    const engine = new EventMeshEngine();
    engine.publish('e1', 'topic.a', 'agent-1', 'msg1');
    engine.publish('e2', 'topic.b', 'agent-2', 'msg2');

    const historyA = engine.getEventHistory('topic.a');
    expect(historyA.length).toBe(1);
    expect(historyA[0].id).toBe('e1');
  });
});
