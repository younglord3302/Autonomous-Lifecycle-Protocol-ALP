import * as fs from 'fs';
import * as path from 'path';

/**
 * `alp uninstall` — Removes an installed package from `.alp/packages` (v4 Pillar 3).
 */
export function uninstallCommand(pkgName: string) {
  const alpDir = path.resolve(process.cwd(), '.alp');
  if (!fs.existsSync(alpDir)) {
    console.error('Error: .alp directory not found. Run `alp init` first.');
    process.exit(1);
  }
  const target = path.join(alpDir, 'packages', pkgName.replace(/[^a-zA-Z0-9-]/g, '_'));
  if (!fs.existsSync(target)) {
    console.log(`Package ${pkgName} is not installed.`);
    return;
  }
  fs.rmSync(target, { recursive: true, force: true });
  console.log(`✅ Uninstalled ${pkgName}`);
}
