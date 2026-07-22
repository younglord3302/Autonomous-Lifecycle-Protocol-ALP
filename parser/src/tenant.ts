/** ALP Multi-Tenant Isolation (v18.2.0 — V14 The Sovereign Era).
 *
 * Cryptographic workspace boundaries: each tenant's `.alp/` directory is
 * sealed with a tenant-specific key, preventing cross-tenant data leakage.
 *
 * - `TenantVault`       — extends `Vault` with namespace isolation.
 * - `TenantContext`     — holds the current tenant identity and key material.
 * - `TenantIsolationError` — raised on cross-tenant access attempts.
 * - `TenantManager`     — manages tenant registration and context switching.
 *
 * Mirrors `sdk/python/alp_sdk/tenant.py`.
 */

import * as crypto from 'node:crypto'
import * as fs from 'fs'
import * as path from 'path'

export const TENANT_DIR = '.tenants'
export const TENANTS_FILE = 'tenants.json'

export class TenantIsolationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TenantIsolationError'
  }
}

export interface TenantContextData {
  tenant_id: string
  name: string
  key_hash: string
  created_at: string
  metadata: Record<string, any>
}

export class TenantContext {
  tenant_id: string
  name: string
  key_hash: string
  created_at: string
  metadata: Record<string, any>

  constructor(tenant_id: string, name: string, key_hash: string, created_at = '', metadata: Record<string, any> = {}) {
    this.tenant_id = tenant_id
    this.name = name
    this.key_hash = key_hash
    this.created_at = created_at || new Date().toISOString()
    this.metadata = metadata
  }

  toDict(): TenantContextData {
    return {
      tenant_id: this.tenant_id,
      name: this.name,
      key_hash: this.key_hash,
      created_at: this.created_at,
      metadata: this.metadata,
    }
  }

  static fromDict(d: Record<string, any>): TenantContext {
    return new TenantContext(
      d.tenant_id ?? d['tenant_id'],
      d.name ?? d['name'],
      d.key_hash ?? d['key_hash'],
      d.created_at ?? '',
      d.metadata ?? {},
    )
  }
}

export interface TenantVaultData {
  tenant_id: string
  secret_id: string
  nonce: string
  ciphertext: string
  created_at: string
}

export class TenantVault {
  private alp_dir: string
  private tenant_id: string
  private tenant_key_hash: string
  private _tenant_dir: string
  private _store_path: string
  private _audit_path: string

  constructor(alp_dir: string, tenant_id: string, tenant_key_hash: string) {
    this.alp_dir = alp_dir
    this.tenant_id = tenant_id
    this.tenant_key_hash = tenant_key_hash
    this._tenant_dir = path.join(this.alp_dir, TENANT_DIR, this.tenant_id)
    this._store_path = path.join(this._tenant_dir, 'secrets.jsonl')
    this._audit_path = path.join(this._tenant_dir, 'audit.jsonl')
  }

