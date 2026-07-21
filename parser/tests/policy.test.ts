import { describe, it, expect } from 'vitest';
import { AlpParser, PolicyEngine, globToRegExp, FederatedTrustRoot } from '../src/index';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const SRC = `
@policy
  id: policy-safe
  applies_to: "*"
  enforcement: strict
  allow_paths:
    - "src/**"
    - "tests/**"
  deny_paths:
    - ".env"
    - ".alp/**"
  allow_commands:
    - "npm test"
    - "echo"
  deny_commands:
    - "rm -rf"
`;

function engineFrom(src: string): PolicyEngine {
  return new PolicyEngine(new AlpParser().parse(src));
}

describe('globToRegExp', () => {
  it('matches ** across separators and * within a segment', () => {
    expect(globToRegExp('src/**').test('src/auth/login.ts')).toBe(true);
    expect(globToRegExp('src/*.ts').test('src/index.ts')).toBe(true);
    expect(globToRegExp('src/*.ts').test('src/auth/login.ts')).toBe(false);
    expect(globToRegExp('.env').test('.env')).toBe(true);
    expect(globToRegExp('.env').test('.env.local')).toBe(false);
  });
});

describe('PolicyEngine', () => {
  it('allows a path inside allow_paths', () => {
    const d = engineFrom(SRC).evaluate({ kind: 'path', value: 'src/auth/login.ts' });
    expect(d.allowed).toBe(true);
    expect(d.blocked).toBe(false);
  });

  it('blocks an explicitly denied path (deny beats allow)', () => {
    const d = engineFrom(SRC).evaluate({ kind: 'path', value: '.env' });
    expect(d.allowed).toBe(false);
    expect(d.blocked).toBe(true);
    expect(d.policies).toContain('policy-safe');
  });

  it('blocks a path not covered by the allow-list', () => {
    const d = engineFrom(SRC).evaluate({ kind: 'path', value: 'secrets/keys.txt' });
    expect(d.allowed).toBe(false);
    expect(d.blocked).toBe(true);
  });

  it('allows an allowed command prefix', () => {
    const d = engineFrom(SRC).evaluate({ kind: 'command', value: 'npm test -- --watch' });
    expect(d.allowed).toBe(true);
  });

  it('blocks a denied command', () => {
    const d = engineFrom(SRC).evaluate({ kind: 'command', value: 'rm -rf /' });
    expect(d.allowed).toBe(false);
    expect(d.blocked).toBe(true);
  });

  it('warns (does not block) when enforcement is warn', () => {
    const warnSrc = SRC.replace('enforcement: strict', 'enforcement: warn');
    const d = engineFrom(warnSrc).evaluate({ kind: 'command', value: 'rm -rf /' });
    expect(d.allowed).toBe(false);
    expect(d.blocked).toBe(false); // warn mode never hard-blocks
    expect(d.reasons.length).toBeGreaterThan(0);
  });

  it('scopes policies by applies_to agent', () => {
    const scoped = `
@policy
  id: policy-dev-only
  applies_to: -> agent-developer
  enforcement: strict
  deny_commands:
    - "git push"
`;
    const engine = engineFrom(scoped);
    // Governed agent is blocked.
    expect(
      engine.evaluate({ kind: 'command', value: 'git push', agent: 'agent-developer' }).blocked,
    ).toBe(true);
    // A different agent is unaffected.
    expect(
      engine.evaluate({ kind: 'command', value: 'git push', agent: 'agent-planner' }).allowed,
    ).toBe(true);
  });

  it('reports zero policies for a workspace without any', () => {
    expect(engineFrom('@task\n  id: t1\n').count).toBe(0);
  });
});

