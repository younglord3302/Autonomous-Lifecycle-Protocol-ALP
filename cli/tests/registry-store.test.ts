import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'node:crypto';
import { RegistryStore } from '../src/registry-store';
import { satisfies, semverCmp, RegistryClient, loadAlprc } from '../src/registry';
import { sign, signingPayload, generateKeypair, fingerprint } from '../src/signing';

describe('RegistryStore (Pillar 3)', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } dirs.length = 0; });

  function makePkgDir(name: string, version: string, entryContent: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alp-store-pkg-'));
    fs.writeFileSync(path.join(dir, 'alp-package.json'), JSON.stringify({
      name, version, description: `pkg ${name}`, files: ['plugin.alp'],
    }));
    fs.writeFileSync(path.join(dir, 'plugin.alp'), entryContent);
    return dir;
  }

  it('publishes, lists, and searches packages', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alp-store-')); dirs.push(root);
    const store = new RegistryStore(root);
    store.publish(makePkgDir('@demo/scrum', '1.0.0', '@agent\n  id: a\n'));
    store.publish(makePkgDir('@demo/kanban', '2.1.0', '@agent\n  id: b\n'));

    const meta = store.getMeta('@demo/scrum');
    expect(meta).not.toBeNull();
    expect(meta!.versions['1.0.0'].integrity.startsWith('sha256:')).toBe(true);
    expect(meta!.tags.latest).toBe('1.0.0');

    expect(store.list().length).toBe(2);
    expect(store.search('kanban').length).toBe(1);
    expect(store.search('demo').length).toBe(2);

    const buf = store.readFile('@demo/scrum', '1.0.0', 'plugin.alp');
    expect(buf).not.toBeNull();
    expect(buf!.toString()).toContain('id: a');
  });

  it('resolves semver ranges and writes a lockfile on install', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alp-store-')); dirs.push(root);
    const store = new RegistryStore(root);
    store.publish(makePkgDir('@demo/range', '1.0.0', '@agent\n  id: a\n'));
    store.publish(makePkgDir('@demo/range', '1.2.3', '@agent\n  id: b\n'));
    store.publish(makePkgDir('@demo/range', '2.0.0', '@agent\n  id: c\n'));

    // Caret allows 1.x but not 2.0.0; latest matching is highest in range.
    expect(store.getMeta('@demo/range')!.tags.latest).toBe('2.0.0');
    const meta = store.getMeta('@demo/range')!;
    expect(new RegistryClient().resolveVersion(meta, '^1.0.0')).toBe('1.2.3');
    expect(new RegistryClient().resolveVersion(meta, '~1.2.0')).toBe('1.2.3');
    expect(new RegistryClient().resolveVersion(meta, '>=1.2.0 <2.0.0')).toBe('1.2.3');

    // Lockfile pinning is exercised end-to-end in registry.test.ts (with a live
    // server). Here we assert the pure locker writes the resolved version.
    const consumer = fs.mkdtempSync(path.join(os.tmpdir(), 'alp-cons-')); dirs.push(consumer);
    const alpDir = path.join(consumer, '.alp');
    fs.mkdirSync(alpDir, { recursive: true });
    new RegistryClient().writeLock(alpDir, '@demo/range', '1.2.3', 'sha256:abc');
    const lock = JSON.parse(fs.readFileSync(path.join(alpDir, 'registry.lock.json'), 'utf-8'));
    expect(lock['@demo/range'].version).toBe('1.2.3');
    expect(lock['@demo/range'].integrity).toBe('sha256:abc');
  });
});

