import { Command } from 'commander';
import { MemoryMeshEngine } from '@alp/parser';

export function registerMemoryMeshCommand(program: Command) {
  const meshCmd = program
    .command('memory-mesh')
    .description('Agentic memory mesh & distributed knowledge graph (v38.0.0)');

  meshCmd
    .command('query')
    .description('Query shared memory mesh across active swarm agents')
    .argument('<term>', 'Search query term')
    .option('--agent <id>', 'Filter by agent ID')
    .option('--tag <tag>', 'Filter by memory tag')
    .option('--top-k <k>', 'Maximum results to return', '5')
    .action((term, options) => {
      const engine = new MemoryMeshEngine();
      engine.storeMemory('mem-1', 'agent-coder', 'auth-refactor', 'Refactored auth module with JWT tokens', ['security', 'auth']);
      engine.storeMemory('mem-2', 'agent-tester', 'test-coverage', 'Added vitest integration tests for auth', ['testing', 'auth']);

      const results = engine.queryMemoryMesh(term, {
        agentId: options.agent,
        tag: options.tag,
        topK: parseInt(options.topK, 10),
      });

      console.log(`\n🧠 Memory Mesh Search: "${term}" (v38.0.0)`);
      console.log('============================================');
      console.log(`  Found: ${results.length} relevant memories\n`);

      results.forEach((r, i) => {
        console.log(`  [${i + 1}] Score: ${r.score} (decay: ${r.decayFactor})`);
        console.log(`      ID:       ${r.node.id}`);
        console.log(`      Agent:    ${r.node.agentId}`);
        console.log(`      Key:      ${r.node.key}`);
        console.log(`      Content:  ${r.node.content}`);
        console.log(`      Tags:     ${r.node.tags.join(', ')}\n`);
      });
    });

  meshCmd
    .command('stats')
    .description('View memory mesh statistics and analytics')
    .action(() => {
      const engine = new MemoryMeshEngine();
      engine.storeMemory('m1', 'agent-a', 'k1', 'c1', ['core']);
      engine.storeMemory('m2', 'agent-b', 'k2', 'c2', ['core', 'v38']);
      const stats = engine.getMeshStats();

      console.log('\n📊 Memory Mesh Statistics (v38.0.0)');
      console.log('=====================================');
      console.log(`  Total Memories:    ${stats.totalMemories}`);
      console.log(`  Active Agents:     ${stats.activeAgents}`);
      console.log(`  Avg Age (Hours):   ${stats.averageAgeHours}`);
      console.log('  Tag Distribution:');
      Object.entries(stats.tagCounts).forEach(([tag, count]) => {
        console.log(`    - ${tag}: ${count}`);
      });
      console.log('');
    });
}
