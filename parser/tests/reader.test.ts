import { describe, it, expect } from 'vitest';
import { AlpParser } from '../src/index';

describe('AlpParser - Reader', () => {
  it('should parse a basic task object correctly', () => {
    const parser = new AlpParser();
    const input = `
@task
  id: my-task
  description: "A simple task"
  status: "[ ]"
  assigned_to: -> agent-1
`;
    const objects = parser.parse(input);
    expect(objects).toHaveLength(1);
    expect(objects[0]._type).toBe('task');
    expect(objects[0].id).toBe('my-task');
    expect(objects[0].description).toBe('A simple task');
    expect(objects[0].status).toBe('[ ]');
    expect(objects[0].assigned_to).toBe('-> agent-1');
  });

  it('should handle lists and arrays correctly', () => {
    const parser = new AlpParser();
    const input = `
@feature
  id: my-feature
  depends_on:
    - -> task-1
    - -> task-2
`;
    const objects = parser.parse(input);
    expect(objects).toHaveLength(1);
    expect(objects[0].depends_on).toEqual(['-> task-1', '-> task-2']);
  });

  it('should throw ValidationError on missing ID if not a generic object', () => {
    const parser = new AlpParser();
    const input = `
@task
  description: "Task without ID"
`;
    expect(() => parser.parseAndValidate(input)).toThrow(/Missing required field: id/);
  });
});