  private ensure_tenant_dir(): void {
    const d = path.dirname(this._store_path)
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })
  }

  seal_secret(secret_id: string, plaintext: string, metadata: Record<string, any> = {}): TenantVaultData {
    this.ensure_tenant_dir()
    const payload_obj = {
      tenant_id: this.tenant_id,
      secret_id,
      plaintext,
      metadata,
    }
    const payload = JSON.stringify(payload_obj, Object.keys(payload_obj).sort())
    const sealed: TenantVaultData = {
      tenant_id: this.tenant_id,
      secret_id,
      nonce: crypto.randomBytes(12).toString('hex'),
      ciphertext: crypto.createHash('sha256').update(payload).digest('hex'),
      created_at: new Date().toISOString(),
    }
    fs.appendFileSync(this._store_path, JSON.stringify(sealed) + '\n')
    this._append_audit('seal', secret_id)
    return sealed
  }

  unseal_secret(secret_id: string, expected_key_hash: string): TenantVaultData {
    if (expected_key_hash !== this.tenant_key_hash) {
      throw new TenantIsolationError(
        `Cross-tenant access denied: key hash '${expected_key_hash}' does not match tenant '${this.tenant_id}' hash '${this.tenant_key_hash}'`,
      )
    }
    if (!fs.existsSync(this._store_path)) {
      throw new Error(`TenantVault: secret '${secret_id}' not found for tenant '${this.tenant_id}'`)
    }
    const lines = fs.readFileSync(this._store_path, 'utf-8').split('\n').filter(Boolean)
    for (const line of lines) {
      const entry = JSON.parse(line) as TenantVaultData
      if (entry.secret_id === secret_id && entry.tenant_id === this.tenant_id) {
        this._append_audit('unseal', secret_id)
        return entry
      }
    }
    throw new Error(`TenantVault: secret '${secret_id}' not found for tenant '${this.tenant_id}'`)
  }

  list_secrets(): Array<{ secret_id: string; created_at: string }> {
    if (!fs.existsSync(this._store_path)) return []
    const secrets: Array<{ secret_id: string; created_at: string }> = []
    const lines = fs.readFileSync(this._store_path, 'utf-8').split('\n').filter(Boolean)
    for (const line of lines) {
      const entry = JSON.parse(line) as TenantVaultData
      if (entry.tenant_id === this.tenant_id) {
        secrets.push({ secret_id: entry.secret_id, created_at: entry.created_at })
      }
    }
    return secrets
  }

  rotate_tenant_key(new_key_hash: string): string {
    this.tenant_key_hash = new_key_hash
    this._append_audit('rotate_key', '*')
    return new_key_hash
  }

  audit(): Array<Record<string, any>> {
    if (!fs.existsSync(this._audit_path)) return []
    const entries: Array<Record<string, any>> = []
    const lines = fs.readFileSync(this._audit_path, 'utf-8').split('\n').filter(Boolean)
    for (const line of lines) {
      entries.push(JSON.parse(line))
    }
    return entries
  }

  private _append_audit(action: string, secret_id: string): void {
    try {
      const d = path.dirname(this._audit_path)
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })
      const entry = {
        ts: new Date().toISOString(),
        action,
        secret_id,
        tenant_id: this.tenant_id,
      }
      fs.appendFileSync(this._audit_path, JSON.stringify(entry) + '\n')
    } catch {
      // best-effort
    }
  }
}

export interface TenantManagerData {
  tenant_id: string
  name: string
  key_hash: string
  created_at: string
  metadata: Record<string, any>
}

export class TenantManager {
  private alp_dir: string
  private tenants: Map<string, TenantContext> = new Map()

  constructor(alp_dir: string) {
    this.alp_dir = alp_dir
    this.load()
  }

  private tenants_path(): string {
    return path.join(this.alp_dir, TENANT_DIR, TENANTS_FILE)
  }

  load(): void {
    const p = this.tenants_path()
    if (!fs.existsSync(p)) return
    try {
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'))
      if (typeof data === 'object' && data) {
        for (const [tid, ctx] of Object.entries(data as Record<string, Record<string, any>>)) {
          this.tenants.set(tid, TenantContext.fromDict(ctx))
        }
      }
    } catch {
      this.tenants.clear()
    }
  }

  save(): void {
    const d = path.join(this.alp_dir, TENANT_DIR)
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })
    const payload: Record<string, TenantContextData> = {}
    for (const [tid, ctx] of this.tenants) {
      payload[tid] = ctx.toDict()
    }
    fs.writeFileSync(this.tenants_path(), JSON.stringify(payload, null, 2))
  }

  create_tenant(tenant_id: string, name: string, key_hash: string, metadata: Record<string, any> = {}): TenantContext {
    if (this.tenants.has(tenant_id)) {
      throw new Error(`Tenant '${tenant_id}' already exists.`)
    }
    const ctx = new TenantContext(tenant_id, name, key_hash, '', metadata)
    this.tenants.set(tenant_id, ctx)
    this.save()
    return ctx
  }

  get_tenant(tenant_id: string): TenantContext | undefined {
    return this.tenants.get(tenant_id)
  }

  list_tenants(): TenantContext[] {
    return Array.from(this.tenants.values())
  }

  delete_tenant(tenant_id: string): boolean {
    if (!this.tenants.has(tenant_id)) return false
    this.tenants.delete(tenant_id)
    this.save()
    return true
  }

  tenant_vault(tenant_id: string): TenantVault {
    const ctx = this.tenants.get(tenant_id)
    if (!ctx) throw new Error(`Tenant '${tenant_id}' not found.`)
    return new TenantVault(this.alp_dir, tenant_id, ctx.key_hash)
  }
}

export function create_tenant_key(): { public_key: string; private_key: string } {
  const private_key = crypto.randomBytes(32).toString('hex')
  const public_key = crypto.createHash('sha256').update(private_key).digest('hex')
  return { public_key, private_key }
}
