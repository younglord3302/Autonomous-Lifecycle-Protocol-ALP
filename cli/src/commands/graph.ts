import fs from 'fs';
import path from 'path';
import { AlpParser, AlpGraph, AlpError } from '@alp/parser';

export function graphCommand(filePath?: string) {
  const parser = new AlpParser();
  const graph = new AlpGraph();
  
  let objects: any[] = [];

  try {
    if (filePath) {
      const content = fs.readFileSync(filePath, 'utf8');
      objects = parser.parseAndValidate(content);
    } else {
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
    }
    
    graph.buildGraph(objects);
    
    // Check for cycles
    try {
      graph.detectCycles();
    } catch (err: any) {
      console.error(`❌ Graph validation failed: ${err.message}`);
      process.exit(1);
    }

    console.log('\n📦 ALP Dependency Graph');
    console.log('=======================\n');
    const tree = graph.toTextTree();
    if (tree) {
      console.log(tree);
    } else {
      console.log('(Graph is empty or no valid dependencies found.)');
    }
    console.log('');
    
  } catch (err: any) {
    if (err instanceof AlpError) {
      console.error(`❌ Parse Error: ${err.message}`);
    } else {
      console.error(`❌ Unexpected Error: ${err.message}`);
    }
    process.exit(1);
  }
}
