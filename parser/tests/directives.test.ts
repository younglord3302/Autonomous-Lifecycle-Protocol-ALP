import { describe, it, expect } from 'vitest';
import { AlpParser, DirectiveError } from '../src/index';

describe('AlpParser - Directives (v6.1.0)', () => {
  it('ignores !alp-version without affecting objects', () => {
    const parser = new AlpParser();
    const input = `
!alp-version: 3.0.0

@project
  id: p
`;
    const objects = parser.parse(input);
    expect(objects).toHaveLength(1);
    expect(objects[0].id).toBe('p');
  });

  it('!if false skips the immediately following block', () => {
    const parser = new AlpParser();
    const input = `
!if: false

@task
  id: skipped-task
  description: "should not appear"

@task
  id: kept-task
  description: "should appear"
`;
    const objects = parser.parse(input);
    const ids = objects.map((o) => o.id);
    expect(ids).not.toContain('skipped-task');
    expect(ids).toContain('kept-task');
  });

  it('!if true keeps the following block', () => {
    const parser = new AlpParser();
    const input = `
!if: true

@task
  id: kept-task
`;
    const objects = parser.parse(input);
    expect(objects.map((o) => o.id)).toContain('kept-task');
  });

  it('!if evaluates identifiers from the current object context', () => {
    const parser = new AlpParser();
    const input = `
@project
  id: p
  status: production

!if: status == "production"

@task
  id: prod-only-task
`;
    const objects = parser.parse(input);
    expect(objects.map((o) => o.id)).toContain('prod-only-task');
  });

  it('!assert throws DirectiveError when the expression is false', () => {
    const parser = new AlpParser();
    const input = `
!assert: 1 == 2
`;
    expect(() => parser.parse(input)).toThrow(DirectiveError);
  });

  it('!assert passes when the expression is true', () => {
    const parser = new AlpParser();
    const input = `
!assert: 2 > 1

@task
  id: ok-task
`;
    const objects = parser.parse(input);
    expect(objects.map((o) => o.id)).toContain('ok-task');
  });

  it('!deprecated records a non-fatal warning', () => {
    const parser = new AlpParser();
    const input = `
!deprecated: "Use task-new instead"

@task
  id: legacy-task
`;
    const objects = parser.parse(input);
    expect(objects.map((o) => o.id)).toContain('legacy-task');
    expect(parser.warnings.length).toBeGreaterThan(0);
    expect(parser.warnings[0]).toContain('Use task-new instead');
  });

  it('!import is recognised and emits a warning without failing', () => {
    const parser = new AlpParser();
    const input = `
!import: "plugins/scrum.alp"

@task
  id: ok-task
`;
    const objects = parser.parse(input);
    expect(objects.map((o) => o.id)).toContain('ok-task');
    expect(parser.warnings.some((w) => w.includes('!import'))).toBe(true);
  });
});
