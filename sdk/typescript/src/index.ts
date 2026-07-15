import * as fs from 'fs';
import * as path from 'path';
import { AlpParser, AlpObject, AlpGraph, GraphNode } from '@alp/parser';

export class AlpWorkspace {
  private parser: AlpParser;
  private graph: AlpGraph | null = null;
  public objects: AlpObject[] = [];

  constructor() {
    this.parser = new AlpParser();
  }

  /**
   * Load and validate all .alp files in a directory.
   */
  public load(workspaceDir: string): void {
    this.objects = [];
    const files = this.findAlpFiles(workspaceDir);
    
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      const parsed = this.parser.parseAndValidate(content);
      this.objects.push(...parsed);
    }
  }

  /**
   * Build and return the dependency graph.
   */
  public getGraph(): AlpGraph {
    if (!this.graph) {
      this.graph = new AlpGraph();
      this.graph.buildGraph(this.objects);
      this.graph.detectCycles();
    }
    return this.graph;
  }

  /**
   * Get the topological execution order of all objects.
   */
  public getExecutionOrder(): GraphNode[] {
    return this.getGraph().topologicalSort();
  }

  /**
   * Find an object by its ID.
   */
  public findById(id: string): AlpObject | undefined {
    return this.objects.find(obj => obj.id === id);
  }

  /**
   * Helper to recursively find all .alp files under a directory.
   */
  private findAlpFiles(dir: string): string[] {
    const fileList: string[] = [];
    const alpDir = path.join(dir, '.alp');
    if (!fs.existsSync(alpDir)) return fileList;

    const walk = (current: string): void => {
      const entries = fs.readdirSync(current);
      for (const entry of entries) {
        const filePath = path.join(current, entry);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          walk(filePath);
        } else if (filePath.endsWith('.alp')) {
          fileList.push(filePath);
        }
      }
    };

    walk(alpDir);
    return fileList;
  }
}

// Re-export core types
export { AlpObject, AlpGraph, GraphNode };
