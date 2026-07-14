import fs from 'fs';
import path from 'path';
import { AlpParser, AlpError, AlpObject } from '@alp/parser';

export function statusCommand() {
  const parser = new AlpParser();
  
  let objects: AlpObject[] = [];

  try {
    const targetDir = path.join(process.cwd(), '.alp');
    if (!fs.existsSync(targetDir)) {
      console.error('Error: .alp directory not found. Run `alp init` first.');
      process.exit(1);
    }
    
    const files = fs.readdirSync(targetDir).filter(f => f.endsWith('.alp'));
    for (const file of files) {
      const fullPath = path.join(targetDir, file);
      const content = fs.readFileSync(fullPath, 'utf8');
      objects = objects.concat(parser.parseAndValidate(content));
    }
    
    const stats: Record<string, { total: number; todo: number; inProgress: number; done: number; blocked: number }> = {
      project: { total: 0, todo: 0, inProgress: 0, done: 0, blocked: 0 },
      feature: { total: 0, todo: 0, inProgress: 0, done: 0, blocked: 0 },
      task: { total: 0, todo: 0, inProgress: 0, done: 0, blocked: 0 },
      workflow: { total: 0, todo: 0, inProgress: 0, done: 0, blocked: 0 }
    };
    
    for (const obj of objects) {
      const type = obj._type;
      if (stats[type]) {
        stats[type].total++;
        const status = obj.status || '[ ]';
        if (status === '[ ]') stats[type].todo++;
        else if (status === '[~]') stats[type].inProgress++;
        else if (status === '[x]') stats[type].done++;
        else if (status === '[!]') stats[type].blocked++;
      }
    }
    
    console.log('\n📊 ALP Project Status');
    console.log('======================\n');
    
    const types = ['project', 'feature', 'task', 'workflow'];
    for (const type of types) {
      const s = stats[type];
      if (s.total > 0) {
        console.log(`${type.toUpperCase()}S (${s.total} total)`);
        console.log(`  [x] Done:       ${s.done}`);
        console.log(`  [~] In Progress:${s.inProgress}`);
        console.log(`  [ ] Todo:       ${s.todo}`);
        if (s.blocked > 0) console.log(`  [!] Blocked:    ${s.blocked}`);
        console.log('');
      }
    }
    
  } catch (err: any) {
    if (err instanceof AlpError) {
      console.error(`❌ Parse Error: ${err.message}`);
    } else {
      console.error(`❌ Unexpected Error: ${err.message}`);
    }
    process.exit(1);
  }
}
