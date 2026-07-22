/** ALP Cross-Domain Trust (v18.4.0 — V14 The Sovereign Era).
 *
 * Trust bootstrapping between sovereign domains:
 *
 * - `TrustRoot`        — signed root of trust for a domain.
 * - `DomainLink`       — bilateral trust relationship between domains.
 * - `DomainTrustAnchor` — exchanges signed trust roots with foreign domains.
 * - `DomainTrustManager` — manages trust links between local and remote domains.
 *
 * Enables cross-domain agent authentication without a global CA.
 * `alp trust link <domain>` establishes bilateral trust.
 *
 * Mirrors `sdk/python/alp_sdk/domain_trust.py`.
 */

import * as crypto from 'node:crypto'
import * as fs from 'fs'
import * as path from 'path'

export const TRUST_DIR = '.trust'
export const DOMAINS_FILE = 'domains.jsonl'
export const LINKS_FILE = 'links.jsonl'

export enum TrustStatus {
  ACTIVE = 'active',
  PENDING = 'pending',
  REVOKED = 'revoked',
  EXPIRED = 'expired',
}

export interface TrustRootData {
  domain_id: string
  public_key: string
  signature: string
  created_at: string
  expires_at: string | null
  metadata: Record<string, any>
}

export class TrustRoot {
  domain_id: string
  public_key: string
  signature: string
  created_at: string
  expires_at: string | null
  metadata: Record<string, any>

  constructor(domain_id: string, public_key: string, signature = '', created_at = '', expires_at: string | null = null, metadata: Record<string, any> = {}) {
    this.domain_id = domain_id
    this.public_key = public_key
    this.signature = signature
    this.created_at = created_at || new Date().toISOString()
    this.expires_at = expires_at
    this.metadata = metadata
  }

  toDict(): TrustRootData {
    return {
      domain_id: this.domain_id,
      public_key: this.public_key,
      signature: this.signature,
      created_at: this.created_at,
      expires_at: this.expires_at,
      metadata: this.metadata,
    }
  }

  static fromDict(d: Record<string, any>): TrustRoot {
    return new TrustRoot(
      d.domain_id ?? d['domain_id'],
      d.public_key ?? d['public_key'],
      d.signature ?? d['signature'],
      d.created_at ?? '',
      d.expires_at ?? null,
      d.metadata ?? {},
    )
  }

  sign(private_key: string): void {
    const payload_obj = {
      domain_id: this.domain_id,
      public_key: this.public_key,
      created_at: this.created_at,
    }
    const payload = JSON.stringify(payload_obj, Object.keys(payload_obj).sort())
    this.signature = crypto.createHash('sha256').update(payload + private_key).digest('hex')
  }

  verify(private_key: string): boolean {
    const payload_obj = {
      domain_id: this.domain_id,
      public_key: this.public_key,
      created_at: this.created_at,
    }
    const payload = JSON.stringify(payload_obj, Object.keys(payload_obj).sort())
    const expected = crypto.createHash('sha256').update(payload + private_key).digest('hex')
    return this.signature === expected
  }
}

export interface DomainLinkData {
  link_id: string
  local_domain: string
  remote_domain: string
  status: string
  created_at: string
  accepted_at: string
  metadata: Record<string, any>
}

export class DomainLink {
  link_id: string
  local_domain: string
  remote_domain: string
  status: string
  created_at: string
  accepted_at: string
  metadata: Record<string, any>

  constructor(link_id: string, local_domain: string, remote_domain: string, status = 'pending', created_at = '', accepted_at = '', metadata: Record<string, any> = {}) {
    this.link_id = link_id
    this.local_domain = local_domain
    this.remote_domain = remote_domain
    this.status = status
    this.created_at = created_at || new Date().toISOString()
    this.accepted_at = accepted_at
    this.metadata = metadata
  }

  toDict(): DomainLinkData {
    return {
      link_id: this.link_id,
      local_domain: this.local_domain,
      remote_domain: this.remote_domain,
      status: this.status,
      created_at: this.created_at,
      accepted_at: this.accepted_at,
      metadata: this.metadata,
    }
  }

  static fromDict(d: Record<string, any>): DomainLink {
    return new DomainLink(
      d.link_id ?? d['link_id'],
      d.local_domain ?? d['local_domain'],
      d.remote_domain ?? d['remote_domain'],
      d.status ?? 'pending',
      d.created_at ?? '',
      d.accepted_at ?? '',
      d.metadata ?? {},
    )
  }
}

