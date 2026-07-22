export type SymbolKind = 'function' | 'class' | 'method' | 'variable' | 'interface' | 'type' | 'module';
export type ChunkStrategy = 'function' | 'class' | 'file' | 'block';

export interface CodeSymbol {
  name: string;
  kind: SymbolKind;
  line: number;
  signature: string;
  doc: string;
}

export interface CodeChunk {
  id: string;
  sourcePath: string;
  language: string;
  symbolName: string;
  kind: SymbolKind;
  content: string;
  startLine: number;
  endLine: number;
  embedding: number[];
}

export interface SemanticSearchResult {
  chunk: CodeChunk;
  score: number;
}

export interface CodeIndexConfig {
  id: string;
  language: string;
  sourcePath: string;
  symbols: CodeSymbol[];
  embeddingModel: string;
  chunkStrategy: ChunkStrategy;
  indexedAt: string;
}

/**
 * Deterministic cosine-similarity placeholder for semantic search.
 * In production, embeddings come from a real model; here we use
 * a bag-of-characters vector for testability.
 */
function simpleEmbedding(text: string, dims: number = 64): number[] {
  const vec = new Array(dims).fill(0);
  for (let i = 0; i < text.length; i++) {
    vec[text.charCodeAt(i) % dims] += 1;
  }
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map(v => v / mag);
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB) || 1);
}

export class CodeIndexEngine {
  private indices: Map<string, CodeIndexConfig> = new Map();
  private chunks: CodeChunk[] = [];

  public indexSource(
    id: string,
    language: string,
    sourcePath: string,
    sourceCode: string,
    chunkStrategy: ChunkStrategy = 'function',
    embeddingModel: string = 'alp-code-embed-v1',
  ): CodeIndexConfig {
    const symbols = this.extractSymbols(sourceCode, language);
    const newChunks = this.chunkSource(id, sourcePath, language, sourceCode, symbols, chunkStrategy);

    this.chunks.push(...newChunks);

    const config: CodeIndexConfig = {
      id,
      language,
      sourcePath,
      symbols,
      embeddingModel,
      chunkStrategy,
      indexedAt: new Date().toISOString(),
    };

    this.indices.set(id, config);
    return config;
  }

  public semanticSearch(query: string, topK: number = 5): SemanticSearchResult[] {
    if (this.chunks.length === 0) return [];

    const queryEmbed = simpleEmbedding(query);
    const scored = this.chunks.map(chunk => ({
      chunk,
      score: cosineSimilarity(queryEmbed, chunk.embedding),
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  public getIndex(id: string): CodeIndexConfig | undefined {
    return this.indices.get(id);
  }

  public getChunkCount(): number {
    return this.chunks.length;
  }

  public listIndices(): CodeIndexConfig[] {
    return Array.from(this.indices.values());
  }

  private extractSymbols(source: string, language: string): CodeSymbol[] {
    const symbols: CodeSymbol[] = [];
    const lines = source.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Function detection (JS/TS/Python)
      const fnMatch = line.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/);
      if (fnMatch) {
        symbols.push({ name: fnMatch[1], kind: 'function', line: i + 1, signature: `${fnMatch[1]}(${fnMatch[2]})`, doc: '' });
        continue;
      }

      // Class detection
      const classMatch = line.match(/^(?:export\s+)?class\s+(\w+)/);
      if (classMatch) {
        symbols.push({ name: classMatch[1], kind: 'class', line: i + 1, signature: classMatch[1], doc: '' });
        continue;
      }

      // Python def detection
      const defMatch = line.match(/^def\s+(\w+)\s*\(([^)]*)\)/);
      if (defMatch) {
        symbols.push({ name: defMatch[1], kind: 'function', line: i + 1, signature: `${defMatch[1]}(${defMatch[2]})`, doc: '' });
        continue;
      }

      // Interface/type detection
      const ifMatch = line.match(/^(?:export\s+)?interface\s+(\w+)/);
      if (ifMatch) {
        symbols.push({ name: ifMatch[1], kind: 'interface', line: i + 1, signature: ifMatch[1], doc: '' });
      }
    }

    return symbols;
  }

  private chunkSource(
    indexId: string,
    sourcePath: string,
    language: string,
    source: string,
    symbols: CodeSymbol[],
    strategy: ChunkStrategy,
  ): CodeChunk[] {
    if (strategy === 'file' || symbols.length === 0) {
      const embed = simpleEmbedding(source);
      return [{
        id: `${indexId}:file`,
        sourcePath,
        language,
        symbolName: sourcePath,
        kind: 'module',
        content: source,
        startLine: 1,
        endLine: source.split('\n').length,
        embedding: embed,
      }];
    }

    // Chunk per-symbol
    const lines = source.split('\n');
    return symbols.map((sym, idx) => {
      const startLine = sym.line;
      const endLine = idx < symbols.length - 1 ? symbols[idx + 1].line - 1 : lines.length;
      const content = lines.slice(startLine - 1, endLine).join('\n');
      return {
        id: `${indexId}:${sym.name}`,
        sourcePath,
        language,
        symbolName: sym.name,
        kind: sym.kind,
        content,
        startLine,
        endLine,
        embedding: simpleEmbedding(content),
      };
    });
  }
}
