import * as path from 'path';
import { RegistryClient } from '../registry';
import { RegistryStore } from '../registry-store';

/**
 * `alp publish` — Publishes a package to the ALP registry (v4 Pillar 3).
 *
 * Reads `alp-package.json` from the target directory, validates declared
 * files, and stores them under `.alp/registry/packages/<ns>/<name>/<version>/`
 * (local) or pushes them to a remote `alp serve --registry` host when `--url`
 * is given. Remote publish is gated by the namespace's bearer token
 * (spec/14 §4.2, registry hardening).
 */
export async function publishCommand(pkgDir: string, options?: { url?: string }) {
  const absoluteDir = path.resolve(process.cwd(), pkgDir);
  try {
    if (options?.url) {
      const client = new RegistryClient(options.url);
      const meta = await client.publish(absoluteDir);
      console.log(`📦 Published ${meta.name}@${meta.tags?.latest ?? ''} to ${options.url}`);
    } else {
      const store = new RegistryStore(process.cwd());
      const meta = store.publish(absoluteDir);
      console.log(`📦 Published ${meta.name} — ${Object.keys(meta.versions).length} version(s).`);
      console.log(`   Serve it with: alp serve --registry`);
    }
  } catch (err: any) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }
}
