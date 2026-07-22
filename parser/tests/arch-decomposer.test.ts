import { describe, it, expect } from 'vitest';
import { ArchDecomposerEngine } from '../src/arch-decomposer';

describe('ArchDecomposerEngine (v28.0.0)', () => {
  it('analyzes monolith files and groups them into functional modules', () => {
    const engine = new ArchDecomposerEngine();
    const files = [
      'src/auth/login.ts',
      'src/billing/stripe.ts',
      'src/notify/email.ts',
    ];

    const analysis = engine.analyzeMonolith('my-monolith', files);
    expect(analysis.targetPath).toBe('my-monolith');
    expect(analysis.modules.auth).toContain('src/auth/login.ts');
    expect(analysis.modules.billing).toContain('src/billing/stripe.ts');
  });

  it('decomposes monolith analysis into microservices and service boundaries', () => {
    const engine = new ArchDecomposerEngine();
    const analysis = engine.analyzeMonolith('app-monolith', [
      'src/auth/oauth.ts',
      'src/billing/invoice.ts',
    ]);

    const plan = engine.decompose(analysis);
    expect(plan.proposedServices).toContain('service-auth');
    expect(plan.proposedServices).toContain('service-billing');
    expect(plan.serviceBoundaries['service-auth']).toContain('src/auth/oauth.ts');
  });
});