describe('PolicyEngine v8.1.0', () => {
  const WIN = `
@policy
  id: policy-hours
  applies_to: "*"
  enforcement: strict
  allow_paths:
    - "src/**"
  allow_during:
    - { days: ["monday","tuesday","wednesday","thursday","friday"], start: "09:00", end: "17:00" }
`;

  it('denies an action outside the allowed time window', () => {
    // 2026-07-25 is a Saturday (outside Mon-Fri).
    const sat = new Date(Date.UTC(2026, 6, 25, 14, 0));
    const d = engineFrom(WIN).evaluate({ kind: 'path', value: 'src/main.ts', now: sat });
    expect(d.allowed).toBe(false);
    expect(d.blocked).toBe(true);
  });

  it('allows an action inside the allowed time window', () => {
    // 2026-07-20 is a Monday, 10:30 UTC (inside window).
    const mon = new Date(Date.UTC(2026, 6, 20, 10, 30));
    const d = engineFrom(WIN).evaluate({ kind: 'path', value: 'src/main.ts', now: mon });
    expect(d.allowed).toBe(true);
  });

  it('escalates require_approval instead of blocking', () => {
    const src = `
@policy
  id: policy-approve
  applies_to: "*"
  enforcement: strict
  allow_paths:
    - "src/**"
  require_approval:
    - { kind: "path", value: "src/secrets/**" }
`;
    const d = engineFrom(src).evaluate({ kind: 'path', value: 'src/secrets/key.ts' });
    expect(d.allowed).toBe(true);
    expect(d.blocked).toBe(false);
    expect(d.requiresApproval).toBe(true);
  });

  it('verifies a signed proposal against a trust root', () => {
    const src = `
@policy
  id: policy-props
  applies_to: "*"
  proposals:
    - { id: "prop-1", action: "deploy", agent: "a1", signed_by: "alice", signature: "sig" }
`;
    const engine = engineFrom(src);
    // Untrusted signer -> denied + audited.
    const bad = engine.evaluateProposal('prop-1', { bob: 'key-bob' });
    expect(bad.allowed).toBe(false);
    expect(bad.blocked).toBe(true);
    expect(bad.audit?.proposalId).toBe('prop-1');
    // Trusted signer -> allowed.
    const good = engine.evaluateProposal('prop-1', { alice: 'key-alice' });
    expect(good.allowed).toBe(true);
  });
});

