import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'node:crypto';
import { sign, verify, signingPayload, resolvePublicKey, fingerprint, Signature } from './signing';

/**
 * ALP Registry Store (v4 — The Federation Era, Pillar 3: Hosted Registry)
 *
 * A zero-dependency, filesystem-backed package store. Packages live under
 * `<root>/registry/packages/<namespace>/<name>/<version>/` alongside an
 * `alp-package.json` manifest. The store powers both a local marketplace
 * (`alp registry list/search`) and a hosted HTTP registry (`alp serve
 * --registry` -> `/api/registry/*`), conforming to the Plugin Registry
 * Protocol in spec/14-plugin-registry.md.
 */

export interface PackageVersionInfo {
  url: string; // served download URL
  integrity: string; // sha256:...
  dependencies: Record<string, string>;
  size: number;
  entry?: string; // entry file name
  files?: string[]; // declared file names
  signature?: Signature; // Ed25519 signature + signer public key (v4.1)
}

export interface PackageMeta {
  name: string; // @namespace/name
  description: string;
  author?: string;
  tags: Record<string, string>;
  versions: Record<string, PackageVersionInfo>;
}

function sha256File(p: string): string {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(p));
  return 'sha256:' + h.digest('hex');
}

export class RegistryStore {
  readonly root: string;
  /** Trust roots for server-side signature enforcement (§4.3). Maps a
   *  namespace (`@ns`) or `*` to a fingerprint (`alp1…`) or inline PEM. When a
   *  namespace has a trust root, uploads MUST carry a signature trusted by it. */
  readonly trustRoots?: Record<string, string>;

  constructor(rootDir: string, trustRoots?: Record<string, string>) {
    // rootDir is the workspace; packages live in .alp/registry.
    this.root = path.join(rootDir, '.alp', 'registry');
    this.trustRoots = trustRoots;
  }

  /** Resolve the configured trust root for a namespace (`@ns`, then `*`). */
  private trustEntry(ns: string): string | undefined {
    const tk = this.trustRoots || {};
    return tk['@' + ns] || tk[ns] || tk['*'];
  }

  /** True when `sig` is covered by the namespace's configured trust root. */
  isTrusted(ns: string, sig: Signature): boolean {
    const entry = this.trustEntry(ns);
    if (!entry) return false;
    if (entry.startsWith('alp1')) return fingerprint(sig.key) === entry;
    return entry.trim() === sig.key.trim();
  }

  private pkgRoot(ns: string, name: string, version: string) {
    return path.join(this.root, 'packages', ns, name, version);
  }

