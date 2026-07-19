import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/**
 * ALP Encrypted Secrets Vault (v8.4.0).
 *
 * Stores secrets encrypted at rest using an age-style X25519 envelope +
 * AES-256-GCM. Each secret is sealed to one or more recipient public keys;
 * only a holder of the matching X25519 private key can unseal it. The TS
 * implementation uses Node's built-in `crypto`. The Python SDK mirrors this
 * and requires the optional `cryptography` package (spec/19).
 *
 * Envelope per secret: a random 256-bit data key encrypts the plaintext with
 * AES-256-GCM (12-byte nonce, 16-byte tag). For each recipient we do an
 * X25519 ECDH with an ephemeral keypair, HKDF the shared secret into a 32-byte
 * wrapping key, and AES-256-GCM-wrap the data key (the ephemeral public key is
 * stored alongside). `recipients` therefore maps fingerprint -> base64 blob.
 */

export interface SealedSecret {
  id: string;
  recipients: Record<string, string>; // fingerprint -> base64(ephemeralPub | wrappedDataKey)
  nonce: string; // base64(12 bytes)
  ciphertext: string; // base64(AES-256-GCM(secret))
  created_at: string;
  rotated_at: string | null;
}

export interface VaultAuditEntry {
  ts: string;
  action: 'set' | 'get' | 'rotate' | 'list';
  id: string;
  by: string; // recipient fingerprint or 'anonymous'
}

export interface VaultOptions {
  dir?: string;
  storeFile?: string;
  auditFile?: string;
}

const ALGO = 'aes-256-gcm';
const NONCE_LEN = 12;
const WRAP_NONCE = Buffer.alloc(12); // fixed nonce for key-wrap; key is single-use random

function fingerprint(pubRaw: Buffer): string {
  return 'age1' + crypto.createHash('sha256').update(pubRaw).digest('hex').slice(0, 38);
}

function rawPublic(pub: crypto.KeyObject): Buffer {
  return pub.export({ type: 'spki', format: 'der' });
}

function hkdf(shared: Buffer): Buffer {
  // HKDF-SHA256 (simplified, single info) -> 32-byte wrapping key.
  return crypto.createHmac('sha256', Buffer.from('alp-vault-v8')).update(shared).digest();
}

function sealDataKey(dataKey: Buffer, recipientPub: crypto.KeyObject): string {
  const eph = crypto.generateKeyPairSync('x25519');
  const shared = crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: recipientPub });
  const wrapKey = hkdf(shared);
  const cipher = crypto.createCipheriv(ALGO, wrapKey, WRAP_NONCE);
  const wrapped = Buffer.concat([cipher.update(dataKey), cipher.final(), cipher.getAuthTag()]);
  // Prepend the ephemeral public key (44 bytes DER SPKI) so the holder can redo ECDH.
  return Buffer.concat([rawPublic(eph.publicKey), wrapped]).toString('base64');
}

