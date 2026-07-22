/** ALP Autonomous Governance (v18.3.0 — V14 The Sovereign Era).
 *
 * Agents vote on policy changes:
 *
 * - `VoteValue`       — enum of vote choices (approve, reject, abstain).
 * - `Vote`            — signed vote from a qualified agent.
 * - `BallotRecord`    — immutable ballot record stored in append-only JSONL.
 * - `GovernanceReport` — tallied result of a closed ballot.
 * - `PolicyBallot`    — collects signed votes from qualified agents.
 * - `GovernanceEngine` — tallies results and enforces quorum rules.
 *
 * Mirrors `sdk/python/alp_sdk/governance.py`.
 */

import * as crypto from 'node:crypto'
import * as fs from 'fs'
import * as path from 'path'

export const GOVERNANCE_DIR = '.governance'
export const BALLOTS_FILE = 'ballots.jsonl'

export enum VoteValue {
  APPROVE = 'approve',
  REJECT = 'reject',
  ABSTAIN = 'abstain',
}

export interface VoteData {
  voter_did: string
  ballot_id: string
  value: string
  rationale: string
  timestamp: string
  signature: string
}

export class Vote {
  voter_did: string
  ballot_id: string
  value: string
  rationale: string
  timestamp: string
  signature: string

  constructor(voter_did: string, ballot_id: string, value: string, rationale = '', timestamp = '', signature = '') {
    this.voter_did = voter_did
    this.ballot_id = ballot_id
    this.value = value
    this.rationale = rationale
    this.timestamp = timestamp || new Date().toISOString()
    this.signature = signature
  }

  toDict(): VoteData {
    return {
      voter_did: this.voter_did,
      ballot_id: this.ballot_id,
      value: this.value,
      rationale: this.rationale,
      timestamp: this.timestamp,
      signature: this.signature,
    }
  }

  sign(private_key: string): string {
    const payload_obj = this.toDict()
    const payload = JSON.stringify(payload_obj, Object.keys(payload_obj).sort())
    this.signature = crypto.createHash('sha256').update(payload + private_key).digest('hex')
    return this.signature
  }
}

export interface BallotRecordData {
  ballot_id: string
  policy_id: string
  description: string
  votes: VoteData[]
  status: string
  quorum: number
  created_at: string
  closed_at: string
}

export class BallotRecord {
  ballot_id: string
  policy_id: string
  description: string
  votes: Vote[] = []
  status: string
  quorum: number
  created_at: string
  closed_at: string

  constructor(ballot_id: string, policy_id: string, description: string, votes: Vote[] = [], status = 'open', quorum = 3, created_at = '', closed_at = '') {
    this.ballot_id = ballot_id
    this.policy_id = policy_id
    this.description = description
    this.votes = votes
    this.status = status
    this.quorum = quorum
    this.created_at = created_at || new Date().toISOString()
    this.closed_at = closed_at
  }

  toDict(): BallotRecordData {
    return {
      ballot_id: this.ballot_id,
      policy_id: this.policy_id,
      description: this.description,
      votes: this.votes.map((v) => v.toDict()),
      status: this.status,
      quorum: this.quorum,
      created_at: this.created_at,
      closed_at: this.closed_at,
    }
  }

  tally(): Record<string, number> {
    const counts: Record<string, number> = { approve: 0, reject: 0, abstain: 0 }
    for (const vote of this.votes) {
      counts[vote.value] = (counts[vote.value] || 0) + 1
    }
    return {
      approve: counts.approve,
      reject: counts.reject,
      abstain: counts.abstain,
      total: this.votes.length,
    }
  }
}

export interface GovernanceReportData {
  ballot_id: string
  result: string
  tally: Record<string, number>
  started_at: string
  finished_at: string
}

export class GovernanceReport {
  ballot_id: string
  result: string
  tally: Record<string, number>
  started_at: string
  finished_at: string

  constructor(ballot_id: string, result: string, tally: Record<string, number>, started_at = '', finished_at = '') {
    this.ballot_id = ballot_id
    this.result = result
    this.tally = tally
    this.started_at = started_at || new Date().toISOString()
    this.finished_at = finished_at || new Date().toISOString()
  }

  toDict(): GovernanceReportData {
    return {
      ballot_id: this.ballot_id,
      result: this.result,
      tally: this.tally,
      started_at: this.started_at,
      finished_at: this.finished_at,
    }
  }
}

export class PolicyBallot {
  private alp_dir: string
  private ballots: Map<string, BallotRecord> = new Map()

  constructor(alp_dir: string) {
    this.alp_dir = alp_dir
    this.load()
  }

  private ballots_path(): string {
    return path.join(this.alp_dir, GOVERNANCE_DIR, BALLOTS_FILE)
  }

