import { describe, it, expect } from 'vitest';
import { ZKProofEngine } from '../src/zk-proof';

describe('ZKProofEngine (v18.0.0)', () => {
  it('generates a valid zero-knowledge commitment and proof hash', () => {
    const engine = new ZKProofEngine();
    const proof = engine.generateProof('proof-1', 'policy-compliant', 'secret-passcode-123');

    expect(proof.id).toBe('proof-1');
    expect(proof.statement).toBe('policy-compliant');
    expect(proof.commitment).toBeDefined();
    expect(proof.proofHash).toBeDefined();
    expect(proof.verified).toBe(true);
  });

  it('verifies valid proofs and rejects tampered proofs', () => {
    const engine = new ZKProofEngine();
    const proof = engine.generateProof('proof-2', 'vault-access-granted', 'my-vault-secret');

    expect(engine.verifyProof(proof)).toBe(true);

    // Tamper statement
    const tamperedStatement = { ...proof, statement: 'unauthorized-access' };
    expect(engine.verifyProof(tamperedStatement)).toBe(false);

    // Tamper commitment
    const tamperedCommitment = { ...proof, commitment: 'deadbeef' };
    expect(engine.verifyProof(tamperedCommitment)).toBe(false);
  });
});
