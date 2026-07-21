import * as fs from 'fs';
import * as path from 'path';
import { PluginResolver, PluginInfo } from '@alp/parser';

export interface PluginCommandOptions {
  url?: string;
  version?: string;
  token?: string;
  key?: string;
  signKey?: string;
}

export async function pluginCommand(sub: string | undefined, target: string | undefined, options?: PluginCommandOptions) {
  const cwd = process.cwd();
  const subcmd = sub || 'list';

  switch (subcmd) {
    case 'validate': {
      if (!target) {
        console.error('Usage: alp plugin validate <path>');
        process.exit(1);
      }
      const pluginPath = path.resolve(cwd, target);
      const resolver = new PluginResolver();
      try {
        await resolver.validate(pluginPath);
        console.log(`✅ Plugin at ${target} is valid.`);
      } catch (e: any) {
        console.error(`❌ Validation failed: ${e.message}`);
        process.exit(1);
      }
      return;
    }
    case 'lint': {
      if (!target) {
        console.error('Usage: alp plugin lint <path>');
        process.exit(1);
      }
      const pluginPath = path.resolve(cwd, target);
      const resolver = new PluginResolver();
      const warnings = resolver.lintPlugin(pluginPath);
      if (!warnings.length) {
        console.log(`✅ Plugin at ${target} passed lint.`);
      } else {
        console.log(`⚠️  Lint warnings for ${target}:`);
        for (const w of warnings) console.log(`   - ${w}`);
        process.exit(1);
      }
      return;
    }
    case 'list': {
      const resolver = new PluginResolver();
      const alpDir = path.resolve(cwd, '.alp');
      if (fs.existsSync(alpDir)) {
        const files = fs.readdirSync(alpDir).filter((f) => f.endsWith('.alp'));
        for (const file of files) {
          try {
            const content = fs.readFileSync(path.join(alpDir, file), 'utf-8');
            await resolver.parseWorkspace(content, alpDir, {}, path.join(alpDir, file));
          } catch {
            // ignore parse errors for listing
          }
        }
      }
      const plugins = resolver.listPlugins();
      if (!plugins.length) {
        console.log('No plugins loaded.');
        return;
      }
      console.log(`${plugins.length} plugin(s) loaded:`);
      for (const p of plugins) {
        const types = p.types.length ? ` (${p.types.length} type refs)` : '';
        console.log(`  • ${p.id}  v${p.version ?? '?'}  ${p.name ?? ''}${types}`);
      }
      return;
    }
    case 'reload': {
      if (!target) {
        console.error('Usage: alp plugin reload <id>');
        process.exit(1);
      }
      const alpDir = path.resolve(cwd, '.alp');
      const resolver = new PluginResolver();
      let found = false;
      if (fs.existsSync(alpDir)) {
        const files = fs.readdirSync(alpDir).filter((f) => f.endsWith('.alp'));
        for (const file of files) {
          try {
            const content = fs.readFileSync(path.join(alpDir, file), 'utf-8');
            await resolver.parseWorkspace(content, alpDir, {}, path.join(alpDir, file));
            if (resolver.plugins.has(target)) found = true;
          } catch {
            // ignore
          }
        }
      }
      if (!found) {
        console.error(`Plugin '${target}' not found in workspace.`);
        process.exit(1);
      }
      try {
        await resolver.hotReload(target);
        console.log(`✅ Hot-reloaded plugin '${target}'.`);
      } catch (e: any) {
        console.error(`❌ Hot-reload failed: ${e.message}`);
        process.exit(1);
      }
      return;
    }
    default:
      console.error(`Unknown plugin subcommand: ${subcmd}. Use validate | lint | list | reload.`);
      process.exit(1);
  }
}
