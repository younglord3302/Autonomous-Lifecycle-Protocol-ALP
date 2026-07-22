export type EnterpriseRole = 'admin' | 'auditor' | 'developer';

export interface TenantMesh {
  id: string;
  tenantId: string;
  orgName: string;
  ssoProvider: string;
  maxWorkspaces: number;
  rbacRoles: Record<string, EnterpriseRole>;
  createdAt: string;
}

export class TenantMeshEngine {
  private tenants: Map<string, TenantMesh> = new Map();

  public createTenantMesh(
    tenantId: string,
    orgName: string,
    ssoProvider: string = 'SAML-Okta',
    maxWorkspaces: number = 50
  ): TenantMesh {
    const mesh: TenantMesh = {
      id: `mesh-${tenantId}`,
      tenantId,
      orgName,
      ssoProvider,
      maxWorkspaces,
      rbacRoles: {},
      createdAt: new Date().toISOString(),
    };

    this.tenants.set(tenantId, mesh);
    return mesh;
  }

  public assignRole(tenantId: string, userOrAgent: string, role: EnterpriseRole): boolean {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return false;
    tenant.rbacRoles[userOrAgent] = role;
    return true;
  }

  public authorizeAction(tenantId: string, userOrAgent: string, action: string): boolean {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) return false;

    const role = tenant.rbacRoles[userOrAgent];
    if (!role) return false;

    if (role === 'admin') return true;
    if (role === 'developer' && !action.startsWith('tenant:delete')) return true;
    if (role === 'auditor' && (action.startsWith('audit:') || action.startsWith('read:'))) return true;

    return false;
  }

  public getTenant(tenantId: string): TenantMesh | undefined {
    return this.tenants.get(tenantId);
  }
}
