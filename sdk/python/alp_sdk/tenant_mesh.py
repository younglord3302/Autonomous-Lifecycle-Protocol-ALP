from __future__ import annotations

from datetime import datetime, timezone
from typing import Dict, Any, Optional

class TenantMesh:
    def __init__(
        self,
        tenant_id: str,
        org_name: str,
        sso_provider: str = "SAML-Okta",
        max_workspaces: int = 50,
        created_at: Optional[str] = None,
    ):
        self.id = f"mesh-{tenant_id}"
        self.tenant_id = tenant_id
        self.org_name = org_name
        self.sso_provider = sso_provider
        self.max_workspaces = max_workspaces
        self.rbac_roles: Dict[str, str] = {}
        self.created_at = created_at or datetime.now(timezone.utc).isoformat()

class TenantMeshEngine:
    def __init__(self):
        self.tenants: Dict[str, TenantMesh] = {}

    def create_tenant_mesh(
        self,
        tenant_id: str,
        org_name: str,
        sso_provider: str = "SAML-Okta",
        max_workspaces: int = 50,
    ) -> TenantMesh:
        mesh = TenantMesh(
            tenant_id=tenant_id,
            org_name=org_name,
            sso_provider=sso_provider,
            max_workspaces=max_workspaces,
        )
        self.tenants[tenant_id] = mesh
        return mesh

    def assign_role(self, tenant_id: str, user_or_agent: str, role: str) -> bool:
        tenant = self.tenants.get(tenant_id)
        if not tenant:
            return False
        tenant.rbac_roles[user_or_agent] = role
        return True

    def authorize_action(self, tenant_id: str, user_or_agent: str, action: str) -> bool:
        tenant = self.tenants.get(tenant_id)
        if not tenant:
            return False

        role = tenant.rbac_roles.get(user_or_agent)
        if not role:
            return False

        if role == "admin":
            return True
        if role == "developer" and not action.startswith("tenant:delete"):
            return True
        if role == "auditor" and (action.startswith("audit:") or action.startswith("read:")):
            return True

        return False
