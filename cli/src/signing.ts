import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * ALP Registry Package Signing (v4.1 — registry trust hardening)
 *
 * Maintainers sign published package versions with an Ed25519 keypair. The
 * public key fingerprint + base64 signature are stored alongside the version
 * so consumers can verify authenticity against a trust root (`.alprc`
 * `trustedKeys` or an explicit `--key`). Signing is OPTIONAL and backward
 * compatible: unsigned packages install normally; a signed package is
 * verified only when a trust root is configured, and a bad signature is
 * rejected.
 */

export interface Signature {
  /** Ed25519 public key (PEM), identifying the signer. */
  key: string;
  /** base64 of the detached Ed25519 signature over the canonical payload. */
  sig: string;
}

/** Short, stable fingerprint of a public key for display/trust matching. */
export function fingerprint(publicKeyPem: string): string {
  return 'alp1' + crypto.createHash('sha256').update(publicKeyPem).digest('hex').slice(0, 24);
}

/** Generate an Ed25519 keypair, returning PEM-encoded private + public keys. */
export function generateKeypair(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  return {
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }) as string,
  };
}

/** Write a keypair to `<dir>/registry.key` (600) and `<dir>/registry.pub`. */
export function writeKeypair(dir: string, privateKey: string, publicKey: string): { priv: string; pub: string } {
  const priv = path.join(dir, 'registry.key');
  const pub = path.join(dir, 'registry.pub');
  fs.writeFileSync(priv, privateKey, { mode: 0o600 });
  fs.writeFileSync(pub, publicKey, { mode: 0o644 });
  return { priv, pub };
}

/**
 * Canonical signing payload for a version: a stable string of the manifest
 * fields + the entry file contents. Determinism matters, so we hash the entry
 * file and serialize an ordered object.
 */
export function signingPayload(opts: { name: string; version: string; entry: string; entryHash: string; dependencies: Record<string, string> }): string {
  const orderedDeps = Object.keys(opts.dependencies).sort();
  return JSON.stringify({
    name: opts.name,
    version: opts.version,
    entry: opts.entry,
    entrySha256: opts.entryHash,
    dependencies: orderedDeps.reduce((acc, k) => ((acc[k] = opts.dependencies[k]), acc), {} as Record<string, string>),
  });
}

/** Sign a payload with a PEM private key, returning a Signature object. */
export function sign(privateKeyPem: string, payload: string): Signature {
  const key = crypto.createPrivateKey(privateKeyPem);
  const sig = crypto.sign(null, Buffer.from(payload), key);
  const publicKey = crypto.createPublicKey(key).export({ type: 'spki', format: 'pem' }) as string;
  return { key: publicKey, sig: sig.toString('base64') };
}

/** Verify a signature against a PEM public key. */
export function verify(publicKeyPem: string, payload: string, sig: Signature): boolean {
  try {
    if (publicKeyPem.trim() !== sig.key.trim()) return false;
    const key = crypto.createPublicKey(publicKeyPem);
    return crypto.verify(null, Buffer.from(payload), key, Buffer.from(sig.sig, 'base64'));
  } catch {
    return false;
  }
}

/** Load a PEM public key from a file path or return the raw PEM string. */
export function resolvePublicKey(input: string): string {
  if (fs.existsSync(input) && (input.endsWith('.pub') || input.endsWith('.pem') || input.endsWith('.key'))) {
    return fs.readFileSync(input, 'utf-8');
  }
  return input;
}
