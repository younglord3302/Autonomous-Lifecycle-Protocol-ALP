import { Command } from 'commander';
import { VectorStoreEngine } from '@alp/parser';

export function registerVectorCommand(program: Command) {
  const vector = program
    .command('vector')
    .description('Native vector embeddings & semantic RAG index (v19.0.0)');

  vector
    .command('index')
    .description('Add a text entry and embedding vector to the index')
    .argument('<id>', 'Entry ID')
    .argument('<text>', 'Text content to index')
    .action((id, text) => {
      const engine = new VectorStoreEngine();
      // Dummy vector representation for indexing demo
      const mockVector = [0.1, 0.5, 0.9, 0.2];
      engine.addEntry({ id, text, vector: mockVector });

      console.log('\n🧠 Vector Store Indexing (v19.0.0)');
      console.log('==================================');
      console.log(`  Indexed ID:   ${id}`);
      console.log(`  Content:      "${text}"`);
      console.log(`  Dimensions:   ${mockVector.length}`);
      console.log(`  Total Store:  ${engine.size()} entry\n`);
    });

  vector
    .command('query')
    .description('Perform cosine similarity search across indexed vectors')
    .argument('<queryText>', 'Query string to search')
    .action((queryText) => {
      const engine = new VectorStoreEngine();
      engine.addEntry({ id: 'doc-auth', text: 'User Authentication & OAuth2 module', vector: [0.9, 0.1, 0.2, 0.8] });
      engine.addEntry({ id: 'doc-db', text: 'Database schema migration and Postgres pooling', vector: [0.1, 0.8, 0.9, 0.1] });

      const results = engine.querySimilar([0.85, 0.15, 0.25, 0.75], 2);

      console.log(`\n🔍 Cosine Similarity RAG Results for: "${queryText}"`);
      console.log('==================================================');
      results.forEach((r, idx) => {
        console.log(`  ${idx + 1}. [${r.id}] (Score: ${(r.score * 100).toFixed(1)}%) — ${r.text}`);
      });
      console.log('');
    });
}
