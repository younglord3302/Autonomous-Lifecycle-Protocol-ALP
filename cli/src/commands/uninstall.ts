import * as fs from 'fs';
import * as path from 'path';
import { RegistryClient } from '../registry';

export function uninstallCommand(pkgName: string) {
  const alpDir = path.resolve(process.cwd(), '.alp');
  if (!fs.existsSync(alpDir)) {
    console.error('Error: .alp directory not found. Run `alp init` first.');
    process.exit(1);
  }

  const registry = new RegistryClient();
  registry.uninstall(pkgName).then(() => {
     // success
  }).catch(err => {
     console.error(err);
  });
}
