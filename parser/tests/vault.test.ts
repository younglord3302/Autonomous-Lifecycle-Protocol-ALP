import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { Vault } from '../src/index';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'alp-vault-'));
}

function genKeys() {
  const priv = crypto.generateKeyPairSync('x25519');
  return {
    privatePem: priv.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    publicPem: priv.publicKey.export({ type: 'spki', format: 'pem' }) as string,
  };
}

describe('Vault (v8.4.0)', () => {
  let dir: string;
  beforeEach(() => {
    dir = tmpDir();
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('seals and unseals a secret for an authorized recipient', () => {
    const recipient = genKeys();
    const vault = new Vault({ dir });
    vault.set('db-password', 's3cr3t', [recipient.publicPem]);
    const plaintext = vault.get('db-password', recipient.privatePem);
    expect(plaintext).toBe('s3cr3t');
  });

  it('does not store plaintext on disk', () => {
    const recipient = genKeys();
    const vault = new Vault({ dir });
    vault.set('api-key', 'topsecret-value', [recipient.publicPem]);
    const store = fs.readFileSync(path.join(dir, 'store.jsonl'), 'utf-8');
    expect(store).not.toContain('topsecret-value');
  });

  it('rejects an unauthorized recipient', () => {
    const a = genKeys();
    const b = genKeys();
    const vault = new Vault({ dir });
    vault.set('secret', 'value', [a.publicPem]);
    expect(() => vault.get('secret', b.privatePem)).toThrow(/not authorized/);
  });

  it('throws for an unknown secret id', () => {
    const a = genKeys();
    const vault = new Vault({ dir });
    expect(() => vault.get('missing', a.privatePem)).toThrow(/not found/);
  });

  it('lists ids without values', () => {
    const a = genKeys();
    const vault = new Vault({ dir });
    vault.set('s1', 'v1', [a.publicPem]);
    vault.set('s2', 'v2', [a.publicPem]);
    const ids = vault.list().map((s) => s.id).sort();
    expect(ids).toEqual(['s1', 's2']);
  });

  it('rotates a secret and still unseals it', () => {
    const a = genKeys();
    const vault = new Vault({ dir });
    vault.set('rotate-me', 'original', [a.publicPem]);
    const rotated = vault.rotate('rotate-me', a.privatePem);
    expect(rotated.rotated_at).not.toBeNull();
    expect(vault.get('rotate-me', a.privatePem)).toBe('original');
  });

  it('supports multiple recipients', () => {
    const a = genKeys();
    const b = genKeys();
    const vault = new Vault({ dir });
    vault.set('shared', 'team-secret', [a.publicPem, b.publicPem]);
    expect(vault.get('shared', a.privatePem)).toBe('team-secret');
    expect(vault.get('shared', b.privatePem)).toBe('team-secret');
  });

  it('records an audit trail', () => {
    const a = genKeys();
    const vault = new Vault({ dir });
    vault.set('audited', 'v', [a.publicPem]);
    vault.get('audited', a.privatePem);
    const trail = vault.audit();
    const actions = trail.map((t) => t.action);
    expect(actions).toContain('set');
    expect(actions).toContain('get');
  });
});
