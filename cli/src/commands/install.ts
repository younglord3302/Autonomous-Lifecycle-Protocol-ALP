import * as fs from 'fs';
import * as path from 'path';
import { RegistryClient } from '../registry';

/**
 * `alp install` — Installs a package from the ALP registry (v4 Pillar 3).
 *
 * Resolves the package against a hosted registry (default
 * `http://127.0.0.1:4000`, overridable via `--url`/ALP_REGISTRY_URL),
 * verifies integrity, and writes it into `.alp/packages/<name>/`.
 */
export function installCommand(pkgName: string, options?: { url?: string; version?: string }) {
  const alpDir = path.resolve(process.cwd(), '.alp');
  if (!fs.existsSync(alpDir)) {
    console.error('Error: .alp directory not found. Run `alp init` first.');
    process.exit(1);
  }
  const url = options?.url || process.env.ALP_REGISTRY_URL || 'http://127.0.0.1:4000';
  const client = new RegistryClient(url);
  // Support both "@ns/name@version" and "name@version".
  const body = pkgName.startsWith('@') ? pkgName.slice(1) : pkgName;
  const at = body.lastIndexOf('@');
  const name = at > 0 ? `@${body.slice(0, at)}` : (at === 0 ? body : pkgName);
  const ver = at > 0 ? body.slice(at + 1) : (options?.version || 'latest');
  client.install(name, alpDir, ver)
    .then((p) => console.log(`✅ Installed ${name}@${ver} -> ${p}`))
    .catch((err: any) => { console.error(`❌ ${err.message}`); process.exit(1); });
}
