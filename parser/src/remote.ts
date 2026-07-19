import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { SyntaxError } from './error';

/**
 * Remote import support for the Plugin System (v6.5.0 — spec/11 §3.2–3.5).
 *
 * Fetches `.alp` plugin files over HTTPS, caches them under
 * `.alp/.cache/remote/<sha256-of-url>/` with a 24h TTL (stale-on-error),
 * and optionally verifies a `!integrity: sha256:...` hash. Registry alias
 * imports (`@ns/name@version`, §3.5) are resolved to a registry URL and
 * fetched through the same path.
 */

export interface FetchOptions {
  /** When true, ignore TTL and re-download (mirrors `--refresh-cache`). */
  refresh?: boolean;
  /** Optional declared integrity, e.g. "sha256:<hex>". */
  integrity?: string;
  /** Max download size in bytes (default 1 MB). */
  maxBytes?: number;
  /** Network timeout in ms (default 30_000). */
  timeoutMs?: number;
  /** Base URL for resolving `@ns/name@version` registry aliases. */
  registryBase?: string;
  /** Injected transport for testing (defaults to real http/https). */
  transport?: (url: string) => Promise<{ status: number; body: string; etag?: string }>;
}

const DEFAULT_MAX_BYTES = 1_000_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_TTL_SECONDS = 86_400; // 24h
const DEFAULT_REGISTRY = 'https://registry.alp-protocol.org';

export interface CacheMeta {
  url: string;
  fetched_at: string;
  etag?: string;
  content_hash: string;
  ttl_seconds: number;
}

export class RemoteFetcher {
  /** Directory used for the on-disk cache (`.alp/.cache/remote`). */
  public cacheDir: string;

  constructor(cacheRoot: string) {
    this.cacheDir = path.join(cacheRoot, '.alp', '.cache', 'remote');
  }

  /**
   * Resolve an `!import` target (https URL or `@ns/name@version` alias)
   * to raw `.alp` content, using the cache when valid.
   */
  public async fetchImport(target: string, opts: FetchOptions = {}): Promise<string> {
    const url = this.resolveAlias(target, opts.registryBase ?? DEFAULT_REGISTRY);
    if (!/^https:\/\//.test(url)) {
      throw new SyntaxError(`Only https imports are allowed: '${target}'`);
    }
    if (!/\.alp($|\?)/.test(url)) {
      throw new SyntaxError(`Remote import must end in .alp: '${target}'`);
    }
    return this.fetchWithCache(url, opts);
  }

  /** Turn a registry alias (`@ns/name@version`) into a concrete URL. */
  public resolveAlias(alias: string, registryBase: string): string {
    const m = alias.match(/^@([^/]+)\/([^@]+)@(.+)$/);
    if (!m) return alias;
    const [, ns, name, version] = m;
    return `${registryBase.replace(/\/$/, '')}/plugins/${ns}/${name}/${version}/plugin.alp`;
  }

  private cacheKey(url: string): string {
    return crypto.createHash('sha256').update(url).digest('hex');
  }

  private cachePath(url: string): { dir: string; file: string; meta: string } {
    const key = this.cacheKey(url);
    const dir = path.join(this.cacheDir, key);
    return { dir, file: path.join(dir, 'plugin.alp'), meta: path.join(dir, 'metadata.json') };
  }

  private loadCache(url: string): { content: string; meta: CacheMeta } | null {
    const { file, meta } = this.cachePath(url);
    if (!fs.existsSync(file) || !fs.existsSync(meta)) return null;
    try {
      const metaObj = JSON.parse(fs.readFileSync(meta, 'utf8')) as CacheMeta;
      const ageSeconds = (Date.now() - new Date(metaObj.fetched_at).getTime()) / 1000;
      if (ageSeconds > metaObj.ttl_seconds) return null;
      return { content: fs.readFileSync(file, 'utf8'), meta: metaObj };
    } catch {
      return null;
    }
  }

  private saveCache(url: string, content: string, etag?: string): void {
    const { dir, file, meta } = this.cachePath(url);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
    const metaObj: CacheMeta = {
      url,
      fetched_at: new Date().toISOString(),
      etag,
      content_hash: 'sha256:' + crypto.createHash('sha256').update(content).digest('hex'),
      ttl_seconds: DEFAULT_TTL_SECONDS,
    };
    fs.writeFileSync(meta, JSON.stringify(metaObj, null, 2), 'utf8');
  }

  private verifyIntegrity(content: string, integrity?: string): void {
    if (!integrity) return;
    const m = integrity.match(/^sha256:(.+)$/i);
    if (!m) throw new SyntaxError(`Unsupported integrity algorithm: '${integrity}'`);
    const actual = crypto.createHash('sha256').update(content).digest('hex');
    if (actual.toLowerCase() !== m[1].toLowerCase()) {
      throw new SyntaxError(`Integrity mismatch for remote import (expected ${m[1]}, got ${actual})`);
    }
  }

  private async fetchWithCache(url: string, opts: FetchOptions): Promise<string> {
    const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    if (!opts.refresh) {
      const cached = this.loadCache(url);
      if (cached) {
        this.verifyIntegrity(cached.content, opts.integrity);
        return cached.content;
      }
    }

    const transport = opts.transport ?? defaultTransport;
    let res;
    try {
      res = await withTimeout(transport(url), timeoutMs);
    } catch (err) {
      // Offline / network failure: fall back to stale cache if available.
      const stale = this.loadCacheForce(url);
      if (stale) return stale;
      throw new SyntaxError(`Failed to fetch remote import '${url}': ${(err as Error).message}`);
    }

    if (res.status >= 400) {
      const stale = this.loadCacheForce(url);
      if (stale) return stale;
      throw new SyntaxError(`Remote import returned HTTP ${res.status}: '${url}'`);
    }

    let content = res.body;
    if (Buffer.byteLength(content) > maxBytes) {
      throw new SyntaxError(`Remote import exceeds size limit (${(maxBytes / 1e6).toFixed(1)} MB): '${url}'`);
    }

    this.verifyIntegrity(content, opts.integrity);
    this.saveCache(url, content, res.etag);
    return content;
  }

  /** Load cache entry regardless of TTL (used for stale fallback). */
  private loadCacheForce(url: string): string | null {
    const { file } = this.cachePath(url);
    if (!fs.existsSync(file)) return null;
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  }
}

async function defaultTransport(url: string): Promise<{ status: number; body: string; etag?: string }> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (c: Buffer) => {
        size += c.length;
        if (size > 2_000_000) {
          req.destroy();
          reject(new Error('response too large'));
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 502,
          body: Buffer.concat(chunks).toString('utf8'),
          etag: res.headers['etag'] as string | undefined,
        });
      });
    });
    req.on('error', reject);
  });
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}
