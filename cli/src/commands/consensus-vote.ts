import { Command } from 'commander';
import { ConsensusVoteEngine, VotingStrategy } from '@alp/parser';

export function registerConsensusVoteCommand(program: Command) {
  const voteCmd = program
    .command('vote')
    .description('Multi-agent consensus and voting engine (v33.0.0)');

  voteCmd
    .command('propose')
    .description('Create a multi-agent voting proposal')
    .argument('<id>', 'Proposal ID')
    .argument('<proposalText>', 'Proposal description or directive text')
    .option('--strategy <s>', 'Voting strategy (majority|weighted|unanimous|borda_count)', 'majority')
    .option('--quorum <q>', 'Quorum threshold ratio (0.0-1.0)', '0.5')
    .action((id, proposalText, options) => {
      const engine = new ConsensusVoteEngine();
      const session = engine.createProposal(
        id,
        proposalText,
        options.strategy as VotingStrategy,
        parseFloat(options.quorum)
      );

      console.log('\n🗳️ Consensus Proposal Created (v33.0.0)');
      console.log('====================================');
      console.log(`  Proposal ID:     ${session.id}`);
      console.log(`  Proposal:        "${session.proposal}"`);
      console.log(`  Voting Strategy: ${session.votingStrategy}`);
      console.log(`  Quorum Ratio:    ${(session.quorum * 100).toFixed(0)}%\n`);
    });

  voteCmd
    .command('tally')
    .description('Cast sample agent votes and tally proposal outcome')
    .argument('<id>', 'Proposal ID')
    .action((id) => {
      const engine = new ConsensusVoteEngine();
      engine.createProposal(id, 'Approve system architecture refactor', 'majority', 0.6);
      engine.castVote(id, 'agent-1', 'approve', 1.0);
      engine.castVote(id, 'agent-2', 'approve', 1.0);
      engine.castVote(id, 'agent-3', 'approve', 1.0);
      engine.castVote(id, 'agent-4', 'reject', 1.0);

      const res = engine.tallyConsensus(id, 5);

      console.log('\n📊 Consensus Vote Tally Results (v33.0.0)');
      console.log('=======================================');
      console.log(`  Proposal ID:      ${res.voteId}`);
      console.log(`  Proposal:         "${res.proposal}"`);
      console.log(`  Strategy:         ${res.strategy}`);
      console.log(`  Total Votes:      ${res.totalVotesCount}`);
      console.log(`  Winning Choice:   ${res.winningChoice}`);
      console.log(`  Consensus Status: ${res.passed ? '✅ PASSED' : '❌ FAILED'}`);
      console.log('\n  Vote Breakdown:');
      for (const [choice, count] of Object.entries(res.voteBreakdown)) {
        console.log(`    - ${choice}: ${count}`);
      }
      console.log('');
    });
}
