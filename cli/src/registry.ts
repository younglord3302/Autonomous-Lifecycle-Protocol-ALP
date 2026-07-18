import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'node:crypto';
import * as http from 'node:http';
import * as https from 'node:https';
import { sign, signingPayload, resolvePublicKey, fingerprint, Signature } from './signing';
import { RegistryStore } from './registry-store';

/**
 * ALP Registry Client (v4 — The Federation Era, Pillar 3)
 *
 * Talks to a hosted ALP registry (an `alp serve --registry` instance) over the
 * HTTP protocol in spec/14-plugin-registry.md. Resolves `meta.json`, downloads
 * package files, verifies integrity, and (v4.1) verifies package signatures
 * against a trust root. Falls back to a local registry store path when no
 * remote is configured.
 */

export interface PackageManifest {
  name: string;
  version: string;
  description?: string;
  author?: string;
  dependencies?: Record<string, string>;
  files: string[];
  entry?: string;
}

/**
 * `.alprc` configuration (spec/14-plugin-registry.md §4). Maps namespaces to
 * registry base URLs and supplies bearer tokens for private registries. Token
 * values of the form `${ENV_VAR}` are expanded from the environment.
 *
 * `trustedKeys` (§4.3) is the signature trust root for package signing: a map
 * of namespace (`@ns` or `*` for global) to either an inline PEM public key or
 * a public-key fingerprint (`alp1...`). When configured, signed installs for
 * that namespace are verified against it (v4.3).
 */
export interface AlprcConfig {
  registries?: Record<string, string>;
  auth?: Record<string, { token?: string }>;
  trustedKeys?: Record<string, string>;
}

const LOCALHOST = /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/i;

function expandEnv(v: string): string {
  return v.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] ?? '');
}

/** Load `.alprc` / `.alprc.json` from the cwd or the user's home directory. */
export function loadAlprc(cwd: string = process.cwd()): AlprcConfig {
  const candidates = [
    path.join(cwd, '.alprc'),
    path.join(cwd, '.alprc.json'),
    path.join(os.homedir(), '.alprc'),
    path.join(os.homedir(), '.alprc.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        const raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as AlprcConfig;
        // Expand ${ENV} references in auth tokens (spec/14 §4.2) at load time.
        if (raw.auth) {
          for (const entry of Object.values(raw.auth)) {
            if (entry?.token) entry.token = expandEnv(entry.token);
          }
        }
        return raw;
      } catch {
        /* fall through to empty config */
      }
    }
  }
  return {};
}

function request(url: string, headers: Record<string, string> = {}, method = 'GET', body?: string): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    // §5.1: registry communication MUST be over HTTPS. Allow plain HTTP only
    // for loopback addresses so local `alp serve --registry` works in dev.
    if (u.protocol !== 'https:' && !LOCALHOST.test(u.hostname)) {
      return reject(new Error(`Refusing to use insecure registry over plain HTTP: ${url} (use https://)`));
    }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c as Buffer));
      res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

export class RegistryClient {
  constructor(
    private baseUrl: string = process.env.ALP_REGISTRY_URL || 'http://127.0.0.1:4000',
    private config: AlprcConfig = loadAlprc(),
    private inlineToken?: string,
  ) {}

  /** Resolve the registry base URL for a package, honoring `.alprc` namespace routing (§4.1). */
  resolveBaseUrl(pkgName: string): string {
    const ns = pkgName.replace(/^@/, '').split('/')[0];
    const mapped = this.config.registries?.[`@${ns}`] || this.config.registries?.[ns];
    return mapped || this.config.registries?.default || this.baseUrl;
  }

  /** Bearer token for the base URL, if configured (§4.2). */
  private authHeader(baseUrl: string): Record<string, string> {
    const token = this.inlineToken || this.config.auth?.[baseUrl]?.token;
    const expanded = token ? expandEnv(token) : '';
    return expanded ? { Authorization: `Bearer ${expanded}` } : {};
  }

  /** Fetch package metadata from the registry. */
  async getMeta(pkgName: string): Promise<any> {
    const [ns, ...rest] = pkgName.replace(/^@/, '').split('/');
    const name = rest.join('/') || ns;
    const base = this.resolveBaseUrl(pkgName);
    const r = await request(`${base}/api/registry/-/${encodeURIComponent(ns)}/${encodeURIComponent(name)}/meta.json`, this.authHeader(base));
    if (r.status !== 200) throw new Error(`Package ${pkgName} not found in registry (${r.status})`);
    return JSON.parse(r.body.toString('utf-8'));
  }

