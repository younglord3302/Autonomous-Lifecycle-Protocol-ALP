import * as fs from 'fs';
import * as path from 'path';
import { RegistryClient } from '../registry';

export function publishCommand(pkgDir: string) {
  const absoluteDir = path.resolve(process.cwd(), pkgDir);
  if (!fs.existsSync(absoluteDir)) {
    console.error(`Error: Directory not found: ${absoluteDir}`);
    process.exit(1);
  }

  const registry = new RegistryClient();
  registry.publish(absoluteDir).then(() => {
     // success
  }).catch(err => {
     console.error(err);
  });
}
