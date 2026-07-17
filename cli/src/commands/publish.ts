import * as path from 'path';
import { RegistryClient } from '../registry';
import { RegistryStore } from '../registry-store';

/**
 * `alp publish` — Publishes a package to the local ALP registry (v4 Pillar 3).
 *
 * Reads `alp-package.json` from the target directory, validates declared
 * files, and stores them under `.alp/registry/packages/<ns>/<name>/<version>/`.
 * To make the package discoverable, serve it with `alp serve --registry`.
 */
export function publishCommand(pkgDir: string) {
  const absoluteDir = path.resolve(process.cwd(), pkgDir);
  const store = new RegistryStore(process.cwd());
  try {
    const meta = store.publish(absoluteDir);
    console.log(`📦 Published ${meta.name} — ${Object.keys(meta.versions).length} version(s).`);
    console.log(`   Serve it with: alp serve --registry`);
  } catch (err: any) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }
}
