export type VotingStrategy = 'majority' | 'weighted' | 'unanimous' | 'borda_count';

export interface AgentVote {
  voterAgent: string;
  choice: string;
  weight?: number;
  signature?: string;
}

export interface ConsensusTallyResult {
  voteId: string;
  proposal: string;
  strategy: VotingStrategy;
  quorum: number;
  totalVotesCount: number;
  winningChoice: string;
  passed: boolean;
  voteBreakdown: Record<string, number>;
  talliedAt: string;
}

export interface ConsensusVoteConfig {
  id: string;
  proposal: string;
  votingStrategy: VotingStrategy;
  quorum: number;
  votes: AgentVote[];
  outcome?: string;
  passed?: boolean;
  description?: string;
}

export class ConsensusVoteEngine {
  private votesMap: Map<string, ConsensusVoteConfig> = new Map();

  public createProposal(
    id: string,
    proposal: string,
    votingStrategy: VotingStrategy = 'majority',
    quorum: number = 0.5,
    description?: string
  ): ConsensusVoteConfig {
    const config: ConsensusVoteConfig = {
      id,
      proposal,
      votingStrategy,
      quorum,
      votes: [],
      description,
    };
    this.votesMap.set(id, config);
    return config;
  }

  public castVote(voteId: string, voterAgent: string, choice: string, weight: number = 1.0, signature?: string): boolean {
    const session = this.votesMap.get(voteId);
    if (!session) return false;

    // Prevent duplicate votes from the same agent
    const existingIndex = session.votes.findIndex(v => v.voterAgent === voterAgent);
    const voteData: AgentVote = { voterAgent, choice, weight, signature };

    if (existingIndex >= 0) {
      session.votes[existingIndex] = voteData;
    } else {
      session.votes.push(voteData);
    }

    return true;
  }

  public tallyConsensus(voteId: string, eligibleVotersCount: number = 5): ConsensusTallyResult {
    const session = this.votesMap.get(voteId);
    if (!session || session.votes.length === 0) {
      return {
        voteId,
        proposal: session?.proposal || 'unknown',
        strategy: session?.votingStrategy || 'majority',
        quorum: session?.quorum || 0.5,
        totalVotesCount: 0,
        winningChoice: 'NONE',
        passed: false,
        voteBreakdown: {},
        talliedAt: new Date().toISOString(),
      };
    }

    const voteBreakdown: Record<string, number> = {};
    let totalWeight = 0;

    for (const v of session.votes) {
      const w = session.votingStrategy === 'weighted' ? (v.weight || 1.0) : 1.0;
      voteBreakdown[v.choice] = (voteBreakdown[v.choice] || 0) + w;
      totalWeight += w;
    }

    // Find winning choice
    let winningChoice = 'NONE';
    let maxVotes = -1;

    for (const [choice, count] of Object.entries(voteBreakdown)) {
      if (count > maxVotes) {
        maxVotes = count;
        winningChoice = choice;
      }
    }

    const turnoutRatio = session.votes.length / Math.max(1, eligibleVotersCount);
    const quorumMet = turnoutRatio >= session.quorum;

    let passed = quorumMet;

    if (session.votingStrategy === 'unanimous') {
      const uniqueChoices = Object.keys(voteBreakdown);
      passed = quorumMet && uniqueChoices.length === 1 && uniqueChoices[0] === 'approve';
    } else if (session.votingStrategy === 'majority') {
      passed = quorumMet && (voteBreakdown['approve'] || 0) > (session.votes.length / 2);
    } else {
      passed = quorumMet && winningChoice !== 'NONE' && winningChoice !== 'reject';
    }

    session.outcome = winningChoice;
    session.passed = passed;

    return {
      voteId,
      proposal: session.proposal,
      strategy: session.votingStrategy,
      quorum: session.quorum,
      totalVotesCount: session.votes.length,
      winningChoice,
      passed,
      voteBreakdown,
      talliedAt: new Date().toISOString(),
    };
  }

  public getSession(id: string): ConsensusVoteConfig | undefined {
    return this.votesMap.get(id);
  }
}
