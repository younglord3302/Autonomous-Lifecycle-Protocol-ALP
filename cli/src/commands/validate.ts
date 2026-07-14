import fs from 'fs';
import path from 'path';
import { AlpParser, AlpError } from '@alp/parser';

export function validateCommand(filePath?: string) {
  const parser = new AlpParser();
  
  if (filePath) {
    validateFile(parser, filePath);
  } else {
    // Validate everything in .alp directory
    const targetDir = path.join(process.cwd(), '.alp');
    if (!fs.existsSync(targetDir)) {
      console.error('Error: .alp directory not found. Run `alp init` first.');
      process.exit(1);
    }
    
    let hasErrors = false;
    const files = fs.readdirSync(targetDir).filter(f => f.endsWith('.alp'));
    
    for (const file of files) {
      const fullPath = path.join(targetDir, file);
      const success = validateFile(parser, fullPath);
      if (!success) hasErrors = true;
    }
    
    if (hasErrors) {
      process.exit(1);
    } else {
      console.log('✅ All ALP files are valid!');
    }
  }
}

function validateFile(parser: AlpParser, filePath: string): boolean {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const objects = parser.parseAndValidate(content);
    console.log(`✅ [OK] ${filePath} (${objects.length} objects)`);
    return true;
  } catch (err: any) {
    if (err instanceof AlpError) {
      console.error(`❌ [ERROR] ${filePath}`);
      console.error(`   ${err.message}`);
      if ((err as any).details) {
        console.error(JSON.stringify((err as any).details, null, 2));
      }
    } else {
      console.error(`❌ [ERROR] ${filePath}: ${err.message}`);
    }
    return false;
  }
}
