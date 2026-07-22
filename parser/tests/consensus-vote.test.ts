import { describe, it, expect } from 'vitest';
import { ConsensusVoteEngine } from '../src/consensus-vote';

describe('ConsensusVoteEngine (v33.0.0)', () => {
  it('creates proposal and tallies majority vote successfully', () => {
    const engine = new ConsensusVoteEngine();
    const config = engine.createProposal('vote-1', 'Deploy v33 feature', 'majority', 0.5);

    expect(config.id).toBe('vote-1');
    expect(config.proposal).toBe('Deploy v33 feature');

    engine.castVote('vote-1', 'agent-a', 'approve');
    engine.castVote('vote-1', 'agent-b', 'approve');
    engine.castVote('vote-1', 'agent-c', 'reject');

    const result = engine.tallyConsensus('vote-1', 4);
    expect(result.passed).toBe(true);
    expect(result.winningChoice).toBe('approve');
    expect(result.voteBreakdown['approve']).toBe(2);
    expect(result.voteBreakdown['reject']).toBe(1);
  });

  it('enforces unanimous voting strategy', () => {
    const engine = new ConsensusVoteEngine();
    engine.createProposal('vote-unan', 'Critical Schema Change', 'unanimous', 0.5);

    engine.castVote('vote-unan', 'agent-1', 'approve');
    engine.castVote('vote-unan', 'agent-2', 'reject');

    const result = engine.tallyConsensus('vote-unan', 2);
    expect(result.passed).toBe(false);
  });

  it('handles empty or missing vote sessions', () => {
    const engine = new ConsensusVoteEngine();
    const result = engine.tallyConsensus('missing-vote');
    expect(result.passed).toBe(false);
    expect(result.winningChoice).toBe('NONE');
  });
});
