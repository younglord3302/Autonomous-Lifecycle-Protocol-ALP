/** ALP Self-Sovereign Identity (v18.0.0 — V14 The Sovereign Era).
 *
 * W3C DID-based agent identity without a central authority:
 *
 * - `AgentIdentity`         — creates/manages DIDs (decentralized identifiers).
 * - `IdentityResolver`      — verifies presentations against a trust registry.
 * - `TrustRegistry`         — maps DIDs to permission scopes and trust levels.
 * - `VerifiablePresentation` — signed identity proof from agent to verifier.
 * - `AgentKeyStore`         — persists agent key pairs for DID operations.
 *
 * Mirrors `sdk/python/alp_sdk/identity.py`.
 */

import * as crypto from 'node:crypto'
import * as fs from 'fs'
import * as path from 'path'

export interface AgentIdentityData {
  did: string
  agent_id: string
  public_key: string
  created_at: string
  metadata: Record<string, any>
}

export class AgentIdentity {
  did: string
  agent_id: string
  public_key: string
  created_at: string
  metadata: Record<string, any>

  constructor(did: string, agent_id: string, public_key: string, created_at = '', metadata: Record<string, any> = {}) {
    this.did = did
    this.agent_id = agent_id
    this.public_key = public_key
    this.created_at = created_at || new Date().toISOString()
    this.metadata = metadata
  }

  toDict(): AgentIdentityData {
    return {
      did: this.did,
      agent_id: this.agent_id,
      public_key: this.public_key,
      created_at: this.created_at,
      metadata: this.metadata,
    }
  }

  static fromDict(d: Record<string, any>): AgentIdentity {
    return new AgentIdentity(
      d.did ?? d['did'],
      d.agent_id ?? d['agent_id'],
      d.public_key ?? d['public_key'],
      d.created_at ?? '',
      d.metadata ?? {},
    )
  }
}

export interface VerifiablePresentationData {
  did: string
  agent_id: string
  claims: Record<string, any>
  signature: string
  issued_at: string
}

export class VerifiablePresentation {
  did: string
  agent_id: string
  claims: Record<string, any>
  signature: string
  issued_at: string

  constructor(did: string, agent_id: string, claims: Record<string, any>, signature: string, issued_at = '') {
    this.did = did
    this.agent_id = agent_id
    this.claims = claims
    this.signature = signature
    this.issued_at = issued_at || new Date().toISOString()
  }

  toDict(): VerifiablePresentationData {
    return {
      did: this.did,
      agent_id: this.agent_id,
      claims: this.claims,
      signature: this.signature,
      issued_at: this.issued_at,
    }
  }

  verify(public_key: string): boolean {
    const payload = JSON.stringify({ did: this.did, agent_id: this.agent_id, claims: this.claims })
    const expected = sha256(payload + public_key)
    return this.signature === expected
  }
}

export interface TrustEntry {
  agent_id: string
  scopes: string[]
  trust_level: string
  registered_at: string
}

export class TrustRegistry {
  private alp_dir: string
  private entries: Record<string, TrustEntry> = {}

  constructor(alp_dir: string) {
    this.alp_dir = alp_dir
    this.load()
  }

  private identityDir(): string {
    return path.join(this.alp_dir, '.identity')
  }

  private trustPath(): string {
    return path.join(this.identityDir(), 'trust_registry.json')
  }

  load(): void {
    const p = this.trustPath()
    if (!fs.existsSync(p)) return
    try {
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'))
      if (typeof data === 'object' && data) {
        this.entries = data as Record<string, TrustEntry>
      }
    } catch {
      this.entries = {}
    }
  }

  save(): void {
    const d = this.identityDir()
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true })
    }
    fs.writeFileSync(this.trustPath(), JSON.stringify(this.entries, null, 2))
  }

  register(did: string, agent_id: string, scopes: string[], trust_level = 'standard'): TrustEntry {
    const entry: TrustEntry = {
      agent_id,
      scopes,
      trust_level,
      registered_at: new Date().toISOString(),
    }
    this.entries[did] = entry
    this.save()
    return entry
  }

  resolve(did: string): TrustEntry | undefined {
    return this.entries[did]
  }

  revoke(did: string): boolean {
    if (did in this.entries) {
      delete this.entries[did]
      this.save()
      return true
    }
    return false
  }

  listDids(): string[] {
    return Object.keys(this.entries)
  }

  hasScope(did: string, required_scope: string): boolean {
    const entry = this.entries[did]
    if (!entry) return false
    return entry.scopes.includes(required_scope)
  }
}

export class IdentityResolver {
  constructor(private trust_registry: TrustRegistry) {}

  verifyPresentation(presentation: VerifiablePresentation, public_key: string): Record<string, any> {
    if (!presentation.verify(public_key)) {
      return { valid: false, reason: 'invalid_signature' }
    }
    const entry = this.trust_registry.resolve(presentation.did)
    if (!entry) {
      return { valid: false, reason: 'unknown_did' }
    }
    return {
      valid: true,
      did: presentation.did,
      agent_id: presentation.agent_id,
      scopes: entry.scopes,
      trust_level: entry.trust_level,
    }
  }
}

export interface KeyPair {
  public_key: string
  private_key: string
}

export class AgentKeyStore {
  private alp_dir: string
  private keys: Record<string, KeyPair> = {}

  constructor(alp_dir: string) {
    this.alp_dir = alp_dir
    this.load()
  }

  private identityDir(): string {
    return path.join(this.alp_dir, '.identity')
  }

  private keysPath(): string {
    return path.join(this.identityDir(), 'agent_keys.json')
  }

  load(): void {
    const p = this.keysPath()
    if (!fs.existsSync(p)) return
    try {
      this.keys = JSON.parse(fs.readFileSync(p, 'utf-8'))
    } catch {
      this.keys = {}
    }
  }

  save(): void {
    const d = this.identityDir()
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true })
    }
    fs.writeFileSync(this.keysPath(), JSON.stringify(this.keys, null, 2))
  }

  storeKey(did: string, public_key: string, private_key: string): void {
    this.keys[did] = { public_key, private_key }
    this.save()
  }

  getKey(did: string): KeyPair | undefined {
    return this.keys[did]
  }

  removeKey(did: string): boolean {
    if (did in this.keys) {
      delete this.keys[did]
      this.save()
      return true
    }
    return false
  }
}

export function generateKeypair(): KeyPair {
  const private_key = crypto.randomUUID().replace(/-/g, '')
  const public_key = sha256(private_key)
  return { public_key, private_key }
}

export function createDid(agent_id: string, public_key: string): string {
  const key_hash = sha256(public_key).slice(0, 16)
  return `did:alp:${agent_id}:${key_hash}`
}

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex')
}
