import { describe, it, expect } from 'vitest';
import { SelfHealingEngine } from '../src/self-healing';

describe('SelfHealingEngine (v22.0.0)', () => {
  it('diagnoses empty status fields', () => {
    const engine = new SelfHealingEngine();
    const content = `@task\n  id: t1\n  status: `;
    const diags = engine.diagnose(content);

    expect(diags.some((d) => d.message.includes('Empty status field'))).toBe(true);
  });

  it('generates and applies auto-heal patches for empty status', () => {
    const engine = new SelfHealingEngine();
    const content = `@task\n  id: t1\n  status: `;
    const patches = engine.generatePatches(content);
    const healed = engine.applyPatches(content, patches);

    expect(healed).toContain('status: [ ]');
  });

  it('returns no diagnostics for valid content', () => {
    const engine = new SelfHealingEngine();
    const content = `@task\n  id: t1\n  status: [x]`;
    const diags = engine.diagnose(content);
    const statusDiags = diags.filter((d) => d.message.includes('Empty status'));

    expect(statusDiags.length).toBe(0);
  });
});