  /**
   * Publish a package from a remote publish request (registry hardening).
   * `body` carries the manifest plus the file contents inline so the server
   * needs no shared filesystem with the publisher:
   *   { name, version, description?, author?, dependencies?, entry?, files: [{ path, content }], signature? }
   * `routeNs` is the namespace from the PUT URL; it MUST match the manifest's.
   * `signer` (optional PEM private key) signs the stored version on the host.
   */
  publishFromRequest(body: any, routeNs: string, signer?: string): PackageMeta {
    if (!body || typeof body !== 'object') throw new Error('publish body must be a JSON object');
    const name = body.name;
    const version = body.version;
    const files = body.files;
    if (!name || !version || !Array.isArray(files) || !files.length) {
      throw new Error('publish requires name, version, and a non-empty files[]');
    }
    const [ns, ...rest] = String(name).replace(/^@/, '').split('/');
    const manifestName = rest.join('/') || ns;
    if (ns !== routeNs) {
      throw new Error(`namespace mismatch: route is @${routeNs} but manifest declares @${ns}/${manifestName}`);
    }
    // v4.4: server-side trust-root enforcement (§4.3). When the namespace has a
    // configured trust root, the upload MUST carry a signature trusted by it.
    const trust = this.trustEntry(ns);
    const sig = body.signature as Signature | undefined;
    if (trust && !sig) {
      throw new Error(`Package @${ns}/${manifestName}@${version} is not signed; namespace trust root requires signatures`);
    }
    if (trust && sig && !this.isTrusted(ns, sig)) {
      throw new Error(`Signature for @${ns}/${manifestName}@${version} is not from a trusted key`);
    }
    const dir = this.pkgRoot(ns, manifestName, version);
    fs.mkdirSync(dir, { recursive: true });

    const written: string[] = [];
    for (const f of files) {
      if (!f || typeof f.path !== 'string' || typeof f.content !== 'string') {
        throw new Error('each file must be { path, content }');
      }
      // Reject path traversal outside the version directory.
      const dest = path.resolve(dir, f.path);
      if (!dest.startsWith(path.resolve(dir))) throw new Error(`invalid file path: ${f.path}`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, f.content);
      written.push(f.path);
    }

    const manifest = {
      name,
      version,
      description: body.description || '',
      author: body.author,
      dependencies: body.dependencies || {},
      files: written,
      entry: body.entry || written[0],
    };
    fs.writeFileSync(path.join(dir, 'alp-package.json'), JSON.stringify(manifest, null, 2));

    // Reuse local publish to compute integrity + meta.json. The publisher may
    // supply a detached `signature` (verified by the client), or the host may
    // sign with its own `signer` key.
    const meta = this.publish(dir, signer);
    if (body.signature && !signer) {
      const vmPath = path.join(dir, 'version.json');
      const vm = JSON.parse(fs.readFileSync(vmPath, 'utf-8'));
      vm.signature = body.signature;
      fs.writeFileSync(vmPath, JSON.stringify(vm, null, 2));
    }
    return meta;
  }

  /**
   * Publish a package from a directory containing alp-package.json. When
   * `signer` (a PEM Ed25519 private key) is provided, the version is signed
   * (v4.1 — registry trust).
   */
  publish(pkgDir: string, signer?: string): PackageMeta {
    const manifestPath = path.join(pkgDir, 'alp-package.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Cannot publish: no alp-package.json in ${pkgDir}`);
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
      name: string; version: string; description?: string; author?: string; dependencies?: Record<string, string>; files: string[]; entry?: string;
    };
    if (!manifest.name || !manifest.version || !Array.isArray(manifest.files)) {
      throw new Error('alp-package.json must declare name, version, and files[]');
    }
    const [ns, ...rest] = manifest.name.replace(/^@/, '').split('/');
    const name = rest.join('/') || ns;
    const dir = this.pkgRoot(ns, name, manifest.version);
    fs.mkdirSync(dir, { recursive: true });

    const deps: Record<string, string> = {};
    for (const f of manifest.files) {
      const src = path.join(pkgDir, f);
      if (!fs.existsSync(src)) throw new Error(`Declared file does not exist: ${f}`);
      const dest = path.join(dir, f);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }

    const entry = manifest.entry || manifest.files[0];
    const entryPath = path.join(dir, entry);
    const integrity = fs.existsSync(entryPath) ? sha256File(entryPath) : '';
    const size = fs.existsSync(entryPath) ? fs.statSync(entryPath).size : 0;

    const versionMeta: PackageVersionInfo = {
      url: `/api/registry/-/${ns}/${name}/${manifest.version}/${encodeURIComponent(entry)}`,
      integrity,
      dependencies: manifest.dependencies || {},
      size,
      entry,
      files: manifest.files,
    };
    if (signer) {
      const entrySha = integrity ? integrity.slice('sha256:'.length) : '';
      versionMeta.signature = sign(
        signer,
        signingPayload({ name: manifest.name, version: manifest.version, entry, entryHash: entrySha, dependencies: manifest.dependencies || {} }),
      );
    }
    fs.writeFileSync(path.join(dir, 'version.json'), JSON.stringify(versionMeta, null, 2));

    return this.getMeta(manifest.name)!;
  }

