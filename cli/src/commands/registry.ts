import * as fs from 'fs';
import * as path from 'path';
import { RegistryStore } from '../registry-store';
import { RegistryClient } from '../registry';

/**
 * `alp registry` — V4 Pillar 3: Hosted Registry & Marketplace.
 *
 * Manages packages in the ALP registry: serve a registry over HTTP, publish
 * local packages, and list/search/install from a running registry. When no
 * `--registry` URL is given, commands operate against the local store under
 * `.alp/registry`.
 */

export async function registryCommand(sub: string | undefined, target: string | undefined, options?: { url?: string; version?: string; token?: string }) {
  const cwd = process.cwd();
  const url = options?.url || process.env.ALP_REGISTRY_URL || 'http://127.0.0.1:4000';
  const token = options?.token || process.env.ALP_REGISTRY_TOKEN;
  const client = new RegistryClient(url, undefined, token);
  const subcmd = sub || 'list';

  switch (subcmd) {
    case 'serve': {
      // Reuse `alp serve --registry` semantics via a child-friendly hint.
      console.log('Start a registry host with:  alp serve --registry');
      console.log('(Add --db for persistent analytics.)');
      return;
    }
    case 'publish': {
      const dir = path.resolve(cwd, target || '.');
      try {
        if (options?.url) {
          const meta = await client.publish(dir);
          console.log(`📦 Published ${meta.name}@${meta.tags?.latest ?? ''} to ${url}`);
          console.log(`   (requires the namespace token on the host — see spec/14 §4.2)`);
        } else {
          const store = new RegistryStore(cwd);
          const meta = store.publish(dir);
          console.log(`📦 Published ${meta.name} — ${Object.keys(meta.versions).length} version(s).`);
          console.log(`   Serve it with: alp serve --registry`);
        }
      } catch (e: any) {
        console.error(`❌ ${e.message}`);
        process.exit(1);
      }
      return;
    }
    case 'list': {
      if (options?.url) {
        const pkgs = await client.list();
        if (!pkgs.length) { console.log('Registry is empty.'); return; }
        console.log(`${pkgs.length} package(s):`);
        for (const p of pkgs) console.log(`  • ${p.name}  (${Object.keys(p.versions).join(', ')})  ${p.description}`);
      } else {
        const store = new RegistryStore(cwd);
        const pkgs = store.list();
        if (!pkgs.length) { console.log('No packages in the local registry. Publish one with `alp registry publish <dir>`.'); return; }
        console.log(`${pkgs.length} package(s):`);
        for (const p of pkgs) console.log(`  • ${p.name}  (${Object.keys(p.versions).join(', ')})  ${p.description}`);
      }
      return;
    }
    case 'search': {
      if (!target) { console.error('Usage: alp registry search <query>'); process.exit(1); }
      if (options?.url) {
        const hits = await client.search(target);
        if (!hits.length) { console.log(`No packages match "${target}".`); return; }
        for (const p of hits) console.log(`  • ${p.name}  ${p.description}`);
      } else {
        const store = new RegistryStore(cwd);
        const hits = store.search(target);
        if (!hits.length) { console.log(`No packages match "${target}".`); return; }
        for (const p of hits) console.log(`  • ${p.name}  ${p.description}`);
      }
      return;
    }
    case 'install': {
      if (!target) { console.error('Usage: alp registry install <name>[@version]'); process.exit(1); }
      const at = target.lastIndexOf('@');
      const name = at > 0 ? target.slice(0, at) : target;
      const ver = at > 0 ? target.slice(at + 1) : 'latest';
      const alpDir = path.resolve(cwd, '.alp');
      try {
        const installed = await client.install(name, alpDir, ver || 'latest');
        console.log(`✅ Installed ${name}@${ver || 'latest'} -> ${installed}`);
      } catch (e: any) {
        console.error(`❌ ${e.message}`);
        process.exit(1);
      }
      return;
    }
    default:
      console.error(`Unknown registry subcommand: ${subcmd}. Use serve | publish | list | search | install.`);
      process.exit(1);
  }
}