describe('verifyVersionSignature (shared verifier, v4.4)', () => {
  function makeInfo(entryContent: string, signerKey?: string, trustRoots?: Record<string, string>) {
    const entry = 'plugin.alp';
    const entryHash = crypto.createHash('sha256').update(entryContent).digest('hex');
    const info = {
      url: `/api/registry/-/demo/x/${entry}`,
      integrity: 'sha256:' + entryHash,
      dependencies: {},
      size: entryContent.length,
      entry,
      files: [entry],
    } as any;
    if (signerKey) {
      info.signature = sign(signerKey, signingPayload({ name: '@demo/x', version: '1.0.0', entry, entryHash, dependencies: {} }));
    }
    return info;
  }

  it('reports unsigned when no trust root is configured', () => {
    const r = RegistryStore.verifyVersionSignature('@demo/x', '1.0.0', makeInfo('@agent\n  id: a\n'));
    expect(r.signed).toBe(false);
    expect(r.valid).toBe(false);
    expect(r.trusted).toBe(false);
  });

  it('requires a signature when a trust root is configured', () => {
    const roots = { '@demo': generateKeypair().publicKey };
    const r = RegistryStore.verifyVersionSignature('@demo/x', '1.0.0', makeInfo('@agent\n  id: a\n'), roots);
    expect(r.signed).toBe(false);
    expect(r.reason).toMatch(/trust root requires a signature/i);
  });

  it('validates a trusted signature and rejects a wrong-key signature', () => {
    const { privateKey, publicKey } = generateKeypair();
    const other = generateKeypair();
    const content = '@agent\n  id: a\n';
    const roots = { '@demo': publicKey };

    const ok = RegistryStore.verifyVersionSignature('@demo/x', '1.0.0', makeInfo(content, privateKey), roots);
    expect(ok.signed).toBe(true);
    expect(ok.valid).toBe(true);
    expect(ok.trusted).toBe(true);

    const bad = RegistryStore.verifyVersionSignature('@demo/x', '1.0.0', makeInfo(content, other.privateKey), roots);
    expect(bad.signed).toBe(true);
    expect(bad.valid).toBe(true);
    expect(bad.trusted).toBe(false);
    expect(bad.reason).toMatch(/not in trust root/i);

    // A tampered entryHash invalidates the signature.
    const tampered = makeInfo(content, privateKey, roots);
    tampered.integrity = 'sha256:' + '0'.repeat(64);
    const invalid = RegistryStore.verifyVersionSignature('@demo/x', '1.0.0', tampered, roots);
    expect(invalid.valid).toBe(false);
  });

  it('matches trust root by fingerprint and honors an explicit --key override', () => {
    const { privateKey, publicKey } = generateKeypair();
    const content = '@agent\n  id: a\n';
    const roots = { '@demo': fingerprint(publicKey) };
    const viaFp = RegistryStore.verifyVersionSignature('@demo/x', '1.0.0', makeInfo(content, privateKey), roots);
    expect(viaFp.trusted).toBe(true);

    // explicit PEM overrides roots (and need not match the fingerprint root).
    const other = generateKeypair();
    const explicit = RegistryStore.verifyVersionSignature('@demo/x', '1.0.0', makeInfo(content, other.privateKey), undefined, other.publicKey);
    expect(explicit.trusted).toBe(true);
    expect(explicit.valid).toBe(true);
  });
});

describe('semver helpers', () => {
  it('compares versions with prerelease ordering', () => {
    expect(semverCmp('1.0.0', '1.0.1')).toBeLessThan(0);
    expect(semverCmp('2.0.0', '1.9.9')).toBeGreaterThan(0);
    expect(semverCmp('1.0.0', '1.0.0')).toBe(0);
    expect(semverCmp('1.0.0', '1.0.0-beta')).toBeGreaterThan(0);
  });

  it('satisfies caret, tilde, x-ranges, and comparators', () => {
    expect(satisfies('1.2.3', '^1.0.0')).toBe(true);
    expect(satisfies('2.0.0', '^1.0.0')).toBe(false);
    expect(satisfies('0.2.5', '^0.2.3')).toBe(true);
    expect(satisfies('0.3.0', '^0.2.3')).toBe(false);
    expect(satisfies('1.2.9', '~1.2.3')).toBe(true);
    expect(satisfies('1.3.0', '~1.2.3')).toBe(false);
    expect(satisfies('1.5.0', '1.x')).toBe(true);
    expect(satisfies('2.0.0', '1.x')).toBe(false);
    expect(satisfies('1.4.0', '>=1.2.0 <1.5.0')).toBe(true);
    expect(satisfies('1.5.0', '>=1.2.0 <1.5.0')).toBe(false);
    expect(satisfies('1.0.0', '*')).toBe(true);
  });
});

describe('.alprc config (spec/14 §4)', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } dirs.length = 0; });

  it('loads .alprc with namespace routing and expands ${ENV} tokens', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alp-alprc-')); dirs.push(dir);
    fs.writeFileSync(path.join(dir, '.alprc.json'), JSON.stringify({
      registries: { default: 'https://registry.example.com', '@internal': 'https://alp.corp.example' },
      auth: { 'https://alp.corp.example': { token: '${ALP_TEST_TOKEN}' } },
    }));
    process.env.ALP_TEST_TOKEN = 'secret-123';
    const cfg = loadAlprc(dir);
    expect(cfg.registries!['@internal']).toBe('https://alp.corp.example');
    expect(cfg.auth!['https://alp.corp.example'].token).toBe('secret-123');
    delete process.env.ALP_TEST_TOKEN;
  });

  it('routes package base URL by namespace (§4.1)', () => {
    const cfg = { registries: { '@internal': 'https://alp.corp.example', default: 'https://registry.example.com' } };
    const client = new RegistryClient('http://127.0.0.1:4000', cfg);
    expect(client.resolveBaseUrl('@internal/deploy')).toBe('https://alp.corp.example');
    expect(client.resolveBaseUrl('@community/scrum')).toBe('https://registry.example.com');
    // Unknown namespace falls back to the .alprc `default` registry.
    expect(client.resolveBaseUrl('@other/x')).toBe('https://registry.example.com');
    // With no default configured, falls back to the constructor base URL.
    const bare = new RegistryClient('http://127.0.0.1:4000', {});
    expect(bare.resolveBaseUrl('@other/x')).toBe('http://127.0.0.1:4000');
  });

  it('rejects plain HTTP for non-loopback registries (§5.1)', async () => {
    const client = new RegistryClient('http://evil.example.com');
    await expect(client.list()).rejects.toThrow(/insecure/i);
    await expect(client.getMeta('@x/y')).rejects.toThrow(/insecure/i);
  });
});
