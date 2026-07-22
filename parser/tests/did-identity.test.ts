import { describe, it, expect } from 'vitest';
import { DIDIdentityEngine } from '../src/did-identity';

describe('DIDIdentityEngine (v20.0.0)', () => {
  it('creates deterministic DID URI and keypair', () => {
    const engine = new DIDIdentityEngine();
    const doc = engine.createDID('agent-architect', 'alp-mainnet-1');

    expect(doc.id).toBe('did-agent-architect');
    expect(doc.didUri).toMatch(/^did:alp:alp-mainnet-1:[a-f0-9]{32}$/);
    expect(doc.publicKey).toContain('BEGIN PUBLIC KEY');
    expect(doc.chainId).toBe('alp-mainnet-1');
  });

  it('anchors DID document to blockchain ledger', () => {
    const engine = new DIDIdentityEngine();
    const doc = engine.createDID('agent-coder');
    const receipt = engine.anchorToLedger(doc);

    expect(receipt.didUri).toBe(doc.didUri);
    expect(receipt.blockHash).toBeDefined();
    expect(receipt.transactionHash).toBeDefined();
    expect(receipt.status).toBe('CONFIRMED');

    expect(engine.verifyDIDAnchor(doc)).toBe(true);
  });
});
