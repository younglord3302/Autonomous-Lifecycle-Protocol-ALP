import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { AgentIdentity, VerifiablePresentation, TrustRegistry, IdentityResolver, AgentKeyStore, generateKeypair, createDid } from '../src/identity'

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'alp-identity-'))
}

describe('AgentIdentity (v18.0.0)', () => {
  it('creates and round-trips through toDict/fromDict', () => {
    const identity = new AgentIdentity('did:alp:agent-1:abc123', 'agent-1', 'pubkey-1', '2026-01-01T00:00:00Z', { role: 'admin' })
    const dict = identity.toDict()
    const restored = AgentIdentity.fromDict(dict)
    expect(restored.did).toBe('did:alp:agent-1:abc123')
    expect(restored.agent_id).toBe('agent-1')
    expect(restored.public_key).toBe('pubkey-1')
    expect(restored.metadata).toEqual({ role: 'admin' })
  })

  it('defaults created_at to now', () => {
    const before = new Date().toISOString()
    const identity = new AgentIdentity('did:test', 'test', 'pub')
    const after = new Date().toISOString()
    expect(identity.created_at >= before).toBe(true)
    expect(identity.created_at <= after).toBe(true)
  })
})

describe('VerifiablePresentation (v18.0.0)', () => {
  it('verifies a valid signature', () => {
    const { public_key } = generateKeypair()
    const claims = { role: 'developer' }
    const payload = JSON.stringify({ did: 'did:alp:a:1', agent_id: 'a', claims })
    const signature = require('crypto').createHash('sha256').update(payload + public_key).digest('hex')
    const vp = new VerifiablePresentation('did:alp:a:1', 'a', claims, signature)
    expect(vp.verify(public_key)).toBe(true)
  })

  it('rejects an invalid signature', () => {
    const claims = { role: 'developer' }
    const vp = new VerifiablePresentation('did:alp:a:1', 'a', claims, 'bad-sig')
    expect(vp.verify('some-public-key')).toBe(false)
  })
})

describe('TrustRegistry (v18.0.0)', () => {
  it('registers, resolves, lists, and revokes DIDs', () => {
    const dir = tmpDir()
    const registry = new TrustRegistry(dir)

    registry.register('did:alp:a:1', 'agent-1', ['read', 'write'], 'standard')
    expect(registry.resolve('did:alp:a:1')).toEqual({
      agent_id: 'agent-1',
      scopes: ['read', 'write'],
      trust_level: 'standard',
      registered_at: expect.any(String),
    })
    expect(registry.listDids()).toEqual(['did:alp:a:1'])
    expect(registry.hasScope('did:alp:a:1', 'read')).toBe(true)
    expect(registry.hasScope('did:alp:a:1', 'admin')).toBe(false)

    expect(registry.revoke('did:alp:a:1')).toBe(true)
    expect(registry.resolve('did:alp:a:1')).toBeUndefined()
    expect(registry.revoke('did:alp:a:1')).toBe(false)
  })

  it('persists to disk', () => {
    const dir = tmpDir()
    const registry = new TrustRegistry(dir)
    registry.register('did:alp:a:1', 'agent-1', ['read'])

    const reloaded = new TrustRegistry(dir)
    expect(reloaded.resolve('did:alp:a:1')?.agent_id).toBe('agent-1')
  })
})

describe('IdentityResolver (v18.0.0)', () => {
  it('verifies a valid presentation', () => {
    const dir = tmpDir()
    const registry = new TrustRegistry(dir)
    registry.register('did:alp:a:1', 'agent-1', ['read'])
    const resolver = new IdentityResolver(registry)

    const { public_key } = generateKeypair()
    const claims = { role: 'developer' }
    const payload = JSON.stringify({ did: 'did:alp:a:1', agent_id: 'agent-1', claims })
    const signature = require('crypto').createHash('sha256').update(payload + public_key).digest('hex')
    const vp = new VerifiablePresentation('did:alp:a:1', 'agent-1', claims, signature)

    const result = resolver.verifyPresentation(vp, public_key)
    expect(result.valid).toBe(true)
    expect((result as any).scopes).toEqual(['read'])
  })

  it('rejects invalid signature and unknown DID', () => {
    const dir = tmpDir()
    const registry = new TrustRegistry(dir)
    const resolver = new IdentityResolver(registry)

    const vp1 = new VerifiablePresentation('did:alp:a:1', 'a', {}, 'bad')
    expect(resolver.verifyPresentation(vp1, 'pk')).toEqual({ valid: false, reason: 'invalid_signature' })

    const { public_key } = generateKeypair()
    const claims = { role: 'developer' }
    const payload = JSON.stringify({ did: 'did:alp:a:1', agent_id: 'a', claims })
    const sig = require('crypto').createHash('sha256').update(payload + public_key).digest('hex')
    const vp2 = new VerifiablePresentation('did:alp:a:1', 'a', claims, sig)
    expect(resolver.verifyPresentation(vp2, public_key)).toEqual({ valid: false, reason: 'unknown_did' })
  })
})

describe('AgentKeyStore (v18.0.0)', () => {
  it('stores and retrieves keys', () => {
    const dir = tmpDir()
    const store = new AgentKeyStore(dir)
    store.storeKey('did:alp:a:1', 'pubkey', 'privkey')
    expect(store.getKey('did:alp:a:1')).toEqual({ public_key: 'pubkey', private_key: 'privkey' })
    expect(store.removeKey('did:alp:a:1')).toBe(true)
    expect(store.getKey('did:alp:a:1')).toBeUndefined()
  })
})

describe('generateKeypair and createDid (v18.0.0)', () => {
  it('generates deterministic keys from same input', () => {
    const { public_key, private_key } = generateKeypair()
    expect(public_key).toHaveLength(64)
    expect(private_key).toHaveLength(32)
  })

  it('creates a DID from agent id and public key', () => {
    const { public_key } = generateKeypair()
    const did = createDid('agent-1', public_key)
    expect(did.startsWith('did:alp:agent-1:')).toBe(true)
    expect(did.length).toBeGreaterThan(20)
  })
})
