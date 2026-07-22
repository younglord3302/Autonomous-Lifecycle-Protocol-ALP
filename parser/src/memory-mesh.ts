/**
 * ALP MemoryMeshEngine — Agentic Memory Mesh & Distributed Knowledge Graph (v38.0.0).
 *
 * Provides cross-agent memory storage, sync, recency decay scoring,
 * and federated semantic retrieval across autonomous swarms.
 */

export interface MemoryNode {
  id: string;
  agentId: string;
  key: string;
  content: string;
  tags: string[];
  timestamp: number;
  accessCount: number;
  lastAccessed: number;
  vector?: number[];
}

export interface MemoryQueryResult {
  node: MemoryNode;
  score: number;
  decayFactor: number;
}

export interface MemoryMeshStats {
  totalMemories: number;
  activeAgents: number;
  tagCounts: Record<string, number>;
  averageAgeHours: number;
}

export class MemoryMeshEngine {
  private memories: Map<string, MemoryNode> = new Map();
  private decayRate: number = 0.0000001; // Exponential decay rate per ms (~0.36 per hour)

  /**
   * Store or update a memory node in the mesh.
   */
  storeMemory(
    id: string,
    agentId: string,
    key: string,
    content: string,
    tags: string[] = [],
    vector?: number[]
  ): MemoryNode {
    const now = Date.now();
    const existing = this.memories.get(id);

    const node: MemoryNode = {
      id,
      agentId,
      key,
      content,
      tags,
      timestamp: existing ? existing.timestamp : now,
      accessCount: existing ? existing.accessCount + 1 : 1,
      lastAccessed: now,
      vector,
    };

    this.memories.set(id, node);
    return node;
  }

  /**
   * Query the memory mesh with keyword matching and recency decay scoring.
   */
  queryMemoryMesh(
    query: string,
    options?: { agentId?: string; tag?: string; topK?: number }
  ): MemoryQueryResult[] {
    const now = Date.now();
    const queryLower = query.toLowerCase();
    const keywords = queryLower.split(/\s+/).filter(Boolean);
    const results: MemoryQueryResult[] = [];

    for (const node of this.memories.values()) {
      if (options?.agentId && node.agentId !== options.agentId) continue;
      if (options?.tag && !node.tags.includes(options.tag)) continue;

      const contentLower = (node.key + ' ' + node.content + ' ' + node.tags.join(' ')).toLowerCase();
      let matchScore = 0;

      for (const kw of keywords) {
        if (contentLower.includes(kw)) {
          matchScore += 1.0;
        }
      }

      if (matchScore > 0) {
        const ageMs = now - node.timestamp;
        const decayFactor = Math.exp(-this.decayRate * ageMs);
        const finalScore = matchScore * decayFactor * (1 + Math.log(node.accessCount));

        // Update access tracking
        node.lastAccessed = now;
        node.accessCount += 1;

        results.push({
          node,
          score: Math.round(finalScore * 1000) / 1000,
          decayFactor: Math.round(decayFactor * 1000) / 1000,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return options?.topK ? results.slice(0, options.topK) : results;
  }

  /**
   * Sync memory nodes from another agent into this engine instance.
   */
  syncNodeMemories(targetAgentId: string, memoryNodes: MemoryNode[]): number {
    let synced = 0;
    for (const node of memoryNodes) {
      if (!this.memories.has(node.id) || this.memories.get(node.id)!.timestamp < node.timestamp) {
        this.memories.set(node.id, { ...node, agentId: targetAgentId });
        synced++;
      }
    }
    return synced;
  }

  /**
   * Get memory mesh analytics and statistics.
   */
  getMeshStats(): MemoryMeshStats {
    const now = Date.now();
    const agents = new Set<string>();
    const tagCounts: Record<string, number> = {};
    let totalAgeMs = 0;

    for (const node of this.memories.values()) {
      agents.add(node.agentId);
      totalAgeMs += now - node.timestamp;

      for (const tag of node.tags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }

    const count = this.memories.size;
    const avgAgeHours = count > 0 ? (totalAgeMs / count) / (1000 * 60 * 60) : 0;

    return {
      totalMemories: count,
      activeAgents: agents.size,
      tagCounts,
      averageAgeHours: Math.round(avgAgeHours * 100) / 100,
    };
  }
}
