"""ALP Autonomous Governance (v18.3.0 — V14 The Sovereign Era).

Agents vote on policy changes:

* ``PolicyBallot``     — collects signed votes from qualified agents.
* ``GovernanceEngine`` — tallies results and enforces quorum rules.
* ``BallotRecord``     — immutable ballot record stored in ``ProvenanceStore``.

Mirrors the planned ``parser/src/governance.ts`` surface; tests live in
``sdk/python/tests/test_governance.py``.
"""

import hashlib
import json
import os
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Set


GOVERNANCE_DIR = ".governance"
BALLOTS_FILE = "ballots.jsonl"


def governance_dir(alp_dir: str) -> str:
    return os.path.join(alp_dir, GOVERNANCE_DIR)


def ballots_path(alp_dir: str) -> str:
    return os.path.join(governance_dir(alp_dir), BALLOTS_FILE)


class VoteValue(str, Enum):
    APPROVE = "approve"
    REJECT = "reject"
    ABSTAIN = "abstain"


@dataclass
class Vote:
    voter_did: str
    ballot_id: str
    value: str
    rationale: str = ""
    timestamp: str = ""

    def __post_init__(self):
        if not self.timestamp:
            self.timestamp = _now_iso()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "voter_did": self.voter_did,
            "ballot_id": self.ballot_id,
            "value": self.value,
            "rationale": self.rationale,
            "timestamp": self.timestamp,
        }

    def sign(self, private_key: str) -> str:
        payload = json.dumps(self.to_dict(), sort_keys=True, default=str).encode()
        return hashlib.sha256(payload + private_key.encode()).hexdigest()


@dataclass
class BallotRecord:
    ballot_id: str
    policy_id: str
    description: str
    votes: List[Vote] = field(default_factory=list)
    status: str = "open"
    quorum: int = 3
    created_at: str = ""
    closed_at: str = ""

    def __post_init__(self):
        if not self.created_at:
            self.created_at = _now_iso()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "ballot_id": self.ballot_id,
            "policy_id": self.policy_id,
            "description": self.description,
            "votes": [v.to_dict() for v in self.votes],
            "status": self.status,
            "quorum": self.quorum,
            "created_at": self.created_at,
            "closed_at": self.closed_at,
        }

    def tally(self) -> Dict[str, Any]:
        counts = {v: 0 for v in ["approve", "reject", "abstain"]}
        for vote in self.votes:
            counts[vote.value] = counts.get(vote.value, 0) + 1
        return {
            "approve": counts["approve"],
            "reject": counts["reject"],
            "abstain": counts["abstain"],
            "total": len(self.votes),
        }


@dataclass
class GovernanceReport:
    ballot_id: str
    result: str
    tally: Dict[str, Any]
    started_at: str = ""
    finished_at: str = ""

    def __post_init__(self):
        if not self.started_at:
            self.started_at = _now_iso()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "ballot_id": self.ballot_id,
            "result": self.result,
            "tally": self.tally,
            "started_at": self.started_at,
            "finished_at": self.finished_at or _now_iso(),
        }