export class DomainTrustAnchor {
  private alp_dir: string
  private domain_id: string
  private private_key: string
  private _domain_dir: string
  private _root_path: string

  constructor(alp_dir: string, domain_id: string, private_key: string) {
    this.alp_dir = alp_dir
    this.domain_id = domain_id
    this.private_key = private_key
    this._domain_dir = path.join(this.alp_dir, TRUST_DIR, 'domains', this.domain_id)
    this._root_path = path.join(this._domain_dir, 'root.json')
  }

  create_domain(metadata: Record<string, any> = {}): TrustRoot {
    const public_key = crypto.createHash('sha256').update(this.private_key).digest('hex')
    const root = new TrustRoot(this.domain_id, public_key, '', '', null, metadata)
    root.sign(this.private_key)
    const d = path.dirname(this._root_path)
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })
    fs.writeFileSync(this._root_path, JSON.stringify(root.toDict(), null, 2))
    return root
  }

  get_trust_root(): TrustRoot | null {
    if (!fs.existsSync(this._root_path)) return null
    const data = JSON.parse(fs.readFileSync(this._root_path, 'utf-8'))
    return TrustRoot.fromDict(data)
  }

  export_trust_root(): string {
    const root = this.get_trust_root()
    if (!root) throw new Error(`No trust root found for domain '${this.domain_id}'.`)
    return JSON.stringify(root.toDict(), null, 2)
  }

  import_trust_root(remote_root_json: string, expected_domain_id: string): TrustRoot {
    const data = JSON.parse(remote_root_json)
    const root = TrustRoot.fromDict(data)
    if (root.domain_id !== expected_domain_id) {
      throw new Error(`Domain ID mismatch: expected '${expected_domain_id}', got '${root.domain_id}'.`)
    }
    if (!root.verify(this.private_key)) {
      throw new Error('Trust root signature verification failed.')
    }
    return root
  }
}

export class DomainTrustManager {
  private alp_dir: string
  private local_domain: string
  private links: Map<string, DomainLink> = new Map()

  constructor(alp_dir: string, local_domain: string) {
    this.alp_dir = alp_dir
    this.local_domain = local_domain
    this.load()
  }

  private links_path(): string {
    return path.join(this.alp_dir, TRUST_DIR, LINKS_FILE)
  }

  load(): void {
    const p = this.links_path()
    if (!fs.existsSync(p)) return
    try {
      const lines = fs.readFileSync(p, 'utf-8').split('\n').filter(Boolean)
      for (const line of lines) {
        const entry = JSON.parse(line)
        const link = DomainLink.fromDict(entry)
        this.links.set(link.link_id, link)
      }
    } catch {
      this.links.clear()
    }
  }

  private save_link(link: DomainLink): void {
    const d = path.join(this.alp_dir, TRUST_DIR)
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })
    fs.appendFileSync(this.links_path(), JSON.stringify(link.toDict()) + '\n')
  }

  link_domain(remote_domain: string): DomainLink {
    const existing = Array.from(this.links.values()).filter((l) => l.remote_domain === remote_domain)
    if (existing.length > 0) return existing[0]
    const link_id = `link-${crypto.randomBytes(6).toString('hex')}`
    const link = new DomainLink(link_id, this.local_domain, remote_domain, 'pending')
    this.links.set(link_id, link)
    this.save_link(link)
    return link
  }

  accept_link(link_id: string): DomainLink | null {
    const link = this.links.get(link_id)
    if (!link) return null
    link.status = TrustStatus.ACTIVE
    link.accepted_at = new Date().toISOString()
    this.save_link(link)
    return link
  }

  revoke_link(link_id: string): boolean {
    const link = this.links.get(link_id)
    if (!link) return false
    link.status = TrustStatus.REVOKED
    this.save_link(link)
    return true
  }

  get_link(link_id: string): DomainLink | undefined {
    return this.links.get(link_id)
  }

  get_link_by_domain(remote_domain: string): DomainLink | undefined {
    return Array.from(this.links.values()).find((l) => l.remote_domain === remote_domain)
  }

  list_links(): DomainLink[] {
    return Array.from(this.links.values())
  }

  list_active_links(): DomainLink[] {
    return Array.from(this.links.values()).filter((l) => l.status === TrustStatus.ACTIVE)
  }
}

export function create_domain_keypair(): { public_key: string; private_key: string } {
  const private_key = crypto.randomBytes(32).toString('hex')
  const public_key = crypto.createHash('sha256').update(private_key).digest('hex')
  return { public_key, private_key }
}
