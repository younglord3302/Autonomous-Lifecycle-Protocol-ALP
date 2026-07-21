import { describe, it, expect } from 'vitest';
import { evaluate, evaluateBool, interpolate, buildContext, registerModule } from '../src/alpel';
import { AlpParser } from '../src/index';

describe('ALPEL (v10.3.0, spec/12)', () => {
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

  it('calls date namespace functions', () => {
    const now = evaluate("date.now()", {}) as string;
    expect(typeof now).toBe('string');
    expect(now).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const iso = evaluate("date.formatDate('2024-01-15T10:30:00Z', 'iso')", {}) as string;
    expect(iso).toBe('2024-01-15T10:30:00Z');

    const dateStr = evaluate("date.formatDate('2024-01-15T10:30:00Z', 'date')", {}) as string;
    expect(dateStr).toBe('2024-01-15');

    const timeStr = evaluate("date.formatDate('2024-01-15T10:30:00Z', 'time')", {}) as string;
    expect(timeStr).toBe('10:30:00');

    const parsed = evaluate("date.parseDate('2024-01-15T10:30:00Z')", {}) as string;
    expect(parsed).toBe('2024-01-15T10:30:00+00:00');

    const added = evaluate("date.addDays('2024-01-15T10:30:00Z', 5)", {}) as string;
    expect(added).toBe('2024-01-20T10:30:00+00:00');
  });

  it('calls math namespace functions', () => {
    expect(evaluate("math.round(3.7)", {})).toBe(4);
    expect(evaluate("math.floor(3.7)", {})).toBe(3);
    expect(evaluate("math.ceil(3.1)", {})).toBe(4);
    expect(evaluate("math.min(3, 7)", {})).toBe(3);
    expect(evaluate("math.max(3, 7)", {})).toBe(7);
    expect(evaluate("math.abs(-5)", {})).toBe(5);
  });

  it('calls crypto namespace functions', () => {
    const hash = evaluate("crypto.sha256('hello')", {}) as string;
    expect(typeof hash).toBe('string');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);

    const encoded = evaluate("crypto.base64('hello')", {}) as string;
    expect(encoded).toBe('aGVsbG8=');

    const decoded = evaluate("crypto.base64Decode('aGVsbG8=')", {}) as string;
    expect(decoded).toBe('hello');
  });

  it('calls string namespace functions', () => {
    expect(evaluate("string.trim('  hi  ')", {})).toBe('hi');
    expect(evaluate("string.replace('hello world', 'world', 'universe')", {})).toBe('hello universe');
    expect(evaluate("string.split('a,b,c', ',')", {})).toEqual(['a', 'b', 'c']);
    expect(evaluate("string.join(['a', 'b'], '-')", {})).toBe('a-b');
    expect(evaluate("string.endsWith('file.txt', 'txt')", {})).toBe(true);
    expect(evaluate("string.endsWith('file.txt', 'csv')", {})).toBe(false);
    expect(evaluate("string.endsWith('file.txt', '')", {})).toBe(true);
  });

  it('imports shared ALPEL modules (v10.3.0)', () => {
    registerModule('helpers', { VERSION: '1.2.3', GREETING: 'hi', POINTS: [1, 2, 3] } as any);
    expect(evaluate("import('helpers').VERSION", {})).toBe('1.2.3');
    expect(evaluate("import('helpers').POINTS.size", {})).toBe(3);
    expect(evaluateBool("string.endsWith(import('helpers').GREETING, 'i')", {})).toBe(true);
    expect(() => evaluate("import('missing').x", {})).toThrow(/not registered/);
  });

  it('supports namespace syntax with property access', () => {
    expect(evaluateBool("math.max(1, 2) > math.min(1, 2)", {})).toBe(true);
    expect(evaluate("string.trim(string.trim('  x  '))", {})).toBe('x');
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
