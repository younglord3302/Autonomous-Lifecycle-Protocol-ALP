import hashlib
import json
import os
import sys
import unittest

SDK_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SDK_ROOT not in sys.path:
    sys.path.insert(0, SDK_ROOT)

from alp_sdk.tenant import (
    TenantContext,
    TenantIsolationError,
    TenantManager,
    TenantVault,
    create_tenant_key,
    tenant_dir,
    tenants_path,
)


class TestTenantContext(unittest.TestCase):
    def test_round_trip(self):
        ctx = TenantContext(tenant_id="t1", name="Tenant One", key_hash="kh1", metadata={"env": "prod"})
        d = ctx.to_dict()
        restored = TenantContext.from_dict(d)
        self.assertEqual(restored.tenant_id, "t1")
        self.assertEqual(restored.name, "Tenant One")
        self.assertEqual(restored.metadata["env"], "prod")

    def test_defaults(self):
        ctx = TenantContext(tenant_id="t1", name="T", key_hash="kh")
        self.assertIsNotNone(ctx.created_at)


class TestTenantManager(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.tmpdir = tempfile.mkdtemp()
        self.manager = TenantManager(self.tmpdir)

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_create_and_get_tenant(self):
        ctx = self.manager.create_tenant("t1", "Tenant One", "kh1")
        self.assertEqual(ctx.tenant_id, "t1")
        fetched = self.manager.get_tenant("t1")
        self.assertIsNotNone(fetched)
        self.assertEqual(fetched.name, "Tenant One")

    def test_create_duplicate_raises(self):
        self.manager.create_tenant("t1", "T", "kh")
        self.assertRaises(ValueError, self.manager.create_tenant, "t1", "T2", "kh2")

    def test_list_tenants(self):
        self.manager.create_tenant("t1", "T1", "kh1")
        self.manager.create_tenant("t2", "T2", "kh2")
        tenants = self.manager.list_tenants()
        self.assertEqual(len(tenants), 2)

    def test_delete_tenant(self):
        self.manager.create_tenant("t1", "T", "kh")
        self.assertTrue(self.manager.delete_tenant("t1"))
        self.assertIsNone(self.manager.get_tenant("t1"))
        self.assertFalse(self.manager.delete_tenant("t1"))

    def test_persists_to_file(self):
        self.manager.create_tenant("t1", "T", "kh")
        p = tenants_path(self.tmpdir)
        self.assertTrue(os.path.exists(p))
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
        self.assertIn("t1", data)

    def test_tenant_vault_created(self):
        self.manager.create_tenant("t1", "T", "kh")
        vault = self.manager.tenant_vault("t1")
        self.assertIsInstance(vault, TenantVault)
        self.assertEqual(vault.tenant_id, "t1")

    def test_tenant_vault_missing_raises(self):
        self.assertRaises(ValueError, self.manager.tenant_vault, "missing")


class TestTenantVault(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.tmpdir = tempfile.mkdtemp()
        self.manager = TenantManager(self.tmpdir)
        self.manager.create_tenant("t1", "Tenant One", "kh1")
        self.vault = self.manager.tenant_vault("t1")

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_seal_and_unseal(self):
        self.vault.seal_secret("s1", "hello world")
        entry = self.vault.unseal_secret("s1", "kh1")
        self.assertEqual(entry["secret_id"], "s1")
        self.assertEqual(entry["tenant_id"], "t1")

    def test_unseal_wrong_key_hash_raises(self):
        self.vault.seal_secret("s1", "secret")
        self.assertRaises(TenantIsolationError, self.vault.unseal_secret, "s1", "kh2")

    def test_list_secrets(self):
        self.vault.seal_secret("s1", "a")
        self.vault.seal_secret("s2", "b")
        secrets = self.vault.list_secrets()
        self.assertEqual(len(secrets), 2)
        ids = [s["secret_id"] for s in secrets]
        self.assertIn("s1", ids)
        self.assertIn("s2", ids)

    def test_unseal_missing_secret_raises(self):
        self.assertRaises(KeyError, self.vault.unseal_secret, "missing", "kh1")

    def test_rotate_tenant_key(self):
        new_hash = self.vault.rotate_tenant_key("kh2")
        self.assertEqual(new_hash, "kh2")
        self.assertEqual(self.vault.tenant_key_hash, "kh2")

    def test_audit_records_actions(self):
        self.vault.seal_secret("s1", "a")
        self.vault.unseal_secret("s1", "kh1")
        audit = self.vault.audit()
        actions = [e["action"] for e in audit]
        self.assertIn("seal", actions)
        self.assertIn("unseal", actions)

    def test_isolated_tenant_directories(self):
        self.manager.create_tenant("t2", "Tenant Two", "kh2")
        vault2 = self.manager.tenant_vault("t2")
        vault2.seal_secret("s1", "tenant2-secret")
        self.vault.seal_secret("s1", "tenant1-secret")
        t1_secrets = self.vault.list_secrets()
        t2_secrets = vault2.list_secrets()
        self.assertEqual(len(t1_secrets), 1)
        self.assertEqual(len(t2_secrets), 1)


class TestCreateTenantKey(unittest.TestCase):
    def test_returns_pair(self):
        public_key, private_key = create_tenant_key()
        self.assertIsInstance(public_key, str)
        self.assertIsInstance(private_key, str)
        self.assertNotEqual(public_key, private_key)
        self.assertEqual(len(public_key), 64)

    def test_deterministic_hash(self):
        public_key, _ = create_tenant_key()
        expected = hashlib.sha256(_.encode()).hexdigest()
        self.assertEqual(public_key, expected)


if __name__ == "__main__":
    unittest.main()