  /** Resolve a version range (semver: exact, ^, ~, >=, <=, >, <, x-ranges, latest) to a concrete version. */
  resolveVersion(meta: any, range = 'latest'): string {
    const versions = Object.keys(meta.versions);
    if (range === 'latest' || range === '' || range === undefined) {
      return meta.tags?.latest ?? versions.sort(semverCmp).pop()!;
    }
    if (meta.versions[range]) return range;
    const matched = versions.filter((v) => satisfies(v, range)).sort(semverCmp);
    if (!matched.length) throw new Error(`No version satisfying ${range} for ${meta.name} (have ${versions.join(', ')})`);
    return matched[matched.length - 1];
  }

  /** Download a package version into `<alpDir>/packages/<name>/`.
   *  When a trust root is configured (explicit `trustedKey` PEM, or a
   *  `.alprc` `trustedKeys` entry for the namespace), a signed version whose
   *  signature does not verify against it is rejected (v4.2/v4.3 trust). */
  async install(pkgName: string, targetAlpDir: string, versionRange = 'latest', trustedKey?: string): Promise<string> {
    const meta = await this.getMeta(pkgName);
    const version = this.resolveVersion(meta, versionRange);
    const info = meta.versions[version];
    if (!info) throw new Error(`Version ${version} missing from metadata`);

    const destBase = path.join(targetAlpDir, 'packages', pkgName.replace(/[^a-zA-Z0-9-]/g, '_'));
    fs.mkdirSync(destBase, { recursive: true });

    const pkgBase = this.resolveBaseUrl(pkgName);
    const fileUrl = info.url.startsWith('http') ? info.url : `${pkgBase}${info.url}`;
    const entryName = decodeURIComponent(fileUrl.split('/').pop() || 'plugin.alp');
    const r = await request(fileUrl, this.authHeader(pkgBase));
    if (r.status !== 200) throw new Error(`Failed to download ${entryName} (${r.status})`);

    // v4.2/v4.3: signature verification against a configured trust root, shared
    // with the local store via `RegistryStore.verifyVersionSignature`. An
    // explicit --key PEM overrides the namespace trust root. The entryHash is
    // taken from the declared integrity (the server hasher), so remote and
    // local verification use the exact same canonical payload.
    const explicitTrustPem = trustedKey ? resolvePublicKey(trustedKey) : undefined;
    const vresult = RegistryStore.verifyVersionSignature(pkgName, version, info, this.config.trustedKeys, explicitTrustPem);
    if (explicitTrustPem || this.resolveTrustEntry(pkgName)) {
      if (!vresult.signed) throw new Error(`Package ${pkgName}@${version} is not signed; trust root requires signatures`);
      if (!vresult.trusted) throw new Error(`Signature for ${pkgName}@${version} is not from a trusted key`);
      if (!vresult.valid) throw new Error(`Signature verification failed for ${pkgName}@${version}`);
    }

    if (info.integrity) {
      const actual = 'sha256:' + crypto.createHash('sha256').update(r.body).digest('hex');
      if (actual !== info.integrity) throw new Error(`Integrity mismatch for ${pkgName}@${version}`);
    }
    fs.writeFileSync(path.join(destBase, entryName), r.body);
    fs.writeFileSync(path.join(destBase, 'alp-package.json'), JSON.stringify({ ...meta, version, _installed: new Date().toISOString() }, null, 2));
    this.writeLock(targetAlpDir, pkgName, version, info.integrity || null);
    return path.join(destBase, entryName);
  }

  /**
   * Verify a remote package version's signature without downloading the entry
   * (v4.4). Fetches `meta.json`, resolves the version, and runs the shared
   * `RegistryStore.verifyVersionSignature` against the remote `PackageVersionInfo`
   * (`info.integrity` supplies the canonical entryHash). When `explicitTrustPem`
   * is given it overrides the `.alprc` namespace trust root. The result mirrors
   * `alp registry verify` for the local store so remote and local checks agree.
   */
  async verifyRemote(pkgName: string, versionRange = 'latest', explicitTrustPem?: string): Promise<{ name: string; version: string; signed: boolean; trusted: boolean; valid: boolean; reason?: string }> {
    const meta = await this.getMeta(pkgName);
    const version = this.resolveVersion(meta, versionRange);
    const info = meta.versions[version];
    if (!info) throw new Error(`Version ${version} missing from metadata for ${pkgName}`);
    return RegistryStore.verifyVersionSignature(pkgName, version, info, this.config.trustedKeys, explicitTrustPem);
  }