class PolicyBallot:
    """Collects signed votes from qualified agents for a policy change."""

    def __init__(self, alp_dir: str):
        self.alp_dir = alp_dir
        self._ballots: Dict[str, BallotRecord] = {}
        self._load()

    def _load(self) -> None:
        p = ballots_path(self.alp_dir)
        if not os.path.exists(p):
            return
        try:
            with open(p, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    entry = json.loads(line)
                    votes = [Vote(**v) for v in entry.get("votes", [])]
                    ballot = BallotRecord(
                        ballot_id=entry["ballot_id"],
                        policy_id=entry["policy_id"],
                        description=entry["description"],
                        votes=votes,
                        status=entry.get("status", "open"),
                        quorum=entry.get("quorum", 3),
                        created_at=entry.get("created_at", ""),
                        closed_at=entry.get("closed_at", ""),
                    )
                    self._ballots[ballot.ballot_id] = ballot
        except Exception:
            self._ballots = {}

    def _save_ballot(self, ballot: BallotRecord) -> None:
        d = governance_dir(self.alp_dir)
        if not os.path.exists(d):
            os.makedirs(d, exist_ok=True)
        with open(ballots_path(self.alp_dir), "a", encoding="utf-8") as f:
            f.write(json.dumps(ballot.to_dict()) + "\n")

    def open_ballot(self, policy_id: str, description: str, quorum: int = 3) -> BallotRecord:
        ballot_id = f"ballot-{uuid.uuid4().hex[:12]}"
        ballot = BallotRecord(ballot_id=ballot_id, policy_id=policy_id, description=description, quorum=quorum)
        self._ballots[ballot_id] = ballot
        self._save_ballot(ballot)
        return ballot

    def cast_vote(self, ballot_id: str, voter_did: str, value: str, rationale: str = "", private_key: str = "") -> Optional[Vote]:
        ballot = self._ballots.get(ballot_id)
        if not ballot or ballot.status != "open":
            return None
        vote = Vote(voter_did=voter_did, ballot_id=ballot_id, value=value, rationale=rationale)
        vote.signature = vote.sign(private_key) if private_key else ""
        ballot.votes.append(vote)
        self._save_ballot(ballot)
        return vote

    def close_ballot(self, ballot_id: str) -> Optional[BallotRecord]:
        ballot = self._ballots.get(ballot_id)
        if not ballot or ballot.status != "open":
            return None
        ballot.status = "closed"
        ballot.closed_at = _now_iso()
        self._save_ballot(ballot)
        return ballot

    def get_ballot(self, ballot_id: str) -> Optional[BallotRecord]:
        return self._ballots.get(ballot_id)

    def list_ballots(self) -> List[BallotRecord]:
        return list(self._ballots.values())


class GovernanceEngine:
    """Tallies ballot results and enforces quorum rules."""

    def __init__(self, alp_dir: str, min_quorum: int = 3):
        self.alp_dir = alp_dir
        self.ballot = PolicyBallot(alp_dir)
        self.min_quorum = min_quorum
        self._qualified_voters: Set[str] = set()

    def qualify(self, voter_did: str) -> None:
        self._qualified_voters.add(voter_did)

    def disqualify(self, voter_did: str) -> None:
        self._qualified_voters.discard(voter_did)

    def propose(self, policy_id: str, description: str, quorum: Optional[int] = None) -> BallotRecord:
        effective_quorum = max(quorum or self.min_quorum, len(self._qualified_voters) // 2 + 1)
        return self.ballot.open_ballot(policy_id, description, quorum=effective_quorum)

    def vote(self, ballot_id: str, voter_did: str, value: str, rationale: str = "", private_key: str = "") -> Dict[str, Any]:
        if voter_did not in self._qualified_voters:
            return {"accepted": False, "reason": "voter_not_qualified"}
        ballot = self.ballot.get_ballot(ballot_id)
        if not ballot or ballot.status != "open":
            return {"accepted": False, "reason": "ballot_not_open"}
        existing = [v for v in ballot.votes if v.voter_did == voter_did]
        if existing:
            return {"accepted": False, "reason": "already_voted"}
        vote = self.ballot.cast_vote(ballot_id, voter_did, value, rationale, private_key)
        if vote is None:
            return {"accepted": False, "reason": "cast_failed"}
        return {"accepted": True, "vote": vote.to_dict()}

    def close_and_tally(self, ballot_id: str) -> GovernanceReport:
        ballot = self.ballot.close_ballot(ballot_id)
        if not ballot:
            raise ValueError(f"Ballot '{ballot_id}' not found or already closed.")
        tally = ballot.tally()
        total = tally["total"]
        if total < ballot.quorum:
            result = "quorum_not_met"
        elif tally["approve"] > tally["reject"]:
            result = "approved"
        elif tally["reject"] > tally["approve"]:
            result = "rejected"
        else:
            result = "tied"
        return GovernanceReport(ballot_id=ballot_id, result=result, tally=tally)

    def get_report(self, ballot_id: str) -> Optional[GovernanceReport]:
        ballot = self.ballot.get_ballot(ballot_id)
        if not ballot or ballot.status != "closed":
            return None
        tally = ballot.tally()
        total = tally["total"]
        if total < ballot.quorum:
            result = "quorum_not_met"
        elif tally["approve"] > tally["reject"]:
            result = "approved"
        elif tally["reject"] > tally["approve"]:
            result = "rejected"
        else:
            result = "tied"
        return GovernanceReport(ballot_id=ballot_id, result=result, tally=tally)


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