  /** Build the full meta.json for a package (all versions). */
  getMeta(fullName: string): PackageMeta | null {
    const [ns, ...rest] = fullName.replace(/^@/, '').split('/');
    const name = rest.join('/') || ns;
    const base = path.join(this.root, 'packages', ns, name);
    if (!fs.existsSync(base)) return null;
    const versions: Record<string, PackageVersionInfo> = {};
    const tags: Record<string, string> = {};
    for (const ver of fs.readdirSync(base)) {
      const vmPath = path.join(base, ver, 'version.json');
      if (fs.existsSync(vmPath)) {
        versions[ver] = JSON.parse(fs.readFileSync(vmPath, 'utf-8'));
      }
    }
    if (Object.keys(versions).length === 0) return null;
    // Mark the highest semver as "latest".
    const sorted = Object.keys(versions).sort(semverCmp);
    if (sorted.length) tags['latest'] = sorted[sorted.length - 1];

    const manifestPath = path.join(base, sorted[sorted.length - 1], 'alp-package.json');
    let description = '';
    let author: string | undefined;
    if (fs.existsSync(manifestPath)) {
      const m = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      description = m.description || '';
      author = m.author;
    }
    return { name: fullName, description, author, tags, versions };
  }

  /**
   * Verify a stored version's signature against this store's trust roots
   * (v4.4). Returns a structured result for `alp registry verify` without
   * installing. `signed` is whether the version carries a signature; `trusted`
   * is whether it is covered by a configured trust root; `valid` is whether the
   * cryptographic signature checks out against the signer key embedded in it.
   */
  verifyPackage(fullName: string, version: string): { name: string; version: string; signed: boolean; trusted: boolean; valid: boolean; reason?: string } {
    const meta = this.getMeta(fullName);
    if (!meta) return { name: fullName, version, signed: false, trusted: false, valid: false, reason: 'package not found' };
    const info = meta.versions[version];
    if (!info) return { name: fullName, version, signed: false, trusted: false, valid: false, reason: 'version not found' };
    const sig = info.signature as Signature | undefined;
    if (!sig) {
      const required = !!this.trustEntry(fullName.replace(/^@/, '').split('/')[0]);
      return { name: fullName, version, signed: false, trusted: false, valid: false, reason: required ? 'trust root requires a signature' : 'package is unsigned (no trust root configured)' };
    }
    const entry = info.entry || (info.files && info.files[0]) || '';
    const [vns, ...vrest] = fullName.replace(/^@/, '').split('/');
    const vname = vrest.join('/') || vns;
    const entryPath = path.join(this.pkgRoot(vns, vname, version), entry);
    const entryHash = fs.existsSync(entryPath) ? sha256File(entryPath).slice('sha256:'.length) : '';
    const payload = signingPayload({ name: fullName, version, entry, entryHash, dependencies: info.dependencies });
    const valid = verify(resolvePublicKey(sig.key), payload, sig);
    const trusted = this.isTrusted(fullName.replace(/^@/, '').split('/')[0], sig);
    return { name: fullName, version, signed: true, trusted, valid, reason: valid ? (trusted ? 'signature valid and trusted' : 'signature valid but signer not in trust root') : 'signature invalid' };
  }

  /** Read a package file by version + relative path. */
  readFile(fullName: string, version: string, relPath: string): Buffer | null {
    const [ns, ...rest] = fullName.replace(/^@/, '').split('/');
    const name = rest.join('/') || ns;
    const p = path.join(this.root, 'packages', ns, name, version, relPath);
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p);
  }

  /** List every published package's meta. */
  list(): PackageMeta[] {
    const out: PackageMeta[] = [];
    const pkgs = path.join(this.root, 'packages');
    if (!fs.existsSync(pkgs)) return out;
    for (const ns of fs.readdirSync(pkgs)) {
      const nsDir = path.join(pkgs, ns);
      for (const name of fs.readdirSync(nsDir)) {
        const meta = this.getMeta(`@${ns}/${name}`);
        if (meta) out.push(meta);
      }
    }
    return out;
  }

  /** Simple case-insensitive substring search over name + description. */
  search(query: string): PackageMeta[] {
    const q = query.toLowerCase();
    return this.list().filter(
      (m) => m.name.toLowerCase().includes(q) || m.description.toLowerCase().includes(q),
    );
  }
}

function semverCmp(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}