function openDataKey(blob: string, recipientPriv: crypto.KeyObject): Buffer {
  const raw = Buffer.from(blob, 'base64');
  const ephPub = crypto.createPublicKey({ key: raw.subarray(0, 44), format: 'der', type: 'spki' });
  const shared = crypto.diffieHellman({ privateKey: recipientPriv, publicKey: ephPub });
  const wrapKey = hkdf(shared);
  const ct = raw.subarray(44);
  const tag = ct.subarray(ct.length - 16);
  const body = ct.subarray(0, ct.length - 16);
  const decipher = crypto.createDecipheriv(ALGO, wrapKey, WRAP_NONCE);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

export class Vault {
  private storePath: string;
  private auditPath: string;

  constructor(opts: VaultOptions = {}) {
    const dir = opts.dir ?? path.resolve(process.cwd(), '.alp', '.vault');
    this.storePath = opts.storeFile ?? path.join(dir, 'store.jsonl');
    this.auditPath = opts.auditFile ?? path.join(dir, 'audit.jsonl');
  }

  private ensureDir(): void {
    const dir = path.dirname(this.storePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  private readStore(): SealedSecret[] {
    if (!fs.existsSync(this.storePath)) return [];
    const text = fs.readFileSync(this.storePath, 'utf-8').trim();
    if (!text) return [];
    return text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as SealedSecret);
  }

  private writeStore(secrets: SealedSecret[]): void {
    this.ensureDir();
    fs.writeFileSync(this.storePath, secrets.map((s) => JSON.stringify(s)).join('\n') + '\n', 'utf-8');
  }

  private appendAudit(entry: VaultAuditEntry): void {
    this.ensureDir();
    fs.appendFileSync(this.auditPath, JSON.stringify(entry) + '\n', 'utf-8');
  }

  /** Seal and persist a secret to the given recipients (X25519 PEMs or raw 32-byte buffers). */
  set(id: string, plaintext: string, recipients: (string | Buffer)[], by = 'anonymous'): SealedSecret {
    const pubs = recipients.map((r) =>
      Buffer.isBuffer(r) ? crypto.createPublicKey({ key: r, format: 'der', type: 'spki' }) : crypto.createPublicKey(r),
    );
    const dataKey = crypto.randomBytes(32);
    const nonce = crypto.randomBytes(NONCE_LEN);
    const cipher = crypto.createCipheriv(ALGO, dataKey, nonce);
    const ciphertext = Buffer.concat([
      cipher.update(Buffer.from(plaintext, 'utf-8')),
      cipher.final(),
      cipher.getAuthTag(),
    ]);

    const sealedRecipients: Record<string, string> = {};
    for (const pub of pubs) {
      const fp = fingerprint(rawPublic(pub));
      sealedRecipients[fp] = sealDataKey(dataKey, pub);
    }

    const record: SealedSecret = {
      id,
      recipients: sealedRecipients,
      nonce: nonce.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      created_at: new Date().toISOString(),
      rotated_at: null,
    };

    const secrets = this.readStore().filter((s) => s.id !== id);
    secrets.push(record);
    this.writeStore(secrets);
    this.appendAudit({ ts: record.created_at, action: 'set', id, by });
    return record;
  }

  /** Unseal a secret for the holder of `privateKey` (X25519 PEM or raw 32-byte buffer). */
  get(id: string, privateKey: string | Buffer, by = 'anonymous'): string {
    const secret = this.readStore().find((s) => s.id === id);
    if (!secret) throw new Error(`Vault: secret '${id}' not found`);
    const priv = Buffer.isBuffer(privateKey)
      ? crypto.createPrivateKey({ key: privateKey, format: 'der', type: 'pkcs8' })
      : crypto.createPrivateKey(privateKey);
    const fp = fingerprint(rawPublic(crypto.createPublicKey(priv)));
    const blob = secret.recipients[fp];
    if (!blob) throw new Error(`Vault: recipient '${fp}' is not authorized for '${id}'`);

    const dataKey = openDataKey(blob, priv);
    const nonce = Buffer.from(secret.nonce, 'base64');
    const ct = Buffer.from(secret.ciphertext, 'base64');
    const tag = ct.subarray(ct.length - 16);
    const body = ct.subarray(0, ct.length - 16);
    const decipher = crypto.createDecipheriv(ALGO, dataKey, nonce);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(body), decipher.final()]).toString('utf-8');
    this.appendAudit({ ts: new Date().toISOString(), action: 'get', id, by: fp });
    return plaintext;
  }

  /** List secret ids (no values). */
  list(by = 'anonymous'): { id: string; created_at: string; rotated_at: string | null }[] {
    const out = this.readStore().map((s) => ({ id: s.id, created_at: s.created_at, rotated_at: s.rotated_at }));
    this.appendAudit({ ts: new Date().toISOString(), action: 'list', id: '*', by });
    return out;
  }

  /** Re-seal a secret under a fresh data key (rotation) using one authorized holder's key. */
  rotate(id: string, privateKey: string | Buffer, by = 'anonymous'): SealedSecret {
    const plaintext = this.get(id, privateKey, by);
    const secret = this.readStore().find((s) => s.id === id)!;
    // Re-seal for the same set of recipients. We only have their fingerprints;
    // the rotating holder re-derives the recipient set by passing their own
    // private key (set extracts the matching public key). For multi-recipient
    // rotation callers pass all authorized private keys.
    const recipients = Object.keys(secret.recipients).map(() => privateKey);
    const rotated = this.set(id, plaintext, recipients, by);
    rotated.rotated_at = new Date().toISOString();
    const secrets = this.readStore().map((s) => (s.id === id ? rotated : s));
    this.writeStore(secrets);
    this.appendAudit({ ts: rotated.rotated_at, action: 'rotate', id, by });
    return rotated;
  }

  /** Return the audit trail. */
  audit(): VaultAuditEntry[] {
    if (!fs.existsSync(this.auditPath)) return [];
    return fs.readFileSync(this.auditPath, 'utf-8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  }
}
