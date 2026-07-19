import { describe, it, expect } from 'vitest';
import { evaluate, evaluateBool, interpolate, buildContext } from '../src/alpel';
import { AlpParser } from '../src/index';

describe('ALPEL (v6.6.0, spec/12)', () => {
  it('evaluates comparison + logical operators', () => {
    expect(evaluateBool("1 < 2 && 3 >= 3", {})).toBe(true);
    expect(evaluateBool("'a' == 'b' || 2 != 3", {})).toBe(true);
    expect(evaluateBool("!(1 > 2)", {})).toBe(true);
    expect(evaluateBool("5 < 3", {})).toBe(false);
  });

  it('evaluates math operators', () => {
    expect(evaluate("2 + 3 * 4", {})).toBe(14);
    expect(evaluate("10 / 2 - 1", {})).toBe(4);
    expect(evaluate("'a' + 'b'", {})).toBe('ab');
  });

  it('resolves property access with dot + bracket', () => {
    const ctx = { task: { feature: { name: 'auth' } } as any };
    expect(evaluate("task.feature.name", ctx)).toBe('auth');
    expect(evaluate("task['feature']['name']", ctx)).toBe('auth');
  });

  it('supports in / contains collections', () => {
    expect(evaluateBool("'b' in ['a', 'b', 'c']", {})).toBe(true);
    expect(evaluateBool("['a', 'b'].contains('c')", {})).toBe(false);
    expect(evaluateBool("'hello world'.startsWith('hello')", {})).toBe(true);
  });

  it('calls built-in functions', () => {
    expect(evaluate("length('abcd')", {})).toBe(4);
    expect(evaluate("toUpper('abc')", {})).toBe('ABC');
    expect(evaluate("size([1, 2, 3])", {})).toBe(3);
    expect(evaluateBool("isEmpty([])", {})).toBe(true);
    expect(
      evaluateBool("hasStatus([{ status: '[x]' }], '[x]')", {})
    ).toBe(true);
  });

  it('interpolates ${ } inside strings', () => {
    const ctx = buildContext({ _type: 'project', name: 'Demo', version: '2.0.0' } as any);
    expect(interpolate('dist/build-${ toLower(project.name) }-v${ project.version }.tar.gz', ctx)).toBe(
      'dist/build-demo-v2.0.0.tar.gz'
    );
  });

  it('throws on unknown identifier', () => {
    expect(() => evaluateBool('nope == 1', {})).toThrow(/unknown identifier/);
  });

  it('drives !if / !assert directives in the reader', () => {
    const parser = new AlpParser();
    const ok = parser.parse(`
@task
  id: task-a
  !if: "1 == 1"
  description: "included"

@task
  id: task-b
  !if: "1 == 2"
  description: "skipped"
`);
    const ids = ok.map((o) => o.id);
    expect(ids).toContain('task-a');
    expect(ids).not.toContain('task-b');
  });

  it('throws on a failing !assert', () => {
    const parser = new AlpParser();
    expect(() =>
      parser.parse(`
@task
  id: task-fail
  !assert: "project.state == 'prod'"
`)
    ).toThrow(/!assert failed/);
  });
});
