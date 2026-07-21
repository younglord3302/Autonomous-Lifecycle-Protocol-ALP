import fs from 'fs';
import path from 'path';
import { AlpParser, AlpObject, WorkflowVisualizer, DiagramFormat } from '@alp/parser';

export function visualizeCommand(id: string | undefined, opts: { format?: string; out?: string }) {
  const format = (opts.format || 'mermaid') as DiagramFormat;
  if (!['mermaid', 'dot', 'json'].includes(format)) {
    console.error(`Error: unsupported format '${format}'. Use mermaid, dot, or json.`);
    process.exit(1);
  }

  const parser = new AlpParser();
  let objects: AlpObject[] = [];

  const targetDir = path.join(process.cwd(), '.alp');
  if (!fs.existsSync(targetDir)) {
    console.error('Error: .alp directory not found. Run `alp init` first.');
    process.exit(1);
  }

  const files = fs.readdirSync(targetDir).filter((f) => f.endsWith('.alp'));
  for (const file of files) {
    const fullPath = path.join(targetDir, file);
    const content = fs.readFileSync(fullPath, 'utf8');
    try {
      objects = objects.concat(parser.parseAndValidate(content));
    } catch {
      /* skip unparseable files */
    }
  }

  const visualizer = new WorkflowVisualizer();
  let workflows = visualizer.parseWorkflows(objects);
  if (id) {
    workflows = workflows.filter((w) => w.id === id);
    if (workflows.length === 0) {
      console.error(`Error: workflow '${id}' not found.`);
      process.exit(1);
    }
  }

  if (workflows.length === 0) {
    console.log('📭 No @workflow objects found to visualize.');
    return;
  }

  const output = visualizer.generate(workflows, format);

  if (opts.out) {
    fs.writeFileSync(opts.out, output, 'utf-8');
    console.log(`✅ Wrote ${format} diagram for ${workflows.length} workflow(s) to ${opts.out}`);
  } else {
    console.log(output);
  }
}
