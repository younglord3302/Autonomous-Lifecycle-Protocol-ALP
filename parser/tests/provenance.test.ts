import { describe, it, expect } from 'vitest';
import { TraceSigner, ProvenanceStore, AuditLedger } from '../src/provenance';
import { ZKPolicyProof, ComplianceCertifier } from '../src/formal';

describe('TraceSigner', () => {
  it('seals an event with an envelope', () => {
    const signer = new TraceSigner();
    const sealed = signer.seal({ task_id: 't1', status: '[x]' }, 'agent-1');
    expect(sealed._sealed).toBeDefined();
    expect(sealed._sealed.recipient).toBe('agent-1');
    expect(sealed._sealed.digest).toBeDefined();
  });

  it('verifies a valid seal', () => {
    const signer = new TraceSigner();
    const sealed = signer.seal({ task_id: 't1' }, 'agent-1');
    expect(signer.verify(sealed)).toBe(true);
  });

  it('rejects a tampered seal', () => {
    const signer = new TraceSigner();
    const sealed = signer.seal({ task_id: 't1' }, 'agent-1');
    sealed.task_id = 't2';
    expect(signer.verify(sealed)).toBe(false);
  });
});

describe('ProvenanceStore', () => {
  it('chains traces via parent hash', () => {
    const store = new ProvenanceStore();
    const t1 = store.addTrace({ trace_id: 'run-1', step: 1 });
    const t2 = store.addTrace({ trace_id: 'run-1', step: 2 });
    expect(t1._parent).toBe('genesis');
    expect(t2._parent).toBe(t1._hash);
  });

  it('verifies a valid chain', () => {
    const store = new ProvenanceStore();
    store.addTrace({ trace_id: 'run-1', step: 1 });
    store.addTrace({ trace_id: 'run-1', step: 2 });
    expect(store.verifyChain()).toBe(true);
  });

  it('filters lineage by trace_id', () => {
    const store = new ProvenanceStore();
    store.addTrace({ trace_id: 'run-1', step: 1 });
    store.addTrace({ trace_id: 'run-2', step: 1 });
    const lineage = store.lineage('run-1');
    expect(lineage.length).toBe(1);
    expect(lineage[0].trace_id).toBe('run-1');
  });
});

describe('AuditLedger', () => {
  it('appends an indexed entry', () => {
    const ledger = new AuditLedger();
    const entry = ledger.append({ action: 'deploy', agent: 'ci-bot' });
    expect(entry._index).toBe(0);
    expect(entry._prev).toBe('genesis');
    expect(entry._hash).toBeDefined();
  });

  it('verifies a valid chain', () => {
    const ledger = new AuditLedger();
    ledger.append({ a: 1 });
    ledger.append({ a: 2 });
    expect(ledger.verify()).toBe(true);
  });

  it('returns the last n entries', () => {
    const ledger = new AuditLedger();
    for (let i = 0; i < 5; i++) ledger.append({ i });
    const tail = ledger.tail(2);
    expect(tail.length).toBe(2);
    expect(tail[0].i).toBe(3);
    expect(tail[1].i).toBe(4);
  });
});

describe('ZKPolicyProof', () => {
  it('generates proof data', () => {
    const proof = new ZKPolicyProof('policy-1', 'read');
    const data = proof.generate({ secret: 'value' });
    expect(data.policy_id).toBe('policy-1');
    expect(data.action).toBe('read');
    expect(data.witness_hash).toBeDefined();
  });

  it('verifies a valid proof', () => {
    const proof = new ZKPolicyProof('policy-1', 'read');
    proof.generate({ secret: 'value' });
    expect(proof.verify()).toBe(true);
  });

  it('rejects empty proof', () => {
    const proof = new ZKPolicyProof('policy-1', 'read');
    expect(proof.verify()).toBe(false);
  });

  it('verifies against matching trust root', () => {
    const proof = new ZKPolicyProof('policy-1', 'read');
    proof.generate({ secret: 'value' });
    expect(proof.verify({ namespace: 'policy-1' })).toBe(true);
    expect(proof.verify({ namespace: 'other' })).toBe(false);
  });

  it('marks verified after verification', () => {
    const proof = new ZKPolicyProof('policy-1', 'read');
    proof.generate({ secret: 'value' });
    proof.verify();
    const json = proof.toJSON();
    expect(json.verified).toBe(true);
    expect(json.verified_at).toBeDefined();
  });
});

describe('ComplianceCertifier', () => {
  it('certifies a passing run', () => {
    const certifier = new ComplianceCertifier();
    const results = [{ check: 'a', passed: true }, { check: 'b', passed: true }];
    const bundle = certifier.certify('run-1', 'default', results);
    expect(bundle.passed).toBe(true);
    expect(bundle.profile).toBe('default');
    expect(bundle.issued_at).toBeDefined();
  });

  it('certifies a failing run', () => {
    const certifier = new ComplianceCertifier();
    const results = [{ check: 'a', passed: true }, { check: 'b', passed: false }];
    const bundle = certifier.certify('run-1', 'default', results);
    expect(bundle.passed).toBe(false);
  });

  it('signs bundle when trust root provided', () => {
    const certifier = new ComplianceCertifier({ namespace: 'root-1' });
    const results = [{ check: 'a', passed: true }];
    const bundle = certifier.certify('run-1', 'default', results);
    expect(bundle.signature).toBeDefined();
    expect(certifier.verifyBundle(bundle)).toBe(true);
  });

  it('rejects tampered bundle', () => {
    const certifier = new ComplianceCertifier({ namespace: 'root-1' });
    const results = [{ check: 'a', passed: true }];
    const bundle = certifier.certify('run-1', 'default', results);
    bundle.profile = 'other';
    expect(certifier.verifyBundle(bundle)).toBe(false);
  });
});
