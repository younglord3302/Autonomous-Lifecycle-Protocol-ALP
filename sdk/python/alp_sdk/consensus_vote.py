from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

class AgentVote:
    __test__ = False

    def __init__(self, voter_agent: str, choice: str, weight: float = 1.0, signature: Optional[str] = None):
        self.voter_agent = voter_agent
        self.choice = choice
        self.weight = weight
        self.signature = signature

class ConsensusTallyResult:
    __test__ = False

    def __init__(
        self,
        vote_id: str,
        proposal: str,
        strategy: str,
        quorum: float,
        total_votes_count: int,
        winning_choice: str,
        passed: bool,
        vote_breakdown: Dict[str, float],
        tallied_at: Optional[str] = None,
    ):
        self.vote_id = vote_id
        self.proposal = proposal
        self.strategy = strategy
        self.quorum = quorum
        self.total_votes_count = total_votes_count
        self.winning_choice = winning_choice
        self.passed = passed
        self.vote_breakdown = vote_breakdown
        self.tallied_at = tallied_at or datetime.now(timezone.utc).isoformat()

class ConsensusVoteConfig:
    __test__ = False

    def __init__(
        self,
        vote_id: str,
        proposal: str,
        voting_strategy: str = "majority",
        quorum: float = 0.5,
        votes: Optional[List[AgentVote]] = None,
        outcome: Optional[str] = None,
        passed: Optional[bool] = None,
        description: Optional[str] = None,
    ):
        self.id = vote_id
        self.proposal = proposal
        self.voting_strategy = voting_strategy
        self.quorum = quorum
        self.votes = votes or []
        self.outcome = outcome
        self.passed = passed
        self.description = description

class ConsensusVoteEngine:
    def __init__(self):
        self.votes_map: Dict[str, ConsensusVoteConfig] = {}

    def create_proposal(
        self,
        vote_id: str,
        proposal: str,
        voting_strategy: str = "majority",
        quorum: float = 0.5,
        description: Optional[str] = None,
    ) -> ConsensusVoteConfig:
        config = ConsensusVoteConfig(
            vote_id=vote_id,
            proposal=proposal,
            voting_strategy=voting_strategy,
            quorum=quorum,
            description=description,
        )
        self.votes_map[vote_id] = config
        return config

    def cast_vote(
        self,
        vote_id: str,
        voter_agent: str,
        choice: str,
        weight: float = 1.0,
        signature: Optional[str] = None,
    ) -> bool:
        session = self.votes_map.get(vote_id)
        if not session:
            return False

        vote_data = AgentVote(voter_agent=voter_agent, choice=choice, weight=weight, signature=signature)
        for idx, existing in enumerate(session.votes):
            if existing.voter_agent == voter_agent:
                session.votes[idx] = vote_data
                return True

        session.votes.append(vote_data)
        return True

    def tally_consensus(self, vote_id: str, eligible_voters_count: int = 5) -> ConsensusTallyResult:
        session = self.votes_map.get(vote_id)
        if not session or not session.votes:
            return ConsensusTallyResult(
                vote_id=vote_id,
                proposal=session.proposal if session else "unknown",
                strategy=session.voting_strategy if session else "majority",
                quorum=session.quorum if session else 0.5,
                total_votes_count=0,
                winning_choice="NONE",
                passed=False,
                vote_breakdown={},
            )

        vote_breakdown: Dict[str, float] = {}
        for v in session.votes:
            w = v.weight if session.voting_strategy == "weighted" else 1.0
            vote_breakdown[v.choice] = vote_breakdown.get(v.choice, 0.0) + w

        winning_choice = "NONE"
        max_votes = -1.0
        for choice, count in vote_breakdown.items():
            if count > max_votes:
                max_votes = count
                winning_choice = choice

        turnout_ratio = len(session.votes) / max(1, eligible_voters_count)
        quorum_met = turnout_ratio >= session.quorum

        if session.voting_strategy == "unanimous":
            unique_choices = list(vote_breakdown.keys())
            passed = quorum_met and len(unique_choices) == 1 and unique_choices[0] == "approve"
        elif session.voting_strategy == "majority":
            passed = quorum_met and vote_breakdown.get("approve", 0.0) > (len(session.votes) / 2)
        else:
            passed = quorum_met and winning_choice not in ("NONE", "reject")

        session.outcome = winning_choice
        session.passed = passed

        return ConsensusTallyResult(
            vote_id=vote_id,
            proposal=session.proposal,
            strategy=session.voting_strategy,
            quorum=session.quorum,
            total_votes_count=len(session.votes),
            winning_choice=winning_choice,
            passed=passed,
            vote_breakdown=vote_breakdown,
        )

    def get_session(self, vote_id: str) -> Optional[ConsensusVoteConfig]:
        return self.votes_map.get(vote_id)
