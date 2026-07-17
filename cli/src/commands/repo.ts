import * as fs from 'fs';
import * as path from 'path';
import { ExternalResolver } from '@alp/parser';

/**
 * `alp repo` — V4 Pillar 2: Cross-Repository Orchestration.
 *
 * Discovers `@repo` declarations in the workspace, fetches Git-backed repos
 * into the local cache, and resolves `-> repo::object` references across the
 * federation. Cross-repo references are read-only by design.
 */

export function repoCommand(sub: string | undefined, options?: { fetch?: boolean }) {
  const alpRoot = path.resolve(process.cwd(), '.alp');
  if (!fs.existsSync(alpRoot)) {
    console.error('Error: .alp directory not found. Run `alp init` first.');
    process.exit(1);
  }

  const subcmd = sub || 'resolve';
  const resolver = new ExternalResolver(alpRoot);

  switch (subcmd) {
    case 'ls': {
      const repos = resolver.discover();
      if (repos.length === 0) { console.log('No @repo declarations found in this workspace.'); return; }
      console.log(`Discovered ${repos.length} repo(s):`);
      for (const r of repos) {
        console.log(`  • ${r.id}  src=${r.src || '(local)'}  ${r.fetched ? '[git]' : '[local]'}`);
      }
      return;
    }
    case 'fetch': {
      const repos = resolver.discover();
      for (const r of repos) {
        if (r.fetched) {
          try { resolver.fetch(r); console.log(`✅ Fetched repo "${r.id}" -> ${r.localPath}`); }
          catch (e: any) { console.error(`❌ Failed to fetch "${r.id}": ${e.message}`); process.exit(1); }
        } else {
          console.log(`• ${r.id}: local path, nothing to fetch.`);
        }
      }
      return;
    }
    case 'resolve':
    case 'graph': {
      if (options?.fetch) {
        for (const r of resolver.discover()) {
          if (r.fetched) { try { resolver.fetch(r); } catch (e: any) { console.error(`fetch failed for ${r.id}: ${e.message}`); } }
        }
      }
      const result = resolver.resolve();
      const repoCount = result.repos.length;
      console.log(`🌐 Federation: ${repoCount} repo(s) + local workspace, ${result.objects.size} objects, ${result.references.length} cross-repo reference(s).`);

      if (subcmd === 'graph') {
        console.log('\nNodes:');
        for (const n of result.graph.nodes) console.log(`  [${n.repo}] ${n.id}  ${n.status ?? ''}`.trim());
        console.log('\nEdges:');
        for (const e of result.graph.edges) console.log(`  ${e.from} --${e.type}--> ${e.to}`);
      }

      if (result.dangling.length) {
        console.log(`\n⚠️  ${result.dangling.length} unresolved cross-repo reference(s):`);
        for (const d of result.dangling) console.log(`  • ${d.from} → ${d.raw}`);
      } else {
        console.log('\n✅ All cross-repo references resolve.');
      }
      return;
    }
    default:
      console.error(`Unknown repo subcommand: ${subcmd}. Use ls | fetch | resolve | graph.`);
      process.exit(1);
  }
}
