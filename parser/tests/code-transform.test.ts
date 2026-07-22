import { describe, it, expect } from 'vitest';
import { CodeTransformEngine } from '../src/code-transform';

describe('CodeTransformEngine (v34.0.0)', () => {
  it('renames symbol across source code', () => {
    const engine = new CodeTransformEngine();
    const source = 'function processItem(item) { return item * 2; }';
    const result = engine.applyTransform('t1', 'rename_symbol', 'src/math.js', source, 'processItem', 'computeItem');

    expect(result.id).toBe('t1');
    expect(result.status).toBe('applied');
    expect(result.transformedCode).toContain('computeItem');
    expect(result.transformedCode).not.toContain('processItem');
  });

  it('adds log guard wrapper around code', () => {
    const engine = new CodeTransformEngine();
    const source = 'const x = 10;';
    const result = engine.applyTransform('t2', 'add_log_guard', 'src/app.js', source);

    expect(result.transformedCode).toContain('[ALP Guarded Execution]');
    expect(result.transformedCode).toContain('catch (err)');
  });

  it('supports revert operation', () => {
    const engine = new CodeTransformEngine();
    const source = 'var oldVar = 1;';
    const result = engine.applyTransform('t3', 'migration_rewrite', 'src/legacy.js', source);

    expect(result.transformedCode).toContain('let oldVar');
    const reverted = engine.revertTransform('t3');
    expect(reverted?.status).toBe('reverted');
    expect(reverted?.transformedCode).toBe(source);
  });
});
