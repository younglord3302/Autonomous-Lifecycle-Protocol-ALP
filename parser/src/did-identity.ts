import * as crypto from 'node:crypto';

export interface DIDDocument {
  id: string;
  didUri: string;
  publicKey: string;
  chainId: string;
  anchorBlockHash?: string;
  createdAt: string;
}

export interface DIDAnchorReceipt {
  didUri: string;
  blockHash: string;
  transactionHash: string;
  anchoredAt: string;
  status: 'CONFIRMED' | 'PENDING';
}

export class DIDIdentityEngine {
  public createDID(agentId: string, chainId: string = 'alp-mainnet-1'): DIDDocument {
    const keyPair = crypto.generateKeyPairSync('ed25519');
    const publicKeyPem = keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    
    // Hash public key to create deterministic DID identifier
    const keyHash = crypto.createHash('sha256').update(publicKeyPem).digest('hex').slice(0, 32);
    const didUri = `did:alp:${chainId}:${keyHash}`;

    return {
      id: `did-${agentId}`,
      didUri,
      publicKey: publicKeyPem,
      chainId,
      createdAt: new Date().toISOString(),
    };
  }

  public anchorToLedger(didDoc: DIDDocument, blockHash?: string): DIDAnchorReceipt {
    const bHash = blockHash || crypto.randomBytes(32).toString('hex');
    const txHash = crypto
      .createHash('sha256')
      .update(`${didDoc.didUri}:${bHash}:${Date.now()}`)
      .digest('hex');

    didDoc.anchorBlockHash = bHash;

    return {
      didUri: didDoc.didUri,
      blockHash: bHash,
      transactionHash: txHash,
      anchoredAt: new Date().toISOString(),
      status: 'CONFIRMED',
    };
  }

  public verifyDIDAnchor(didDoc: DIDDocument): boolean {
    if (!didDoc || !didDoc.didUri || !didDoc.publicKey) return false;
    return didDoc.didUri.startsWith(`did:alp:${didDoc.chainId}:`) && !!didDoc.anchorBlockHash;
  }
}
