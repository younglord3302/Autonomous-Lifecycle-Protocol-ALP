import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  TrustRoot,
  DomainLink,
  DomainTrustAnchor,
  DomainTrustManager,
  create_domain_keypair,
  TRUST_DIR,
  DOMAINS_FILE,
  LINKS_FILE,
  TrustStatus,
} from '../src/domain_trust'

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'alp-domain-'))
}

describe('create_domain_keypair (v18.4.0)', () => {
  it('generates a matching keypair', () => {
    const keys = create_domain_keypair()
    expect(keys.private_key).toBeTruthy()
    expect(keys.public_key).toBeTruthy()
    expect(keys.private_key).toHaveLength(64)
  })
})

describe('TrustRoot (v18.4.0)', () => {
  it('round-trips through toDict/fromDict', () => {
    const root = new TrustRoot('dom1', 'pk1', 'sig1', '2024-01-01T00:00:00Z', null, { m: 1 })
    const dict = root.toDict()
    expect(dict.domain_id).toBe('dom1')
    const restored = TrustRoot.fromDict(dict)
    expect(restored.domain_id).toBe('dom1')
    expect(restored.public_key).toBe('pk1')
  })

  it('signs and verifies with private key', () => {
    const root = new TrustRoot('dom1', 'pk1')
    const private_key = 'secret'
    root.sign(private_key)
    expect(root.signature).toBeTruthy()
    expect(root.verify(private_key)).toBe(true)
    expect(root.verify('wrong')).toBe(false)
  })
})

describe('DomainLink (v18.4.0)', () => {
  it('round-trips through toDict/fromDict', () => {
    const link = new DomainLink('link1', 'local', 'remote', 'active', '2024-01-01T00:00:00Z', '2024-01-02T00:00:00Z', { m: 1 })
    const dict = link.toDict()
    expect(dict.link_id).toBe('link1')
    const restored = DomainLink.fromDict(dict)
    expect(restored.link_id).toBe('link1')
    expect(restored.status).toBe('active')
  })
})

describe('DomainTrustAnchor (v18.4.0)', () => {
  it('creates and reads a domain', () => {
    const dir = tmpDir()
    const anchor = new DomainTrustAnchor(dir, 'local', 'private-key')
    const root = anchor.create_domain()
    expect(root.domain_id).toBe('local')
    expect(root.signature).toBeTruthy()

    const loaded = anchor.get_trust_root()
    expect(loaded).not.toBeNull()
    expect(loaded!.domain_id).toBe('local')
    expect(loaded!.verify('private-key')).toBe(true)
  })

  it('exports trust root as JSON', () => {
    const dir = tmpDir()
    const anchor = new DomainTrustAnchor(dir, 'local', 'pk')
    anchor.create_domain()
    const exported = anchor.export_trust_root()
    expect(() => JSON.parse(exported)).not.toThrow()
    expect(JSON.parse(exported).domain_id).toBe('local')
  })

  it('imports a valid remote trust root', () => {
    const dir = tmpDir()
    const anchor = new DomainTrustAnchor(dir, 'local', 'pk')
    anchor.create_domain()
    const exported = anchor.export_trust_root()
    const imported = anchor.import_trust_root(exported, 'local')
    expect(imported.domain_id).toBe('local')
  })

  it('rejects mismatched domain id on import', () => {
    const dir = tmpDir()
    const anchor = new DomainTrustAnchor(dir, 'local', 'pk')
    anchor.create_domain()
    const exported = anchor.export_trust_root()
    expect(() => anchor.import_trust_root(exported, 'remote')).toThrow('Domain ID mismatch')
  })
})

describe('DomainTrustManager (v18.4.0)', () => {
  it('links and lists domains', () => {
    const dir = tmpDir()
    const manager = new DomainTrustManager(dir, 'local')
    const link = manager.link_domain('remote')
    expect(link.local_domain).toBe('local')
    expect(link.remote_domain).toBe('remote')
    expect(link.status).toBe(TrustStatus.PENDING)

    const links = manager.list_links()
    expect(links).toHaveLength(1)
  })

  it('accepts a link', () => {
    const dir = tmpDir()
    const manager = new DomainTrustManager(dir, 'local')
    const link = manager.link_domain('remote')
    const accepted = manager.accept_link(link.link_id)
    expect(accepted).not.toBeNull()
    expect(accepted!.status).toBe(TrustStatus.ACTIVE)
    expect(accepted!.accepted_at).toBeTruthy()
  })

  it('revokes a link', () => {
    const dir = tmpDir()
    const manager = new DomainTrustManager(dir, 'local')
    const link = manager.link_domain('remote')
    expect(manager.revoke_link(link.link_id)).toBe(true)
    expect(manager.revoke_link(link.link_id)).toBe(true)
    const links = manager.list_links()
    expect(links[0].status).toBe(TrustStatus.REVOKED)
  })

  it('persists links to disk', () => {
    const dir = tmpDir()
    const manager = new DomainTrustManager(dir, 'local')
    manager.link_domain('remote')
    const p = path.join(dir, TRUST_DIR, LINKS_FILE)
    expect(fs.existsSync(p)).toBe(true)
    const lines = fs.readFileSync(p, 'utf-8').trim().split('\n')
    expect(lines).toHaveLength(1)
    const entry = JSON.parse(lines[0])
    expect(entry.remote_domain).toBe('remote')
  })

  it('survives process restart', () => {
    const dir = tmpDir()
    const m1 = new DomainTrustManager(dir, 'local')
    m1.link_domain('remote')

    const m2 = new DomainTrustManager(dir, 'local')
    expect(m2.list_links()).toHaveLength(1)
  })
})
