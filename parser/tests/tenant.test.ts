import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  TenantIsolationError,
  TenantContext,
  TenantVault,
  TenantManager,
  create_tenant_key,
  TENANT_DIR,
  TENANTS_FILE,
} from '../src/tenant'

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'alp-tenant-'))
}

describe('create_tenant_key (v18.2.0)', () => {
  it('generates a matching keypair', () => {
    const keys = create_tenant_key()
    expect(keys.private_key).toBeTruthy()
    expect(keys.public_key).toBeTruthy()
    expect(keys.private_key).toHaveLength(64)
  })
})

describe('TenantContext (v18.2.0)', () => {
  it('round-trips through toDict/fromDict', () => {
    const ctx = new TenantContext('t1', 'name', 'hash1', '2024-01-01T00:00:00Z', { m: 1 })
    const dict = ctx.toDict()
    expect(dict.tenant_id).toBe('t1')
    const restored = TenantContext.fromDict(dict)
    expect(restored.tenant_id).toBe('t1')
    expect(restored.name).toBe('name')
  })
})

describe('TenantManager (v18.2.0)', () => {
  it('creates, lists, and deletes tenants', () => {
    const dir = tmpDir()
    const manager = new TenantManager(dir)
    const ctx = manager.create_tenant('t1', 'Tenant 1', 'hash1')
    expect(ctx.tenant_id).toBe('t1')

    const tenants = manager.list_tenants()
    expect(tenants).toHaveLength(1)
    expect(tenants[0].name).toBe('Tenant 1')

    expect(manager.delete_tenant('t1')).toBe(true)
    expect(manager.delete_tenant('t1')).toBe(false)
    expect(manager.list_tenants()).toHaveLength(0)
  })

  it('persists tenants to disk', () => {
    const dir = tmpDir()
    const manager = new TenantManager(dir)
    manager.create_tenant('t1', 'T1', 'h1')
    const p = path.join(dir, TENANT_DIR, TENANTS_FILE)
    expect(fs.existsSync(p)).toBe(true)
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'))
    expect(data['t1'].name).toBe('T1')
  })

  it('returns tenant vault', () => {
    const dir = tmpDir()
    const manager = new TenantManager(dir)
    manager.create_tenant('t1', 'T1', 'h1')
    const vault = manager.tenant_vault('t1')
    expect(vault).toBeInstanceOf(TenantVault)
  })
})

describe('TenantVault (v18.2.0)', () => {
  it('seals and unseals secrets', () => {
    const dir = tmpDir()
    const manager = new TenantManager(dir)
    manager.create_tenant('t1', 'T1', 'h1')
    const vault = manager.tenant_vault('t1')

    const sealed = vault.seal_secret('secret1', 'plaintext', { k: 'v' })
    expect(sealed.nonce).toBeTruthy()

    const entry = vault.unseal_secret('secret1', 'h1')
    expect(entry.secret_id).toBe('secret1')
    expect(entry.tenant_id).toBe('t1')
  })

  it('lists secrets', () => {
    const dir = tmpDir()
    const manager = new TenantManager(dir)
    manager.create_tenant('t1', 'T1', 'h1')
    const vault = manager.tenant_vault('t1')
    vault.seal_secret('s1', 'v1')
    vault.seal_secret('s2', 'v2')

    const secrets = vault.list_secrets()
    expect(secrets).toHaveLength(2)
  })

  it('rotates tenant key', () => {
    const dir = tmpDir()
    const manager = new TenantManager(dir)
    manager.create_tenant('t1', 'T1', 'h1')
    const vault = manager.tenant_vault('t1')
    const newHash = vault.rotate_tenant_key('new-hash')
    expect(newHash).toBe('new-hash')
  })

  it('denies cross-tenant access', () => {
    const dir = tmpDir()
    const manager = new TenantManager(dir)
    manager.create_tenant('t1', 'T1', 'h1')
    const vault = manager.tenant_vault('t1')
    vault.seal_secret('s1', 'v1')
    expect(() => vault.unseal_secret('s1', 'wrong-hash')).toThrow(TenantIsolationError)
  })

  it('records audit trail', () => {
    const dir = tmpDir()
    const manager = new TenantManager(dir)
    manager.create_tenant('t1', 'T1', 'h1')
    const vault = manager.tenant_vault('t1')
    vault.seal_secret('s1', 'v1')
    vault.unseal_secret('s1', 'h1')
    const audit = vault.audit()
    expect(audit.length).toBeGreaterThanOrEqual(2)
  })

  it('survives process restart', () => {
    const dir = tmpDir()
    const m1 = new TenantManager(dir)
    m1.create_tenant('t1', 'T1', 'h1')

    const m2 = new TenantManager(dir)
    expect(m2.list_tenants()).toHaveLength(1)
  })
})