  load(): void {
    const p = this.ballots_path()
    if (!fs.existsSync(p)) return
    try {
      const lines = fs.readFileSync(p, 'utf-8').split('\n').filter(Boolean)
      for (const line of lines) {
        const entry = JSON.parse(line)
        const votes = (entry.votes || []).map((v: Record<string, any>) => new Vote(v.voter_did, v.ballot_id, v.value, v.rationale, v.timestamp, v.signature))
        const ballot = new BallotRecord(
          entry.ballot_id,
          entry.policy_id,
          entry.description,
          votes,
          entry.status || 'open',
          entry.quorum || 3,
          entry.created_at || '',
          entry.closed_at || '',
        )
        this.ballots.set(ballot.ballot_id, ballot)
      }
    } catch {
      this.ballots.clear()
    }
  }

  private save_ballot(ballot: BallotRecord): void {
    const d = path.join(this.alp_dir, GOVERNANCE_DIR)
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })
    fs.appendFileSync(this.ballots_path(), JSON.stringify(ballot.toDict()) + '\n')
  }

  open_ballot(policy_id: string, description: string, quorum = 3): BallotRecord {
    const ballot_id = `ballot-${crypto.randomBytes(6).toString('hex')}`
    const ballot = new BallotRecord(ballot_id, policy_id, description, [], 'open', quorum)
    this.ballots.set(ballot_id, ballot)
    this.save_ballot(ballot)
    return ballot
  }

  cast_vote(ballot_id: string, voter_did: string, value: string, rationale = '', private_key = ''): Vote | null {
    const ballot = this.ballots.get(ballot_id)
    if (!ballot || ballot.status !== 'open') return null
    const vote = new Vote(voter_did, ballot_id, value, rationale);
    vote.signature = private_key ? vote.sign(private_key) : '';
    ballot.votes.push(vote)
    this.save_ballot(ballot)
    return vote
  }

  close_ballot(ballot_id: string): BallotRecord | null {
    const ballot = this.ballots.get(ballot_id)
    if (!ballot || ballot.status !== 'open') return null
    ballot.status = 'closed'
    ballot.closed_at = new Date().toISOString()
    this.save_ballot(ballot)
    return ballot
  }

  get_ballot(ballot_id: string): BallotRecord | undefined {
    return this.ballots.get(ballot_id)
  }

  list_ballots(): BallotRecord[] {
    return Array.from(this.ballots.values())
  }
}

export class GovernanceEngine {
  private alp_dir: string
  private ballot: PolicyBallot
  private min_quorum: number
  private qualified_voters: Set<string> = new Set()

  constructor(alp_dir: string, min_quorum = 3) {
    this.alp_dir = alp_dir
    this.ballot = new PolicyBallot(alp_dir)
    this.min_quorum = min_quorum
  }

  qualify(voter_did: string): void {
    this.qualified_voters.add(voter_did)
  }

  disqualify(voter_did: string): void {
    this.qualified_voters.delete(voter_did)
  }

  propose(policy_id: string, description: string, quorum?: number): BallotRecord {
    const effective_quorum = Math.max(quorum || this.min_quorum, Math.floor(this.qualified_voters.size / 2) + 1)
    return this.ballot.open_ballot(policy_id, description, effective_quorum)
  }

  vote(ballot_id: string, voter_did: string, value: string, rationale = '', private_key = ''): Record<string, any> {
    if (!this.qualified_voters.has(voter_did)) {
      return { accepted: false, reason: 'voter_not_qualified' }
    }
    const ballot = this.ballot.get_ballot(ballot_id)
    if (!ballot || ballot.status !== 'open') {
      return { accepted: false, reason: 'ballot_not_open' }
    }
    const existing = ballot.votes.filter((v) => v.voter_did === voter_did)
    if (existing.length > 0) {
      return { accepted: false, reason: 'already_voted' }
    }
    const vote = this.ballot.cast_vote(ballot_id, voter_did, value, rationale, private_key)
    if (!vote) {
      return { accepted: false, reason: 'cast_failed' }
    }
    return { accepted: true, vote: vote.toDict() }
  }

  close_and_tally(ballot_id: string): GovernanceReport {
    const ballot = this.ballot.close_ballot(ballot_id)
    if (!ballot) throw new Error(`Ballot '${ballot_id}' not found or already closed.`)
    return this._tally_ballot(ballot)
  }

  get_report(ballot_id: string): GovernanceReport | null {
    const ballot = this.ballot.get_ballot(ballot_id)
    if (!ballot || ballot.status !== 'closed') return null
    return this._tally_ballot(ballot)
  }

  list_ballots(): BallotRecord[] {
    return this.ballot.list_ballots()
  }

  private _tally_ballot(ballot: BallotRecord): GovernanceReport {
    const tally = ballot.tally()
    const total = tally.total
    let result: string
    if (total < ballot.quorum) {
      result = 'quorum_not_met'
    } else if (tally.approve > tally.reject) {
      result = 'approved'
    } else if (tally.reject > tally.approve) {
      result = 'rejected'
    } else {
      result = 'tied'
    }
    return new GovernanceReport(ballot.ballot_id, result, tally)
  }
}
