import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  VoteValue,
  Vote,
  BallotRecord,
  PolicyBallot,
  GovernanceEngine,
  GovernanceReport,
  GOVERNANCE_DIR,
  BALLOTS_FILE,
} from '../src/governance'

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'alp-gov-'))
}

describe('Vote (v18.3.0)', () => {
  it('round-trips through toDict', () => {
    const vote = new Vote('did1', 'ballot1', VoteValue.APPROVE, 'good', '2024-01-01T00:00:00Z', 'sig')
    const dict = vote.toDict()
    expect(dict.voter_did).toBe('did1')
    expect(dict.value).toBe('approve')
  })

  it('signs a vote', () => {
    const vote = new Vote('did1', 'ballot1', VoteValue.APPROVE, 'rationale')
    const sig = vote.sign('private-key')
    expect(sig).toBeTruthy()
    expect(vote.signature).toBe(sig)
  })
})

describe('BallotRecord (v18.3.0)', () => {
  it('tallies votes correctly', () => {
    const ballot = new BallotRecord('b1', 'p1', 'desc')
    ballot.votes.push(new Vote('did1', 'b1', VoteValue.APPROVE))
    ballot.votes.push(new Vote('did2', 'b1', VoteValue.REJECT))
    ballot.votes.push(new Vote('did3', 'b1', VoteValue.APPROVE))
    const tally = ballot.tally()
    expect(tally.approve).toBe(2)
    expect(tally.reject).toBe(1)
    expect(tally.abstain).toBe(0)
    expect(tally.total).toBe(3)
  })
})

describe('PolicyBallot (v18.3.0)', () => {
  it('opens, votes, and closes a ballot', () => {
    const dir = tmpDir()
    const ballot_store = new PolicyBallot(dir)
    const ballot = ballot_store.open_ballot('policy-1', 'desc', 2)
    expect(ballot.status).toBe('open')
    expect(ballot.ballot_id).toBeTruthy()

    ballot_store.cast_vote(ballot.ballot_id, 'did1', VoteValue.APPROVE, 'yes', 'key')
    ballot_store.cast_vote(ballot.ballot_id, 'did2', VoteValue.REJECT, 'no', 'key')
    const closed = ballot_store.close_ballot(ballot.ballot_id)
    expect(closed).not.toBeNull()
    expect(closed!.status).toBe('closed')
    expect(closed!.tally().approve).toBe(1)
  })

  it('persists and reloads ballots', () => {
    const dir = tmpDir()
    const store1 = new PolicyBallot(dir)
    store1.open_ballot('p1', 'd1')

    const store2 = new PolicyBallot(dir)
    expect(store2.list_ballots()).toHaveLength(1)
  })

  it('rejects votes on closed ballots', () => {
    const dir = tmpDir()
    const store = new PolicyBallot(dir)
    const ballot = store.open_ballot('p1', 'd1')
    store.close_ballot(ballot.ballot_id)
    const result = store.cast_vote(ballot.ballot_id, 'did1', VoteValue.APPROVE)
    expect(result).toBeNull()
  })
})

describe('GovernanceEngine (v18.3.0)', () => {
  it('proposes and tallies a ballot', () => {
    const dir = tmpDir()
    const engine = new GovernanceEngine(dir, 2)
    engine.qualify('did1')
    engine.qualify('did2')

    const ballot = engine.propose('policy-1', 'desc')
    expect(ballot.quorum).toBeGreaterThanOrEqual(2)

    engine.vote(ballot.ballot_id, 'did1', VoteValue.APPROVE, '', 'key')
    engine.vote(ballot.ballot_id, 'did2', VoteValue.REJECT, '', 'key')
    const report = engine.close_and_tally(ballot.ballot_id)
    expect(report.result).toBe('tied')
  })

  it('rejects unqualified voters', () => {
    const dir = tmpDir()
    const engine = new GovernanceEngine(dir, 1)
    const ballot = engine.propose('p1', 'd')
    const result = engine.vote(ballot.ballot_id, 'did1', VoteValue.APPROVE)
    expect(result.accepted).toBe(false)
    expect(result.reason).toBe('voter_not_qualified')
  })

  it('rejects duplicate votes', () => {
    const dir = tmpDir()
    const engine = new GovernanceEngine(dir, 1)
    engine.qualify('did1')
    const ballot = engine.propose('p1', 'd')
    engine.vote(ballot.ballot_id, 'did1', VoteValue.APPROVE, '', 'key')
    const result = engine.vote(ballot.ballot_id, 'did1', VoteValue.REJECT, '', 'key')
    expect(result.accepted).toBe(false)
    expect(result.reason).toBe('already_voted')
  })
})
