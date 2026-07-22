export interface VectorEntry {
  id: string;
  text: string;
  vector: number[];
  metadata?: Record<string, any>;
}

export interface VectorSearchResult {
  id: string;
  text: string;
  score: number;
  metadata?: Record<string, any>;
}

export class VectorStoreEngine {
  private entries: Map<string, VectorEntry> = new Map();

  public addEntry(entry: VectorEntry): void {
    this.entries.set(entry.id, entry);
  }

  public getEntry(id: string): VectorEntry | undefined {
    return this.entries.get(id);
  }

  public cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  public querySimilar(queryVector: number[], topK: number = 3): VectorSearchResult[] {
    const results: VectorSearchResult[] = [];

    this.entries.forEach((entry) => {
      const score = this.cosineSimilarity(queryVector, entry.vector);
      results.push({
        id: entry.id,
        text: entry.text,
        score,
        metadata: entry.metadata,
      });
    });

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  public size(): number {
    return this.entries.size;
  }
}
