import * as fs from 'fs';
import * as path from 'path';

export function importCommand(file?: string) {
  const cwd = process.cwd();
  
  // Default files to look for if none specified
  const targets = file ? [file] : ['.cursorrules', '.windsurfrules', 'claude.md'];
  
  let targetFile = '';
  for (const t of targets) {
    const fullPath = path.join(cwd, t);
    if (fs.existsSync(fullPath)) {
      targetFile = fullPath;
      break;
    }
  }

  if (!targetFile) {
    console.error(`❌ [ERROR] No legacy rule files found. Tried: ${targets.join(', ')}`);
    process.exit(1);
  }

  console.log(`🚀 ALP Import: Reading legacy rules from ${path.basename(targetFile)}...\n`);
  
  const content = fs.readFileSync(targetFile, 'utf-8');
  const lines = content.split('\n');
  
  const rules: { id: string; description: string }[] = [];
  
  let currentId = 'rule-general';
  let currentDesc: string[] = [];
  
  const finishRule = () => {
    if (currentDesc.length > 0 && currentDesc.some(l => l.trim() !== '')) {
      rules.push({
        id: currentId,
        description: currentDesc.join('\\n').replace(/"/g, '\\"').trim()
      });
    }
    currentDesc = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Naive Markdown header splitting
    const headerMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (headerMatch) {
      finishRule();
      
      const title = headerMatch[2].trim();
      currentId = 'rule-' + title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      
      // Fallback if regex strips everything
      if (currentId === 'rule-') {
        currentId = `rule-section-${rules.length + 1}`;
      }
    } else {
      currentDesc.push(line);
    }
  }
  
  finishRule(); // flush the last rule

  if (rules.length === 0) {
    console.log('⚠️ No rules could be parsed from the file.');
    return;
  }

  // Create .alp output
  let alpContent = `!alp-version: 3.0.0\n\n`;
  for (const rule of rules) {
    alpContent += `@rule\n`;
    alpContent += `  id: ${rule.id}\n`;
    alpContent += `  description: "${rule.description}"\n\n`;
  }

  const alpDir = path.join(cwd, '.alp');
  if (!fs.existsSync(alpDir)) {
    fs.mkdirSync(alpDir, { recursive: true });
  }

  const rulesDir = path.join(alpDir, 'rules');
  if (!fs.existsSync(rulesDir)) {
    fs.mkdirSync(rulesDir, { recursive: true });
  }

  const outPath = path.join(rulesDir, 'imported.alp');
  fs.writeFileSync(outPath, alpContent, 'utf-8');

  console.log(`✅ Successfully imported ${rules.length} rules!`);
  console.log(`📄 Wrote generated ALP rules to ${path.relative(cwd, outPath)}`);
}
