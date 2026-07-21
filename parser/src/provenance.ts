/** ALP end-to-end provenance (v10.0.0 — The Verifiable Era). */

import { StoredEvent } from './state-store';

export interface VerifiableCredential {
  id: string;
  agent: string;
  issuer: string;
  claims: Record<string, any>;
  issued_at: string;
}

export class TraceSigner {
  constructor(private vault?: any) {}

  seal(event: Record<string, any>, recipient: string): Record<string, any> {
    const sealed: Record<string, any> = { ...event };
    sealed._sealed = {
      recipient,
      sealed_at: new Date().toISOString(),
    };
    const payload = JSON.stringify(sealed, Object.keys(sealed).sort());
    sealed._sealed.digest = sha256(payload);
    return sealed;
  }

  verify(sealedEvent: Record<string, any>): boolean {
    const envelope = sealedEvent._sealed;
    if (!envelope || !envelope.digest) return false;
    const { digest, ...rest } = sealedEvent._sealed;
    const copy = { ...sealedEvent, _sealed: rest };
    const payload = JSON.stringify(copy, Object.keys(copy).sort());
    const expected = sha256(payload);
    return envelope.digest === expected;
  }
}

export interface SignedTrace {
  trace_id: string;
  _parent: string;
  _hash: string;
  [key: string]: any;
}

export class ProvenanceStore {
  private traces: SignedTrace[] = [];
  private chain: string[] = [];

  addTrace(trace: Record<string, any>, signer?: TraceSigner, recipient = '*'): SignedTrace {
    const sealed = signer ? signer.seal(trace, recipient) : { ...trace };
    const parentHash = this.chain.length ? this.chain[this.chain.length - 1] : 'genesis';
    sealed._parent = parentHash;
    const payload = JSON.stringify(sealed, Object.keys(sealed).sort());
    sealed._hash = sha256(payload);
    this.traces.push(sealed as SignedTrace);
    this.chain.push(sealed._hash);
    return sealed as SignedTrace;
  }

  lineage(traceId: string): SignedTrace[] {
    return this.traces.filter((t) => t.trace_id === traceId);
  }

  verifyChain(): boolean {
    for (let i = 0; i < this.traces.length; i++) {
      const expectedParent = i === 0 ? 'genesis' : this.traces[i - 1]._hash;
      if (this.traces[i]._parent !== expectedParent) return false;
    }
    return true;
  }

  allTraces(): SignedTrace[] {
    return [...this.traces];
  }
}

export interface AuditEntry {
  _index: number;
  _timestamp: string;
  _hash: string;
  _prev: string;
  [key: string]: any;
}

export class AuditLedger {
  private entries: AuditEntry[] = [];
  private hashes: string[] = [];

  append(entry: Record<string, any>): AuditEntry {
    const e: AuditEntry = {
      ...entry,
      _index: this.entries.length,
      _timestamp: new Date().toISOString(),
      _prev: this.hashes.length ? this.hashes[this.hashes.length - 1] : 'genesis',
      _hash: '',
    };
    const payload = JSON.stringify(e, Object.keys(e).sort());
    e._hash = sha256(payload);
    this.entries.push(e);
    this.hashes.push(e._hash);
    return e;
  }

  verify(): boolean {
    for (let i = 0; i < this.entries.length; i++) {
      const expectedPrev = i === 0 ? 'genesis' : this.entries[i - 1]._hash;
      if (this.entries[i]._prev !== expectedPrev) return false;
    }
    return true;
  }

  tail(n = 10): AuditEntry[] {
    return this.entries.slice(-n);
  }
}

function sha256(input: string): string {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(input).digest('hex');
}
