import { describe, it, expect } from 'vitest';
import { MacroEngine, MacroDefinition } from '../src/macro';

describe('MacroEngine (v37.0.0)', () => {
  it('expands a macro iterating over a list of items', () => {
    const engine = new MacroEngine();
    const macro: MacroDefinition = {
      id: 'gen-tasks',
      iterate_over: "['auth', 'billing', 'notifications']",
      as: 'svc',
      template: {
        _type: 'task',
        id: 'task-deploy-${svc}',
        name: 'Deploy ${svc} service',
        owner: 'agent-devops',
      },
    };

    const expanded = engine.expand(macro);
    expect(expanded.length).toBe(3);
    expect(expanded[0].id).toBe('task-deploy-auth');
    expect(expanded[0].name).toBe('Deploy auth service');
    expect(expanded[1].id).toBe('task-deploy-billing');
    expect(expanded[2].id).toBe('task-deploy-notifications');
  });

  it('interpolates nested property paths', () => {
    const engine = new MacroEngine();
    const macro: MacroDefinition = {
      id: 'gen-features',
      iterate_over: "[{'name': 'auth', 'tag': 'sec'}, {'name': 'db', 'tag': 'data'}]",
      as: 'item',
      template: {
        _type: 'feature',
        id: 'feat-${item.name}',
        category: '${item.tag}',
      },
    };

    const expanded = engine.expand(macro);
    expect(expanded.length).toBe(2);
    expect(expanded[0].id).toBe('feat-auth');
    expect(expanded[0].category).toBe('sec');
    expect(expanded[1].id).toBe('feat-db');
    expect(expanded[1].category).toBe('data');
  });

  it('expandAll replaces macro blocks in object list with expanded objects', () => {
    const engine = new MacroEngine();
    const objects = [
      { _type: 'agent', id: 'agent-1' },
      {
        _type: 'macro',
        id: 'm1',
        iterate_over: "['x', 'y']",
        as: 'var',
        template: { _type: 'task', id: 't-${var}' },
      },
    ];

    const result = engine.expandAll(objects);
    expect(result.length).toBe(3);
    expect(result[0]._type).toBe('agent');
    expect(result[1].id).toBe('t-x');
    expect(result[2].id).toBe('t-y');
  });

  it('throws on missing required fields', () => {
    const engine = new MacroEngine();
    expect(() => engine.expand({ id: 'bad' } as any)).toThrow('missing iterate_over');
  });
});
