import { describe, it, expect } from 'vitest';
import { AlpParser, ContractEngine, ContractResult } from '../src/index';

function engineFrom(src: string): ContractEngine {
  return new ContractEngine(new AlpParser().parse(src));
}

describe('ContractEngine (v8.3.0)', () => {
  const baseContract = `
@contract
  id: contract-api
  from: -> agent-frontend
  to: -> agent-backend
  type: api
  allows:
    - api.v1.users.read
    - api.v1.orders.read
  denies:
    - api.v1.admin.*
  on_violation: deny
`;

  it('allows an operation in the allow-list', () => {
    const engine = engineFrom(baseContract);
    const result = engine.check('contract-api', { operation: 'api.v1.users.read' });
    expect(result.ok).toBe(true);
  });

  it('denies an operation in the deny-list', () => {
    const engine = engineFrom(baseContract);
    const result = engine.check('contract-api', { operation: 'api.v1.admin.secrets' });
    expect(result.ok).toBe(false);
    expect(result.violation?.reason).toBe('denied');
  });

  it('blocks an operation not in the allow-list when allows is non-empty', () => {
    const engine = engineFrom(baseContract);
    const result = engine.check('contract-api', { operation: 'api.v2.metrics.write' });
    expect(result.ok).toBe(false);
    expect(result.violation?.reason).toBe('not in allow-list');
  });

  it('enforces a requires condition', () => {
    const src = `
@contract
  id: contract-auth
  requires:
    - auth.token valid
  allows:
    - any
`;
    const engine = engineFrom(src);
    const missing = engine.check('contract-auth', { operation: 'any', auth: {} });
    expect(missing.ok).toBe(false);
    expect(missing.violation?.reason).toBe('required condition not met');
    const present = engine.check('contract-auth', { operation: 'any', auth: { token: 'valid' } });
    expect(present.ok).toBe(true);
  });

  it('enforces a numeric requires condition', () => {
    const src = `
@contract
  id: contract-rate
  requires:
    - rate_limit < 100
  allows:
    - any
`;
    const engine = engineFrom(src);
    expect(engine.check('contract-rate', { operation: 'any', rate_limit: 50 }).ok).toBe(true);
    expect(engine.check('contract-rate', { operation: 'any', rate_limit: 200 }).ok).toBe(false);
  });

  it('returns a violation for an unknown contract id', () => {
    const engine = engineFrom(baseContract);
    const result = engine.check('does-not-exist', { operation: 'any' });
    expect(result.ok).toBe(false);
    expect(result.violation?.rule).toBe('');
  });

  it('warn mode allows the operation to proceed', () => {
    const src = `
@contract
  id: contract-warn
  denies:
    - bad.op
  on_violation: warn
`;
    const engine = engineFrom(src);
    const result = engine.check('contract-warn', { operation: 'bad.op' });
    expect(result.ok).toBe(true);
  });

  it('matches glob deny patterns', () => {
    const engine = engineFrom(baseContract);
    expect(engine.check('contract-api', { operation: 'api.v1.admin.config' }).ok).toBe(false);
    expect(engine.check('contract-api', { operation: 'api.v1.users.read' }).ok).toBe(true);
  });

  it('lists all contracts', () => {
    const src = `
@contract
  id: c1
  from: -> a
  to: -> b
@contract
  id: c2
  from: -> c
  to: -> d
`;
    const engine = engineFrom(src);
    expect(engine.list().map((c) => c.id)).toEqual(['c1', 'c2']);
  });
});
