import * as fs from 'fs';
import * as path from 'path';
import { AlpParser } from '@alp/parser';

export function doctorCommand() {
  console.log('🩺 ALP Doctor: Checking workspace health...\n');
  let issues = 0;
  let warnings = 0;

  const cwd = process.cwd();
  const alpDir = path.join(cwd, '.alp');

  // 1. Check directory existence
  if (!fs.existsSync(alpDir)) {
    console.error('❌ [ERROR] `.alp` directory not found. Have you run `alp init`?');
    issues++;
  } else {
    console.log('✅ Found `.alp` directory.');
  }

  // 2. Check for floating .alp files outside the .alp folder
  const filesInRoot = fs.readdirSync(cwd, { withFileTypes: true });
  for (const file of filesInRoot) {
    if (file.isFile() && file.name.endsWith('.alp')) {
      console.warn(`⚠️  [WARN] Found floating ALP file outside of .alp/: ${file.name}`);
      warnings++;
    }
  }

  // 3. Parse test
  if (fs.existsSync(alpDir)) {
    const parser = new AlpParser();
    let parseErrors = 0;

    const readDir = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          readDir(fullPath);
        } else if (entry.name.endsWith('.alp')) {
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            parser.parse(content);
          } catch (e: any) {
            parseErrors++;
            console.error(`❌ [ERROR] Syntax error in ${path.relative(cwd, fullPath)}: ${e.message}`);
          }
        }
      }
    };
    
    readDir(alpDir);
    
    if (parseErrors === 0) {
      console.log('✅ All ALP files parsed successfully (no fatal syntax errors).');
    } else {
      issues += parseErrors;
    }
  }

  // 4. Ecosystem check (optional package.json check)
  const pkgPath = path.join(cwd, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (!deps['@alp/sdk'] && !deps['@alp/cli']) {
        console.warn('⚠️  [WARN] `@alp/sdk` or `@alp/cli` are not listed in package.json dependencies.');
        warnings++;
      } else {
        console.log('✅ ALP packages found in package.json.');
      }
    } catch {
      // ignore
    }
  }

  console.log(`\n🏥 Doctor Summary: Found ${issues} issues, ${warnings} warnings.`);
  if (issues > 0) {
    console.log('Please fix the errors above to ensure a healthy workspace.');
    process.exit(1);
  } else if (warnings > 0) {
    console.log('Your workspace is functional, but consider addressing the warnings.');
  } else {
    console.log('Your ALP workspace is perfectly healthy! 🎉');
  }
}