describe('PolicyEngine v10.6.0 Cross-Federation Trust', () => {
  const PARENT_SRC = `
@policy
  id: policy-parent
  applies_to: "*"
  enforcement: strict
  allow_paths:
    - "shared/**"
  deny_paths:
    - "shared/secret"
`;
  const CHILD_SRC = `
@policy
  id: policy-child
  applies_to: "*"
  enforcement: strict
  allow_paths:
    - "child/**"
  deny_paths:
    - "child/secret"
`;

  it('constructs a FederatedTrustRoot with required fields', () => {
    const root: FederatedTrustRoot = {
      namespace: 'ns-a',
      publicKeyPem: '-----BEGIN PUBLIC KEY-----\nABCD\n-----END PUBLIC KEY-----',
      fingerprint: 'aa:bb:cc',
    };
    expect(root.namespace).toBe('ns-a');
    expect(root.publicKeyPem).toContain('BEGIN PUBLIC KEY');
    expect(root.fingerprint).toBe('aa:bb:cc');
  });

  it('bootstrapTrust returns the provided root when the file does not exist', () => {
    const root: FederatedTrustRoot = {
      namespace: 'ns-b',
      publicKeyPem: 'pem-b',
      fingerprint: 'ff-b',
    };
    const result = PolicyEngine.bootstrapTrust('/nonexistent/path', root);
    expect(result.namespace).toBe('ns-b');
    expect(result.publicKeyPem).toBe('pem-b');
    expect(result.fingerprint).toBe('ff-b');
  });

  it('bootstrapTrust reads and merges from a file when it exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'alp-trust-'));
    const trustDir = join(dir, '.alp', 'trust');
    try {
      const { mkdirSync } = require('fs');
      mkdirSync(trustDir, { recursive: true });
      writeFileSync(join(trustDir, 'root.json'), JSON.stringify({
        namespace: 'ns-file',
        publicKeyPem: 'pem-file',
        fingerprint: 'ff-file',
      }));
      const provided: FederatedTrustRoot = {
        namespace: 'ns-provided',
        publicKeyPem: 'pem-provided',
        fingerprint: 'ff-provided',
      };
      const result = PolicyEngine.bootstrapTrust(dir, provided);
      expect(result.namespace).toBe('ns-file');
      expect(result.publicKeyPem).toBe('pem-file');
      expect(result.fingerprint).toBe('ff-file');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('inheritedPolicies merges parent and child policies', () => {
    const parent = engineFrom(PARENT_SRC);
    const child = engineFrom(CHILD_SRC);
    const merged = PolicyEngine.inheritedPolicies(parent, child);
    const ids = merged.map((p) => p.id);
    expect(ids).toContain('policy-parent');
    expect(ids).toContain('policy-child');
    expect(merged.length).toBe(2);
  });

  it('inheritedPolicies child policies override parent policies with the same id', () => {
    const overrideSrc = `
@policy
  id: policy-parent
  applies_to: "*"
  enforcement: strict
  allow_paths:
    - "child-only/**"
`;
    const parent = engineFrom(PARENT_SRC);
    const child = engineFrom(overrideSrc);
    const merged = PolicyEngine.inheritedPolicies(parent, child);
    const ids = merged.map((p) => p.id);
    expect(ids).toContain('policy-parent');
    expect(merged.length).toBe(1);
    const parentPolicy = merged.find((p) => p.id === 'policy-parent');
    expect(parentPolicy?.allow_paths).toContain('child-only/**');
  });

  it('crossFederationEvaluate with empty trust roots returns the base decision', () => {
    const engine = engineFrom(SRC);
    const d = engine.crossFederationEvaluate({ kind: 'path', value: 'src/auth/login.ts' }, []);
    expect(d.allowed).toBe(true);
    expect(d.blocked).toBe(false);
    expect(d.reasons.length).toBe(0);
  });

  it('crossFederationEvaluate prefixes reasons with namespace', () => {
    const engine = engineFrom(SRC);
    const roots: FederatedTrustRoot[] = [
      { namespace: 'ns-a', publicKeyPem: 'pem-a', fingerprint: 'ff-a' },
      { namespace: 'ns-b', publicKeyPem: 'pem-b', fingerprint: 'ff-b' },
    ];
    const d = engine.crossFederationEvaluate({ kind: 'path', value: '.env' }, roots);
    expect(d.allowed).toBe(false);
    expect(d.reasons.length).toBeGreaterThan(0);
    expect(d.reasons.every((r) => r.startsWith('[ns-a,ns-b]'))).toBe(true);
  });

  it('crossFederationEvaluate prefixes policies with namespace', () => {
    const engine = engineFrom(SRC);
    const roots: FederatedTrustRoot[] = [
      { namespace: 'ns-x', publicKeyPem: 'pem-x', fingerprint: 'ff-x' },
    ];
    const d = engine.crossFederationEvaluate({ kind: 'path', value: '.env' }, roots);
    expect(d.policies.length).toBeGreaterThan(0);
    expect(d.policies.every((p) => p.startsWith('[ns-x]'))).toBe(true);
  });

  it('crossFederationEvaluate preserves base audit fields', () => {
    const engine = engineFrom(SRC);
    const roots: FederatedTrustRoot[] = [
      { namespace: 'ns-a', publicKeyPem: 'pem-a', fingerprint: 'ff-a' },
    ];
    const d = engine.crossFederationEvaluate({ kind: 'path', value: '.env', agent: 'agent-1' }, roots);
    expect(d.audit?.agent).toBe('agent-1');
    expect(d.audit?.decision).toBe('block');
    expect(typeof d.audit?.timestamp).toBe('string');
  });
});
