import { describe, it, expect } from 'vitest';
import { updateObjectStatus } from '../src/index';

describe('updateObjectStatus (v6.3.0)', () => {
  it('updates an unquoted status line', () => {
    const input = `@task\n  id: t1\n  status: [ ]\n`;
    const { content, changed } = updateObjectStatus(input, 't1', '[x]');
    expect(changed).toBe(true);
    expect(content).toContain('status: [x]');
    expect(content).not.toContain('status: [ ]');
  });

  it('updates a quoted status line and preserves quoting', () => {
    const input = `@task\n  id: t1\n  status: "[~]"\n`;
    const { content, changed } = updateObjectStatus(input, 't1', '[?]');
    expect(changed).toBe(true);
    expect(content).toContain('status: "[?]"');
  });

  it('correctly handles the Human-in-the-Loop [?] marker', () => {
    const input = `@task\n  id: t1\n  status: "[x]"\n`;
    const { content } = updateObjectStatus(input, 't1', '[?]');
    // Must not truncate at the first ] — full marker must be written.
    expect(content).toContain('status: "[?]"');
    expect(content).not.toContain('status: "[?"');
  });

  it('only touches the block whose id matches', () => {
    const input = `@task\n  id: t1\n  status: [ ]\n\n@task\n  id: t2\n  status: [ ]\n`;
    const { content } = updateObjectStatus(input, 't2', '[x]');
    expect(content).toContain('id: t1\n  status: [ ]');
    expect(content).toContain('id: t2\n  status: [x]');
  });

  it('reports unchanged when the id is absent', () => {
    const input = `@task\n  id: t1\n  status: [ ]\n`;
    const { content, changed } = updateObjectStatus(input, 'nope', '[x]');
    expect(changed).toBe(false);
    expect(content).toBe(input);
  });

  it('updates nested quoted status without disturbing sibling blocks', () => {
    const input = `@task\n  id: t1\n  status: "[ ]"\n\n@feature\n  id: f1\n  status: [~]\n`;
    const { content } = updateObjectStatus(input, 't1', '[x]');
    expect(content).toContain('status: "[x]"');
    expect(content).toContain('status: [~]');
  });
});
