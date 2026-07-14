import { AlpObject } from './reader';
import { ValidationError } from './error';

export interface GraphNode {
  id: string;
  type: string;
  object: AlpObject;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: 'blocks' | 'requires' | 'extends' | 'uses' | 'implements' | 'references';
}

/**
 * The ALP Graph Engine.
 * Builds a Directed Acyclic Graph (DAG) from parsed ALP objects,
 * resolves references, detects cycles, and enables topological sorting.
 */
export class AlpGraph {
  public nodes: Map<string, GraphNode> = new Map();
  public edges: GraphEdge[] = [];

  /**
   * Build the graph from a list of parsed ALP objects.
   * Extracts nodes (objects with IDs) and edges (-> ref properties).
   */
  public buildGraph(objects: AlpObject[]): void {
    this.nodes.clear();
    this.edges = [];

    // Phase 1: Register all nodes
    for (const obj of objects) {
      if (obj.id) {
        this.nodes.set(obj.id, {
          id: obj.id,
          type: obj._type,
          object: obj,
        });
      }
    }

    // Phase 2: Extract edges from reference properties
    for (const obj of objects) {
      if (!obj.id) continue;

      for (const [key, value] of Object.entries(obj)) {
        if (key === '_type' || key === 'id') continue;

        if (typeof value === 'string' && value.startsWith('-> ')) {
          const targetId = value.substring(3).trim();
          const edgeType = this.inferEdgeType(key);
          this.edges.push({
            source: obj.id,
            target: targetId,
            type: edgeType,
          });
        }

        // Handle arrays of references (e.g., depends_on list)
        if (Array.isArray(value)) {
          const edgeType = this.inferEdgeType(key);
          for (const item of value) {
            if (typeof item === 'string' && item.startsWith('-> ')) {
              const targetId = item.substring(3).trim();
              this.edges.push({
                source: obj.id,
                target: targetId,
                type: edgeType,
              });
            }
          }
        }
      }
    }
  }

  /**
   * Detect cycles in the graph using DFS.
   * Throws a ValidationError if a cycle is found.
   */
  public detectCycles(): void {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const path: string[] = [];

    const dfs = (nodeId: string): void => {
      visited.add(nodeId);
      recursionStack.add(nodeId);
      path.push(nodeId);

      const outgoing = this.edges.filter(
        e => e.source === nodeId && (e.type === 'blocks' || e.type === 'requires')
      );
      for (const edge of outgoing) {
        if (!visited.has(edge.target)) {
          dfs(edge.target);
        } else if (recursionStack.has(edge.target)) {
          const cycleStart = path.indexOf(edge.target);
          const cycle = [...path.slice(cycleStart), edge.target];
          throw new ValidationError(
            `Dependency cycle detected: ${cycle.join(' → ')}`
          );
        }
      }

      path.pop();
      recursionStack.delete(nodeId);
    };

    for (const nodeId of this.nodes.keys()) {
      if (!visited.has(nodeId)) {
        dfs(nodeId);
      }
    }
  }

  /**
   * Return nodes in topological order (execution order).
   * Only considers 'blocks' and 'requires' edges.
   */
  public topologicalSort(): GraphNode[] {
    const orderingEdges = this.edges.filter(
      e => e.type === 'blocks' || e.type === 'requires'
    );

    // Build out-degree map (how many things a node depends on)
    const outDegree = new Map<string, number>();
    for (const nodeId of this.nodes.keys()) {
      outDegree.set(nodeId, 0);
    }
    for (const edge of orderingEdges) {
      if (outDegree.has(edge.source)) {
        outDegree.set(edge.source, (outDegree.get(edge.source) || 0) + 1);
      }
    }

    // Kahn's algorithm (reversed for dependency resolution)
    const queue: string[] = [];
    for (const [nodeId, degree] of outDegree.entries()) {
      if (degree === 0) queue.push(nodeId);
    }

    const sorted: GraphNode[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const node = this.nodes.get(current);
      if (node) sorted.push(node);

      // We completed 'current'. Anyone who depends on 'current' has one less dependency.
      for (const edge of orderingEdges) {
        if (edge.target === current && outDegree.has(edge.source)) {
          const newDegree = (outDegree.get(edge.source) || 1) - 1;
          outDegree.set(edge.source, newDegree);
          if (newDegree === 0) queue.push(edge.source);
        }
      }
    }

    return sorted;
  }

  /**
   * Get all downstream nodes affected by a change to the given node.
   */
  public getImpact(nodeId: string): GraphNode[] {
    const impacted = new Set<string>();
    const queue = [nodeId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const dependents = this.edges
        .filter(e => e.target === current)
        .map(e => e.source);

      for (const dep of dependents) {
        if (!impacted.has(dep) && dep !== nodeId) {
          impacted.add(dep);
          queue.push(dep);
        }
      }
    }

    return Array.from(impacted)
      .map(id => this.nodes.get(id))
      .filter((n): n is GraphNode => n !== undefined);
  }

  /**
   * Get all upstream nodes that must complete before the given node can start.
   */
  public getBlockers(nodeId: string): GraphNode[] {
    const blockers = new Set<string>();
    const queue = [nodeId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const dependencies = this.edges
        .filter(e => e.source === current && (e.type === 'blocks' || e.type === 'requires'))
        .map(e => e.target);

      for (const dep of dependencies) {
        if (!blockers.has(dep) && dep !== nodeId) {
          blockers.add(dep);
          queue.push(dep);
        }
      }
    }

    return Array.from(blockers)
      .map(id => this.nodes.get(id))
      .filter((n): n is GraphNode => n !== undefined);
  }

  /**
   * Print the graph as a readable tree structure.
   */
  public toTextTree(): string {
    const lines: string[] = [];
    const sorted = this.topologicalSort();

    for (const node of sorted) {
      const deps = this.edges
        .filter(e => e.source === node.id)
        .map(e => `→ ${e.target} (${e.type})`);

      const status = node.object.status || '';
      lines.push(`${status} @${node.type} ${node.id}`);
      for (const dep of deps) {
        lines.push(`    ${dep}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Infer the edge type from the property name.
   */
  private inferEdgeType(key: string): GraphEdge['type'] {
    switch (key) {
      case 'depends_on':
      case 'blocked_by':
        return 'blocks';
      case 'requires':
        return 'requires';
      case 'extends':
        return 'extends';
      case 'uses':
        return 'uses';
      case 'implements':
        return 'implements';
      default:
        return 'references';
    }
  }
}