  /** Append/refresh a pinned entry in `<alpDir>/registry.lock.json`. */
  writeLock(alpDir: string, pkgName: string, version: string, integrity: string | null) {
    const lockPath = path.join(alpDir, 'registry.lock.json');
    let lock: Record<string, { version: string; integrity: string | null }> = {};
    if (fs.existsSync(lockPath)) {
      try { lock = JSON.parse(fs.readFileSync(lockPath, 'utf-8')); } catch { lock = {}; }
    }
    lock[pkgName] = { version, integrity };
    fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2));
  }

  /** Bearer token for a given namespace, if configured (§4.2, per-namespace). */
  private authHeaderForNs(pkgName: string): Record<string, string> {
    const ns = pkgName.replace(/^@/, '').split('/')[0];
    const base = this.resolveBaseUrl(pkgName);
    const cfg = this.config.auth || {};
    const token = this.inlineToken || cfg['@' + ns]?.token || cfg[ns]?.token || cfg[base]?.token;
    const expanded = token ? expandEnv(token) : '';
    return expanded ? { Authorization: `Bearer ${expanded}` } : {};
  }

  /**
   * Resolve the configured trust root for a package namespace from `.alprc`
   * `trustedKeys` (§4.3): an `@ns` entry wins, then the global `*`. The value
   * is either an inline PEM public key or a fingerprint (`alp1...`); either is
   * accepted by `isTrusted`. Returns undefined when no trust root is set.
   */
  resolveTrustEntry(pkgName: string): string | undefined {
    const ns = pkgName.replace(/^@/, '').split('/')[0];
    const tk = this.config.trustedKeys || {};
    const raw = tk['@' + ns] || tk[ns] || tk['*'];
    return raw ? expandEnv(raw) : undefined;
  }

  /** True when `sig` is covered by the namespace's configured trust root. */
  isTrusted(pkgName: string, sig: Signature): boolean {
    const entry = this.resolveTrustEntry(pkgName);
    if (!entry) return false;
    // Fingerprint form: the signer's key fingerprint must match the trust root.
    if (entry.startsWith('alp1')) return fingerprint(sig.key) === entry;
    // Inline PEM form: the signature's signer key must equal the trust root.
    return entry.trim() === sig.key.trim();
  }

  /** Publish a package to a remote registry host (registry hardening, PUT).
   *  When `signerKey` (PEM Ed25519 private key) is provided, the version is
   *  signed and the detached signature travels with the publish body (v4.1). */
  async publish(pkgDir: string, signerKey?: string): Promise<any> {
    const manifestPath = path.join(pkgDir, 'alp-package.json');
    if (!fs.existsSync(manifestPath)) throw new Error(`Cannot publish: no alp-package.json in ${pkgDir}`);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string' || !Array.isArray(manifest.files)) {
      throw new Error('alp-package.json must declare name, version, and files[]');
    }
    const [ns] = manifest.name.replace(/^@/, '').split('/');
    const [, ...rest] = manifest.name.replace(/^@/, '').split('/');
    const name = rest.join('/') || ns;
    const files = manifest.files.map((f: string) => ({
      path: f,
      content: fs.readFileSync(path.join(pkgDir, f), 'utf-8'),
    }));

    // Sign the canonical payload (entry hash) before sending, if a key is set.
    const entry = manifest.entry || manifest.files[0];
    const entryHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(pkgDir, entry))).digest('hex');
    const signature = signerKey
      ? sign(signerKey, signingPayload({ name: manifest.name, version: manifest.version, entry, entryHash, dependencies: manifest.dependencies || {} }))
      : undefined;

    const base = this.resolveBaseUrl(manifest.name);
    const payload = JSON.stringify({ ...manifest, files, signature });
    const r = await request(`${base}/api/registry/-/${encodeURIComponent(ns)}/${encodeURIComponent(name)}`, {
      ...this.authHeaderForNs(manifest.name),
      'Content-Type': 'application/json',
    }, 'PUT', payload);
    if (r.status !== 201 && r.status !== 200) {
      let msg = `publish failed (${r.status})`;
      try { msg = JSON.parse(r.body.toString('utf-8'))?.error || msg; } catch {}
      throw new Error(msg);
    }
    return JSON.parse(r.body.toString('utf-8'));
  }

  /** The registry used for unscoped calls (list/search): `.alprc` default or constructor base. */
  private defaultBase(): string {
    return this.config.registries?.default || this.baseUrl;
  }

  /** List all packages in the registry (marketplace). */
  async list(): Promise<any[]> {
    const base = this.defaultBase();
    const r = await request(`${base}/api/registry`, this.authHeader(base));
    if (r.status !== 200) throw new Error(`Registry list failed (${r.status})`);
    return JSON.parse(r.body.toString('utf-8'));
  }

  /** Search packages in the registry by substring. */
  async search(query: string): Promise<any[]> {
    const base = this.defaultBase();
    const r = await request(`${base}/api/registry?q=${encodeURIComponent(query)}`, this.authHeader(base));
    if (r.status !== 200) throw new Error(`Registry search failed (${r.status})`);
    return JSON.parse(r.body.toString('utf-8'));
  }
}

