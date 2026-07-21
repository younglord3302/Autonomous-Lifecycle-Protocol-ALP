import os
import sys
import unittest

SDK_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SDK_ROOT not in sys.path:
    sys.path.insert(0, SDK_ROOT)

from alp_sdk.governance import (
    BallotRecord,
    GovernanceEngine,
    GovernanceReport,
    PolicyBallot,
    Vote,
    VoteValue,
    governance_dir,
    ballots_path,
)


class TestVote(unittest.TestCase):
    def test_sign_and_verify(self):
        vote = Vote(voter_did="did:alp:a:1", ballot_id="b1", value="approve", rationale="good")
        signature = vote.sign("priv")
        self.assertIsNotNone(signature)
        self.assertEqual(len(signature), 64)

    def test_to_dict(self):
        vote = Vote(voter_did="did:alp:a:1", ballot_id="b1", value="reject")
        d = vote.to_dict()
        self.assertEqual(d["value"], "reject")
        self.assertEqual(d["voter_did"], "did:alp:a:1")


class TestBallotRecord(unittest.TestCase):
    def test_tally_empty(self):
        ballot = BallotRecord(ballot_id="b1", policy_id="p1", description="d", votes=[])
        tally = ballot.tally()
        self.assertEqual(tally["total"], 0)
        self.assertEqual(tally["approve"], 0)

    def test_tally_mixed(self):
        votes = [
            Vote("did:1", "b1", "approve"),
            Vote("did:2", "b1", "reject"),
            Vote("did:3", "b1", "approve"),
        ]
        ballot = BallotRecord(ballot_id="b1", policy_id="p1", description="d", votes=votes)
        tally = ballot.tally()
        self.assertEqual(tally["approve"], 2)
        self.assertEqual(tally["reject"], 1)


class TestPolicyBallot(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.tmpdir = tempfile.mkdtemp()
        self.ballot = PolicyBallot(self.tmpdir)

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_open_ballot(self):
        b = self.ballot.open_ballot("p1", "Change policy", quorum=3)
        self.assertIsNotNone(b.ballot_id)
        self.assertEqual(b.policy_id, "p1")
        self.assertEqual(b.status, "open")

    def test_cast_and_close_vote(self):
        b = self.ballot.open_ballot("p1", "d", quorum=2)
        vote = self.ballot.cast_vote(b.ballot_id, "did:1", "approve", "yes", "priv")
        self.assertIsNotNone(vote)
        closed = self.ballot.close_ballot(b.ballot_id)
        self.assertIsNotNone(closed)
        self.assertEqual(closed.status, "closed")

    def test_cannot_vote_on_closed_ballot(self):
        b = self.ballot.open_ballot("p1", "d")
        self.ballot.close_ballot(b.ballot_id)
        vote = self.ballot.cast_vote(b.ballot_id, "did:1", "approve")
        self.assertIsNone(vote)

    def test_persists_ballots(self):
        b = self.ballot.open_ballot("p1", "d")
        p = ballots_path(self.tmpdir)
        self.assertTrue(os.path.exists(p))


class TestGovernanceEngine(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.tmpdir = tempfile.mkdtemp()
        self.engine = GovernanceEngine(self.tmpdir, min_quorum=2)
        self.engine.qualify("did:alp:a:1")
        self.engine.qualify("did:alp:a:2")
        self.engine.qualify("did:alp:a:3")

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_propose_creates_ballot(self):
        ballot = self.engine.propose("p1", "Update policy")
        self.assertIsNotNone(ballot)
        self.assertEqual(ballot.policy_id, "p1")

    def test_qualified_voter_can_vote(self):
        ballot = self.engine.propose("p1", "d")
        result = self.engine.vote(ballot.ballot_id, "did:alp:a:1", "approve", "yes", "priv")
        self.assertTrue(result["accepted"])

    def test_unqualified_voter_rejected(self):
        ballot = self.engine.propose("p1", "d")
        result = self.engine.vote(ballot.ballot_id, "did:alp:unknown", "approve")
        self.assertFalse(result["accepted"])
        self.assertEqual(result["reason"], "voter_not_qualified")

    def test_duplicate_vote_rejected(self):
        ballot = self.engine.propose("p1", "d")
        self.engine.vote(ballot.ballot_id, "did:alp:a:1", "approve", "yes", "priv")
        result = self.engine.vote(ballot.ballot_id, "did:alp:a:1", "reject")
        self.assertFalse(result["accepted"])
        self.assertEqual(result["reason"], "already_voted")

    def test_close_and_tally_approved(self):
        ballot = self.engine.propose("p1", "d")
        self.engine.vote(ballot.ballot_id, "did:alp:a:1", "approve", "yes", "priv")
        self.engine.vote(ballot.ballot_id, "did:alp:a:2", "approve", "yes", "priv")
        report = self.engine.close_and_tally(ballot.ballot_id)
        self.assertEqual(report.result, "approved")
        self.assertEqual(report.tally["approve"], 2)

    def test_close_and_tally_rejected(self):
        ballot = self.engine.propose("p1", "d")
        self.engine.vote(ballot.ballot_id, "did:alp:a:1", "reject", "no", "priv")
        self.engine.vote(ballot.ballot_id, "did:alp:a:2", "reject", "no", "priv")
        report = self.engine.close_and_tally(ballot.ballot_id)
        self.assertEqual(report.result, "rejected")

    def test_quorum_not_met(self):
        ballot = self.engine.propose("p1", "d", quorum=5)
        self.engine.vote(ballot.ballot_id, "did:alp:a:1", "approve", "yes", "priv")
        self.engine.vote(ballot.ballot_id, "did:alp:a:2", "approve", "yes", "priv")
        report = self.engine.close_and_tally(ballot.ballot_id)
        self.assertEqual(report.result, "quorum_not_met")

    def test_get_report(self):
        ballot = self.engine.propose("p1", "d")
        self.engine.vote(ballot.ballot_id, "did:alp:a:1", "approve", "yes", "priv")
        self.engine.vote(ballot.ballot_id, "did:alp:a:2", "approve", "yes", "priv")
        self.engine.close_and_tally(ballot.ballot_id)
        report = self.engine.get_report(ballot.ballot_id)
        self.assertIsNotNone(report)
        self.assertEqual(report.result, "approved")

    def test_get_report_returns_none_for_open(self):
        ballot = self.engine.propose("p1", "d")
        report = self.engine.get_report(ballot.ballot_id)
        self.assertIsNone(report)


if __name__ == "__main__":
    unittest.main()
