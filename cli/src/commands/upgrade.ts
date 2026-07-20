import * as fs from 'fs';
import * as path from 'path';

export function upgradeCommand() {
  const alpDir = path.resolve(process.cwd(), '.alp');
  if (!fs.existsSync(alpDir)) {
    console.error('Error: .alp directory not found. Run `alp init` first.');
    process.exit(1);
  }

  console.log('🚀 ALP Upgrade: Checking for older protocol versions...\n');

  let upgradedCount = 0;

  const upgradeDir = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        upgradeDir(fullPath);
      } else if (entry.name.endsWith('.alp')) {
        let content = fs.readFileSync(fullPath, 'utf-8');
        
        let needsUpgrade = false;

        // Check if missing directive or 1.0.0
        if (!content.includes('!alp-version')) {
          content = '!alp-version: 3.0.0\n' + content;
          needsUpgrade = true;
        } else if (content.includes('!alp-version 1.0.0')) {
          content = content.replace('!alp-version 1.0.0', '!alp-version: 3.0.0');
          needsUpgrade = true;
        } else if (content.includes('!alp-version 2.0.0')) {
          content = content.replace('!alp-version 2.0.0', '!alp-version: 3.0.0');
          needsUpgrade = true;
        }

        // V2 syntax shift: in V1, we used `feature: feat-id`. In V2, we prefer `depends_on: -> feat-id`
        // We'll leave the semantic changes to the user for now to avoid destructive rewrites,
        // but we'll bump the version directive.

        if (needsUpgrade) {
          fs.writeFileSync(fullPath, content, 'utf-8');
          console.log(`✅ Upgraded ${path.relative(process.cwd(), fullPath)} to v2.0.0`);
          upgradedCount++;
        }
      }
    }
  };

  upgradeDir(alpDir);

  if (upgradedCount === 0) {
    console.log('✅ All files are already up-to-date with the latest ALP version.');
  } else {
    console.log(`\n🎉 Successfully upgraded ${upgradedCount} files to ALP v2.0.0!`);
  }
}
