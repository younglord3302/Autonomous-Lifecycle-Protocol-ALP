import { describe, it, expect } from 'vitest';
import { TenantMeshEngine } from '../src/tenant-mesh';

describe('TenantMeshEngine (v27.0.0)', () => {
  it('initializes enterprise tenant mesh with SSO provider', () => {
    const engine = new TenantMeshEngine();
    const mesh = engine.createTenantMesh('tenant-acme', 'Acme Corp', 'SAML-Okta');

    expect(mesh.tenantId).toBe('tenant-acme');
    expect(mesh.orgName).toBe('Acme Corp');
    expect(mesh.ssoProvider).toBe('SAML-Okta');
  });

  it('assigns roles and enforces enterprise RBAC policy matrix', () => {
    const engine = new TenantMeshEngine();
    engine.createTenantMesh('tenant-finance', 'FinTech Inc');

    engine.assignRole('tenant-finance', 'user-alice', 'developer');
    engine.assignRole('tenant-finance', 'user-bob', 'auditor');

    expect(engine.authorizeAction('tenant-finance', 'user-alice', 'deploy:k8s')).toBe(true);
    expect(engine.authorizeAction('tenant-finance', 'user-alice', 'tenant:delete')).toBe(false);

    expect(engine.authorizeAction('tenant-finance', 'user-bob', 'read:audit_logs')).toBe(true);
    expect(engine.authorizeAction('tenant-finance', 'user-bob', 'deploy:k8s')).toBe(false);
  });
});
