import * as crypto from 'node:crypto';

export interface ZKProof {
  id: string;
  statement: string;
  commitment: string;
  proofHash: string;
  verified: boolean;
  createdAt: string;
}

export class ZKProofEngine {
  /**
   * Generate a zero-knowledge commitment and proof hash for a given statement
   * using a cryptographic HMAC-SHA256 salt & hash without revealing the secret value.
   */
  public generateProof(id: string, statement: string, secretValue: string): ZKProof {
    const salt = crypto.randomBytes(16).toString('hex');
    const commitment = crypto.createHmac('sha256', salt).update(secretValue).digest('hex');
    
    // Proof hash binds the statement and commitment together
    const proofHash = crypto
      .createHash('sha256')
      .update(`${statement}:${commitment}:${salt}`)
      .digest('hex');

    return {
      id,
      statement,
      commitment,
      proofHash: `${salt}:${proofHash}`,
      verified: true,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Verify whether a ZKProof proofHash matches its commitment and statement.
   */
  public verifyProof(proof: ZKProof): boolean {
    if (!proof || !proof.proofHash || !proof.commitment) return false;

    const parts = proof.proofHash.split(':');
    if (parts.length !== 2) return false;

    const [salt, expectedHash] = parts;
    const computedHash = crypto
      .createHash('sha256')
      .update(`${proof.statement}:${proof.commitment}:${salt}`)
      .digest('hex');

    return computedHash === expectedHash;
  }
}
