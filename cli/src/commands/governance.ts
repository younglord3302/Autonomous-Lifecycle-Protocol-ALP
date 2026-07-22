import * as fs from 'fs';
import * as path from 'path';
import { GovernanceEngine, PolicyBallot, VoteValue } from '@alp/parser';

export function governanceCommand(subcommand: string, ...args: string[]) {
  const cwd = process.cwd();
  const alpDir = path.join(cwd, '.alp');
  if (!fs.existsSync(alpDir)) {
    console.error('Error: .alp directory not found. Run `alp init` first.');
    process.exit(1);
  }

  const engine = new GovernanceEngine(alpDir);

  switch (subcommand) {
    case 'propose': {
      const description = args[0] || 'Policy change';
      const policyId = args[1] || 'policy-1';
      const ballot = engine.propose(policyId, description);
      console.log(`Ballot opened: ${ballot.ballot_id}`);
      console.log(`  Policy: ${policyId}`);
      console.log(`  Quorum: ${ballot.quorum}`);
      break;
    }
    case 'vote': {
      const ballotId = args[0];
      const voterDid = args[1];
      const value = (args[2] as VoteValue) || 'approve';
      const rationale = args.slice(3).join(' ');
      if (!ballotId || !voterDid) {
        console.error('Usage: alp governance vote <ballot-id> <voter-did> <approve|reject|abstain> [rationale]');
        process.exit(1);
      }
      const result = engine.vote(ballotId, voterDid, value, rationale);
      if (!result.accepted) {
        console.error(`Vote rejected: ${result.reason}`);
        process.exit(1);
      }
      console.log(`Vote recorded for ${ballotId}: ${value}`);
      break;
    }
    case 'close': {
      const ballotId = args[0];
      if (!ballotId) {
        console.error('Usage: alp governance close <ballot-id>');
        process.exit(1);
      }
      const report = engine.close_and_tally(ballotId);
      console.log(`Ballot ${ballotId} closed: ${report.result}`);
      console.log(`  Tally: ${JSON.stringify(report.tally)}`);
      break;
    }
    case 'list': {
      const ballots = engine.list_ballots();
      for (const b of ballots) {
        const tally = b.tally();
        console.log(`- ${b.ballot_id} (${b.status}) ${b.policy_id}: approve=${tally.approve} reject=${tally.reject} abstain=${tally.abstain}`);
      }
      break;
    }
    default:
      console.error(`Unknown governance subcommand: ${subcommand}`);
      process.exit(1);
  }
}
