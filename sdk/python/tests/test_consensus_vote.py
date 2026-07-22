import pytest
from alp_sdk.consensus_vote import (
    ConsensusVoteEngine,
    ConsensusVoteConfig,
    AgentVote,
    ConsensusTallyResult,
)

class TestConsensusVoteConfig:
    def test_default_values(self):
        config = ConsensusVoteConfig("v1", "Test Proposal")
        assert config.id == "v1"
        assert config.proposal == "Test Proposal"
        assert config.voting_strategy == "majority"
        assert config.quorum == 0.5

class TestConsensusVoteEngine:
    def test_create_and_tally_majority_vote(self):
        engine = ConsensusVoteEngine()
        config = engine.create_proposal("v1", "Deploy v33.0.0", "majority", 0.5)
        assert config.id == "v1"

        engine.cast_vote("v1", "agent-1", "approve")
        engine.cast_vote("v1", "agent-2", "approve")
        engine.cast_vote("v1", "agent-3", "reject")

        result = engine.tally_consensus("v1", eligible_voters_count=4)
        assert isinstance(result, ConsensusTallyResult)
        assert result.passed is True
        assert result.winning_choice == "approve"
        assert result.vote_breakdown["approve"] == 2.0
        assert result.vote_breakdown["reject"] == 1.0

    def test_unanimous_failure_on_split(self):
        engine = ConsensusVoteEngine()
        engine.create_proposal("v-unan", "Strict schema change", "unanimous", 0.5)

        engine.cast_vote("v-unan", "a1", "approve")
        engine.cast_vote("v-unan", "a2", "reject")

        result = engine.tally_consensus("v-unan", eligible_voters_count=2)
        assert result.passed is False

    def test_unknown_vote_session(self):
        engine = ConsensusVoteEngine()
        result = engine.tally_consensus("unknown")
        assert result.passed is False
        assert result.winning_choice == "NONE"
