import * as fs from 'fs';
import * as path from 'path';
import { RegistryClient } from '../registry';

/**
 * `alp install` — The ALP Package Registry Installer.
 *
 * Scaffolding for Pillar 5. This command simulates fetching a community
 * ALP package (e.g., an agent definition or workflow template) and
 * installing it into the current workspace.
 */
export function installCommand(pkgName: string) {
  const alpDir = path.resolve(process.cwd(), '.alp');
  if (!fs.existsSync(alpDir)) {
    console.error('Error: .alp directory not found. Run `alp init` first.');
    process.exit(1);
  }

  console.log(`\n📦 Fetching ${pkgName} from the ALP Registry...`);
  
  const registry = new RegistryClient();
  registry.install(pkgName).then(() => {
     // success
  }).catch(err => {
     console.error(err);
  });
}
