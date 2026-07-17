import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'node:crypto';
import * as http from 'node:http';
import * as https from 'node:https';

/**
 * ALP Registry Client (v4 — The Federation Era, Pillar 3)
 *
 * Talks to a hosted ALP registry (an `alp serve --registry` instance) over the
 * HTTP protocol in spec/14-plugin-registry.md. Resolves `meta.json`, downloads
 * package files, and verifies integrity. Falls back to a local registry store
 * path when no remote is configured.
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
 */
export interface AlprcConfig {
  registries?: Record<string, string>;
  auth?: Record<string, { token?: string }>;
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

function request(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    // §5.1: registry communication MUST be over HTTPS. Allow plain HTTP only
    // for loopback addresses so local `alp serve --registry` works in dev.
    if (u.protocol !== 'https:' && !LOCALHOST.test(u.hostname)) {
      return reject(new Error(`Refusing to use insecure registry over plain HTTP: ${url} (use https://)`));
    }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(u, { headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c as Buffer));
      res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
  });
}

export class RegistryClient {
  constructor(
    private baseUrl: string = process.env.ALP_REGISTRY_URL || 'http://127.0.0.1:4000',
    private config: AlprcConfig = loadAlprc(),
  ) {}

  /** Resolve the registry base URL for a package, honoring `.alprc` namespace routing (§4.1). */
  resolveBaseUrl(pkgName: string): string {
    const ns = pkgName.replace(/^@/, '').split('/')[0];
    const mapped = this.config.registries?.[`@${ns}`] || this.config.registries?.[ns];
    return mapped || this.config.registries?.default || this.baseUrl;
  }

  /** Bearer token for the base URL, if configured (§4.2). */
  private authHeader(baseUrl: string): Record<string, string> {
    const token = this.config.auth?.[baseUrl]?.token;
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

  /** Download a package version into `<alpDir>/packages/<name>/`. */
  async install(pkgName: string, targetAlpDir: string, versionRange = 'latest'): Promise<string> {
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
    if (info.integrity) {
      const actual = 'sha256:' + crypto.createHash('sha256').update(r.body).digest('hex');
      if (actual !== info.integrity) throw new Error(`Integrity mismatch for ${pkgName}@${version}`);
    }
    fs.writeFileSync(path.join(destBase, entryName), r.body);
    fs.writeFileSync(path.join(destBase, 'alp-package.json'), JSON.stringify({ ...meta, version, _installed: new Date().toISOString() }, null, 2));
    this.writeLock(targetAlpDir, pkgName, version, info.integrity || null);
    return path.join(destBase, entryName);
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
