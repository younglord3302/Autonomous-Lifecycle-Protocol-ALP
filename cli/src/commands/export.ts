import * as fs from 'fs';
import * as path from 'path';
import { AlpParser, AlpObject, AlpGraph } from '@alp/parser';
import * as yaml from 'yaml';

interface ExportOptions {
  format?: 'json' | 'yaml';
  out?: string;
  minified?: boolean;
}

export function exportCommand(options: ExportOptions) {
  const alpDir = path.resolve(process.cwd(), '.alp');
  if (!fs.existsSync(alpDir)) {
    console.error('Error: .alp directory not found. Run `alp init` first.');
    process.exit(1);
  }

  const parser = new AlpParser();
  const objects: AlpObject[] = [];

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
          objects.push(...parser.parse(content));
        } catch (e: any) {
          console.error(`Error parsing ${fullPath}: ${e.message}`);
          process.exit(1);
        }
      }
    }
  };

  readDir(alpDir);

  // Topologically sort them using the Graph engine to provide logical order
  const graph = new AlpGraph();
  graph.buildGraph(objects);
  let sortedObjects: AlpObject[] = [];
  try {
    const sortedNodes = graph.topologicalSort();
    sortedObjects = sortedNodes.map((n) => n.object);
  } catch (err) {
    // If there's a cycle, just fall back to parsed order
    sortedObjects = objects;
  }

  const format = options.format || 'json';
  let outputData = '';

  if (format === 'json') {
    if (options.minified) {
      outputData = JSON.stringify(sortedObjects);
    } else {
      outputData = JSON.stringify(sortedObjects, null, 2);
    }
  } else if (format === 'yaml') {
    outputData = yaml.stringify(sortedObjects);
  } else {
    console.error(`Error: Unsupported format '${format}'. Use 'json' or 'yaml'.`);
    process.exit(1);
  }

  if (options.out) {
    const outPath = path.resolve(process.cwd(), options.out);
    fs.writeFileSync(outPath, outputData, 'utf-8');
    console.log(`✅ Successfully exported ${sortedObjects.length} objects to ${options.out}`);
  } else {
    console.log(outputData);
  }
}
