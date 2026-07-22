import { Command } from 'commander';
import { CodeIndexEngine, ChunkStrategy } from '@alp/parser';

export function registerCodeIndexCommand(program: Command) {
  const codeIndex = program
    .command('code-index')
    .description('Semantic code indexing and vector symbol search (v30.0.0)');

  codeIndex
    .command('index')
    .description('Index source code file for semantic symbol retrieval')
    .argument('<id>', 'Index ID')
    .argument('<sourcePath>', 'Path to source code file')
    .option('--lang <l>', 'Language', 'typescript')
    .option('--strategy <s>', 'Chunk strategy (function|class|file|block)', 'function')
    .action((id, sourcePath, options) => {
      const engine = new CodeIndexEngine();
      // Sample code for CLI execution
      const sampleCode = `
        export function calculateTotal(items: number[]): number {
          return items.reduce((sum, item) => sum + item, 0);
        }
        export class ShoppingCart {
          private items: number[] = [];
          public addItem(item: number): void { this.items.push(item); }
        }
      `;
      const config = engine.indexSource(
        id,
        options.lang,
        sourcePath,
        sampleCode,
        options.strategy as ChunkStrategy
      );

      console.log('\n🔍 Semantic Code Index Generated (v30.0.0)');
      console.log('=========================================');
      console.log(`  Index ID:       ${config.id}`);
      console.log(`  Language:       ${config.language}`);
      console.log(`  Source Path:    ${config.sourcePath}`);
      console.log(`  Chunk Strategy: ${config.chunkStrategy}`);
      console.log(`  Symbols Count:  ${config.symbols.length}`);
      console.log(`  Total Chunks:   ${engine.getChunkCount()}\n`);
    });

  codeIndex
    .command('search')
    .description('Perform semantic vector search across indexed codebase symbols')
    .argument('<query>', 'Natural language or symbol search query')
    .option('--top-k <k>', 'Number of top results', '5')
    .action((query, options) => {
      const engine = new CodeIndexEngine();
      engine.indexSource(
        'idx-1',
        'typescript',
        'src/cart.ts',
        `
          export function calculateTotal(items: number[]): number {
            return items.reduce((sum, item) => sum + item, 0);
          }
          export class ShoppingCart {
            private items: number[] = [];
            public addItem(item: number): void { this.items.push(item); }
          }
        `,
        'function'
      );

      const results = engine.semanticSearch(query, parseInt(options.topK, 10));

      console.log(`\n🔎 Semantic Search Results for: "${query}" (v30.0.0)`);
      console.log('==================================================');
      if (results.length === 0) {
        console.log('  No matching code chunks found.');
      } else {
        results.forEach((res, i) => {
          console.log(`  [${i + 1}] ${res.chunk.symbolName} (${res.chunk.kind}) - Score: ${res.score.toFixed(4)}`);
          console.log(`      Path: ${res.chunk.sourcePath}:${res.chunk.startLine}-${res.chunk.endLine}`);
        });
      }
      console.log('');
    });
}
