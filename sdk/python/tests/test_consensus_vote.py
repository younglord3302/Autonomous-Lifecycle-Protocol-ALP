import unittest
from alp_sdk.consensus_vote import (
    ConsensusVoteEngine,
    ConsensusVoteConfig,
    AgentVote,
    ConsensusTallyResult,
)

class TestConsensusVoteConfig(unittest.TestCase):
    def test_default_values(self):
        config = ConsensusVoteConfig("v1", "Test Proposal")
        self.assertEqual(config.id, "v1")
        self.assertEqual(config.proposal, "Test Proposal")
        self.assertEqual(config.voting_strategy, "majority")
        self.assertEqual(config.quorum, 0.5)

class TestConsensusVoteEngine(unittest.TestCase):
    def test_create_and_tally_majority_vote(self):
        engine = ConsensusVoteEngine()
        config = engine.create_proposal("v1", "Deploy v33.0.0", "majority", 0.5)
        self.assertEqual(config.id, "v1")

        engine.cast_vote("v1", "agent-1", "approve")
        engine.cast_vote("v1", "agent-2", "approve")
        engine.cast_vote("v1", "agent-3", "reject")

        result = engine.tally_consensus("v1", eligible_voters_count=4)
        self.assertIsInstance(result, ConsensusTallyResult)
        self.assertTrue(result.passed)
        self.assertEqual(result.winning_choice, "approve")
        self.assertEqual(result.vote_breakdown["approve"], 2.0)
        self.assertEqual(result.vote_breakdown["reject"], 1.0)

    def test_unanimous_failure_on_split(self):
        engine = ConsensusVoteEngine()
        engine.create_proposal("v-unan", "Strict schema change", "unanimous", 0.5)

        engine.cast_vote("v-unan", "a1", "approve")
        engine.cast_vote("v-unan", "a2", "reject")

        result = engine.tally_consensus("v-unan", eligible_voters_count=2)
        self.assertFalse(result.passed)

    def test_unknown_vote_session(self):
        engine = ConsensusVoteEngine()
        result = engine.tally_consensus("unknown")
        self.assertFalse(result.passed)
        self.assertEqual(result.winning_choice, "NONE")
