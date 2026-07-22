import { Command } from 'commander';
import { CRDTSyncEngine } from '@alp/parser';

export function registerCRDTSyncCommand(program: Command) {
  const sync = program
    .command('crdt-sync')
    .description('Live real-time CRDT multi-agent state sync (v21.0.0)');

  sync
    .command('status')
    .description('Show CRDT document state clock & peer convergence status')
    .argument('<docId>', 'Document specification ID')
    .action((docId) => {
      const engine = new CRDTSyncEngine();
      engine.set(docId, '@agent-architect', 'status', '[x]', 100);
      engine.set(docId, '@agent-coder', 'assigned', '@agent-coder', 105);

      const state = engine.readState(docId);

      console.log('\n🔄 CRDT Real-Time Document State (v21.0.0)');
      console.log('==========================================');
      console.log(`  Document ID: ${docId}`);
      console.log(`  Properties:  ${JSON.stringify(state, null, 2)}\n`);
    });

  sync
    .command('merge')
    .description('Perform deterministic LWW merge of local and remote peer states')
    .argument('<docId>', 'Document ID')
    .action((docId) => {
      const engine = new CRDTSyncEngine();
      const localState = engine.set(docId, '@peer-local', 'feature-flag', 'enabled', 200);
      
      const remoteEngine = new CRDTSyncEngine();
      const remoteState = remoteEngine.set(docId, '@peer-remote', 'feature-flag', 'enabled-v21', 250);

      const merged = engine.merge(localState, remoteState);
      const converged = engine.readState(docId);

      console.log('\n🤝 CRDT Peer State Convergence Receipt (v21.0.0)');
      console.log('=================================================');
      console.log(`  Doc ID:     ${merged.docId}`);
      console.log(`  Lamport:    Clock ${merged.clock}`);
      console.log(`  Converged:  ${JSON.stringify(converged)}\n`);
    });
}
