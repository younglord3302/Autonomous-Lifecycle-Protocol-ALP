import * as fs from 'fs';
import * as path from 'path';
import { AlpParser, AlpObject } from '@alp/parser';

export function lintCommand() {
  const alpDir = path.resolve(process.cwd(), '.alp');
  if (!fs.existsSync(alpDir)) {
    console.error('Error: .alp directory not found. Run `alp init` first.');
    process.exit(1);
  }

  const parser = new AlpParser();
  let objects: AlpObject[] = [];
  let fileMap = new Map<string, string>(); // object ID to file path

  // Parse all files
  const readDir = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        readDir(fullPath);
      } else if (entry.name.endsWith('.alp')) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const parsed = parser.parse(content);
          objects.push(...parsed);
          for (const obj of parsed) {
            if (obj.id) fileMap.set(obj.id, fullPath);
          }
        } catch (e: any) {
          // Ignore validation errors here, lint is for style
        }
      }
    }
  };

  readDir(alpDir);

  let warnings = 0;
  let errors = 0;

  console.log('🔍 Linting ALP Workspace...\n');

  for (const obj of objects) {
    const file = path.relative(process.cwd(), fileMap.get(obj.id!) || 'unknown');
    
    // 1. Kebab-case ID check
    if (obj.id && !/^[a-z0-9-]+$/.test(obj.id)) {
      console.error(`❌ [ERROR] ${file} (${obj._type}): ID '${obj.id}' is not kebab-case.`);
      errors++;
    }

    // 2. Description length check
    if (obj.description) {
      if (obj.description.length < 15) {
        console.warn(`⚠️  [WARN]  ${file} (${obj._type}): Description is too short (<15 chars). Please be more descriptive.`);
        warnings++;
      }
    } else {
      console.warn(`⚠️  [WARN]  ${file} (${obj._type}): Missing description.`);
      warnings++;
    }

    // 3. Task verification check
    if (obj._type === 'task') {
      const task = obj as any;
      if (!task.verify || !Array.isArray(task.verify) || task.verify.length === 0) {
        console.warn(`⚠️  [WARN]  ${file} (task): Task '${obj.id}' has no 'verify' quality gates defined. How will you know it is done?`);
        warnings++;
      }
    }
  }

  console.log(`\nLinting complete. Found ${errors} errors and ${warnings} warnings.`);
  if (errors > 0) {
    process.exit(1);
  }
}
