import { Command } from 'commander';
import { CollaborationEngine } from '@alp/parser';

export function registerCollabCommand(program: Command) {
  const collabCmd = program
    .command('collab')
    .description('Real-time multiplayer collaboration & conflict resolution (v37.0.0)');

  collabCmd
    .command('start')
    .description('Start a collaboration session on a document')
    .argument('<docId>', 'Document/file identifier')
    .action((docId) => {
      const engine = new CollaborationEngine();
      const session = engine.createSession(docId);

      console.log('\n🤝 Collaboration Session Started (v37.0.0)');
      console.log('===========================================');
      console.log(`  Document:   ${session.docId}`);
      console.log(`  Created:    ${new Date(session.createdAt).toISOString()}`);
      console.log(`  Agents:     ${session.agents.size}`);
      console.log(`  Operations: ${session.operations.length}\n`);
    });

  collabCmd
    .command('join')
    .description('Join an active collaboration session')
    .argument('<docId>', 'Document/file identifier')
    .option('--agent <id>', 'Agent identifier', 'agent-default')
    .action((docId, options) => {
      const engine = new CollaborationEngine();
      engine.createSession(docId);
      const presence = engine.joinSession(docId, options.agent);

      if (presence) {
        console.log(`\n✅ Agent '${presence.agentId}' joined session '${docId}'`);
        console.log(`   Color:  ${presence.color}`);
        console.log(`   Status: ${presence.status}\n`);
      } else {
        console.error(`❌ Session '${docId}' not found`);
      }
    });

  collabCmd
    .command('status')
    .description('Show session presence and operation count')
    .argument('<docId>', 'Document/file identifier')
    .action((docId) => {
      const engine = new CollaborationEngine();
      const session = engine.getSession(docId);

      if (!session) {
        console.log(`\n⚠️  No active session for '${docId}'\n`);
        return;
      }

      console.log(`\n📊 Session Status: ${docId}`);
      console.log(`   Agents:     ${session.agents.size}`);
      console.log(`   Operations: ${session.operations.length}`);
      console.log(`   Branches:   ${session.branches.size}\n`);
    });

  collabCmd
    .command('merge')
    .description('Merge a branch back into the main document')
    .argument('<docId>', 'Main document ID')
    .argument('<branchId>', 'Branch to merge')
    .action((docId, branchId) => {
      const engine = new CollaborationEngine();
      const result = engine.mergeBranch(docId, branchId);

      if (!result) {
        console.error(`❌ Could not merge: session or branch not found`);
        return;
      }

      console.log(`\n🔀 Merge Complete`);
      console.log(`   Operations applied: ${result.operationsApplied}`);
      console.log(`   Conflicts:          ${result.conflicts.length}`);
      if (result.conflicts.length > 0) {
        result.conflicts.forEach((c) => {
          console.log(`     ⚠️  ${c.path}: ${c.resolution} (local=${c.localValue}, remote=${c.remoteValue})`);
        });
      }
      console.log('');
    });
}
