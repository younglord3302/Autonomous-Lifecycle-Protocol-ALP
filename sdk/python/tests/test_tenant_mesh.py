import unittest
from alp_sdk.tenant_mesh import TenantMeshEngine

class TestTenantMesh(unittest.TestCase):
    def test_tenant_creation_and_rbac(self):
        engine = TenantMeshEngine()
        mesh = engine.create_tenant_mesh("tenant-1", "Enterprise Inc", "OIDC-Google")

        self.assertEqual(mesh.tenant_id, "tenant-1")
        self.assertEqual(mesh.sso_provider, "OIDC-Google")

        engine.assign_role("tenant-1", "user-dev", "developer")
        self.assertTrue(engine.authorize_action("tenant-1", "user-dev", "deploy:k8s"))
        self.assertFalse(engine.authorize_action("tenant-1", "user-dev", "tenant:delete"))

if __name__ == "__main__":
    unittest.main()