// ─── Semver helpers (zero-dependency) ──────────────────────────────────────

function parseVersion(v: string): [number, number, number, string] {
  // Strip a leading "v" and split off any pre-release/build metadata.
  const [core, pre = ''] = v.replace(/^v/, '').split('-');
  const parts = core.split('.').map((n) => parseInt(n, 10) || 0);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0, pre];
}

/** Compare two semver strings. Returns <0, 0, or >0. Pre-releases rank lower. */
export function semverCmp(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return Number(pa[i]) - Number(pb[i]);
  }
  // No pre-release beats a pre-release at the same version.
  if (!pa[3] && pb[3]) return 1;
  if (pa[3] && !pb[3]) return -1;
  return pa[3].localeCompare(pb[3]);
}

/** Does concrete version `v` satisfy range `range` (semver-style)? */
export function satisfies(v: string, range: string): boolean {
  range = range.trim();
  if (range === '*' || range === 'x' || range === '') return true;
  // Caret: ^1.2.3 := >=1.2.3 <2.0.0 ; ^0.2.3 := >=0.2.3 <0.3.0 ; ^0.0.3 := >=0.0.3 <0.0.4
  const caret = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range);
  if (caret) {
    const [maj, min, pat] = caret.slice(1).map(Number);
    if (semverCmp(v, range.slice(1)) < 0) return false;
    if (maj > 0) return parseVersion(v)[0] === maj;
    if (min > 0) return parseVersion(v)[0] === 0 && parseVersion(v)[1] === min;
    return parseVersion(v)[0] === 0 && parseVersion(v)[1] === 0 && parseVersion(v)[2] === pat;
  }
  // Tilde: ~1.2.3 := >=1.2.3 <1.3.0 ; ~1.2 := >=1.2.0 <1.3.0 ; ~1 := >=1.0.0 <2.0.0
  const tilde = /^~(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(range);
  if (tilde) {
    const maj = Number(tilde[1]);
    const min = tilde[2] !== undefined ? Number(tilde[2]) : null;
    if (maj > 0 || min !== null) {
      if (parseVersion(v)[0] !== maj) return false;
      if (min !== null && parseVersion(v)[1] !== min) return false;
      return semverCmp(v, `${maj}.${min ?? 0}.0`) >= 0;
    }
    return parseVersion(v)[0] === maj;
  }
  // x-range: 1.2.x, 1.x, 1.2.*, *
  const xr = /^(\d+|x|\*)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/.exec(range);
  if (xr && (range.includes('x') || range.includes('*'))) {
    const a = xr[1], b = xr[2], c = xr[3];
    if (a !== 'x' && a !== '*' && parseVersion(v)[0] !== Number(a)) return false;
    if (b !== undefined && b !== 'x' && b !== '*' && parseVersion(v)[1] !== Number(b)) return false;
    if (c !== undefined && c !== 'x' && c !== '*' && parseVersion(v)[2] !== Number(c)) return false;
    return true;
  }
  // Comparators: >=, <=, >, < (may be space- or dash-separated lists)
  if (/>=|<=|>|</.test(range)) {
    const comps = range.split(/\s+/).filter(Boolean);
    return comps.every((cmp) => {
      const m = /^(>=|<=|>|<)\s*(\d+\.\d+\.\d+)$/.exec(cmp);
      if (!m) return false;
      const op = m[1];
      const target = m[2];
      const c = semverCmp(v, target);
      if (op === '>=') return c >= 0;
      if (op === '<=') return c <= 0;
      if (op === '>') return c > 0;
      return c < 0;
    });
  }
  // Exact match (already handled by caller, but be safe).
  return semverCmp(v, range) === 0;
}
