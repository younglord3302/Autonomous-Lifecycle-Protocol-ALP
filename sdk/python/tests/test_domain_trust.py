import hashlib
import json
import os
import sys
import unittest

SDK_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SDK_ROOT not in sys.path:
    sys.path.insert(0, SDK_ROOT)

from alp_sdk.domain_trust import (
    DomainLink,
    DomainTrustAnchor,
    DomainTrustManager,
    TrustRoot,
    TrustStatus,
    create_domain_keypair,
    domains_path,
    links_path,
    trust_dir,
)


class TestTrustRoot(unittest.TestCase):
    def test_sign_and_verify(self):
        private_key = "priv1"
        public_key = hashlib.sha256(private_key.encode()).hexdigest()
        root = TrustRoot(domain_id="dom1", public_key=public_key, signature="")
        root.sign(private_key)
        self.assertIsNotNone(root.signature)
        self.assertTrue(root.verify(private_key))

    def test_verify_fails_wrong_key(self):
        private_key = "priv1"
        public_key = hashlib.sha256(private_key.encode()).hexdigest()
        root = TrustRoot(domain_id="dom1", public_key=public_key, signature="")
        root.sign(private_key)
        self.assertFalse(root.verify("priv2"))

    def test_round_trip(self):
        root = TrustRoot(domain_id="dom1", public_key="pk1", signature="sig1", metadata={"env": "prod"})
        d = root.to_dict()
        restored = TrustRoot.from_dict(d)
        self.assertEqual(restored.domain_id, "dom1")
        self.assertEqual(restored.metadata["env"], "prod")


class TestDomainTrustAnchor(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.tmpdir = tempfile.mkdtemp()
        self.domain_id = "local-domain"
        self.private_key = "priv-key-123"
        self.anchor = DomainTrustAnchor(alp_dir=self.tmpdir, domain_id=self.domain_id, private_key=self.private_key)

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_create_domain(self):
        root = self.anchor.create_domain(metadata={"env": "prod"})
        self.assertEqual(root.domain_id, self.domain_id)
        self.assertTrue(os.path.exists(self.anchor._root_path))

    def test_get_trust_root(self):
        self.anchor.create_domain()
        root = self.anchor.get_trust_root()
        self.assertIsNotNone(root)
        self.assertEqual(root.domain_id, self.domain_id)

    def test_get_trust_root_missing(self):
        root = self.anchor.get_trust_root()
        self.assertIsNone(root)

    def test_export_trust_root(self):
        self.anchor.create_domain()
        exported = self.anchor.export_trust_root()
        data = json.loads(exported)
        self.assertEqual(data["domain_id"], self.domain_id)

    def test_export_missing_raises(self):
        self.assertRaises(ValueError, self.anchor.export_trust_root)

    def test_import_valid_trust_root(self):
        self.anchor.create_domain()
        exported = self.anchor.export_trust_root()
        imported = self.anchor.import_trust_root(exported, self.domain_id)
        self.assertEqual(imported.domain_id, self.domain_id)

    def test_import_wrong_domain_raises(self):
        self.anchor.create_domain()
        exported = self.anchor.export_trust_root()
        self.assertRaises(ValueError, self.anchor.import_trust_root, exported, "wrong-domain")

    def test_import_tampered_signature_raises(self):
        self.anchor.create_domain()
        exported = self.anchor.export_trust_root()
        data = json.loads(exported)
        data["signature"] = "tampered"
        tampered = json.dumps(data)
        self.assertRaises(ValueError, self.anchor.import_trust_root, tampered, self.domain_id)


class TestDomainTrustManager(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.tmpdir = tempfile.mkdtemp()
        self.local_domain = "local-dom"
        self.manager = DomainTrustManager(alp_dir=self.tmpdir, local_domain=self.local_domain)

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_link_domain(self):
        link = self.manager.link_domain("remote-dom")
        self.assertIsNotNone(link)
        self.assertEqual(link.remote_domain, "remote-dom")
        self.assertEqual(link.status, "pending")

    def test_link_domain_idempotent(self):
        link1 = self.manager.link_domain("remote-dom")
        link2 = self.manager.link_domain("remote-dom")
        self.assertEqual(link1.link_id, link2.link_id)

    def test_accept_link(self):
        link = self.manager.link_domain("remote-dom")
        accepted = self.manager.accept_link(link.link_id)
        self.assertIsNotNone(accepted)
        self.assertEqual(accepted.status, "active")
        self.assertIsNotNone(accepted.accepted_at)

    def test_accept_missing_link_returns_none(self):
        result = self.manager.accept_link("missing")
        self.assertIsNone(result)

    def test_revoke_link(self):
        link = self.manager.link_domain("remote-dom")
        self.manager.accept_link(link.link_id)
        result = self.manager.revoke_link(link.link_id)
        self.assertTrue(result)
        updated = self.manager.get_link(link.link_id)
        self.assertEqual(updated.status, "revoked")

    def test_revoke_missing_returns_false(self):
        self.assertFalse(self.manager.revoke_link("missing"))

    def test_get_link(self):
        link = self.manager.link_domain("remote-dom")
        fetched = self.manager.get_link(link.link_id)
        self.assertIsNotNone(fetched)
        self.assertEqual(fetched.remote_domain, "remote-dom")

    def test_get_link_by_domain(self):
        self.manager.link_domain("remote-dom")
        link = self.manager.get_link_by_domain("remote-dom")
        self.assertIsNotNone(link)
        self.assertEqual(link.link_id, link.link_id)

    def test_list_links(self):
        self.manager.link_domain("r1")
        self.manager.link_domain("r2")
        links = self.manager.list_links()
        self.assertEqual(len(links), 2)

    def test_list_active_links(self):
        self.manager.link_domain("r1")
        self.manager.link_domain("r2")
        self.manager.accept_link(list(self.manager._links.keys())[0])
        active = self.manager.list_active_links()
        self.assertEqual(len(active), 1)

    def test_persists_links(self):
        self.manager.link_domain("remote-dom")
        p = links_path(self.tmpdir)
        self.assertTrue(os.path.exists(p))
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
        self.assertEqual(data["remote_domain"], "remote-dom")


class TestCreateDomainKeypair(unittest.TestCase):
    def test_returns_pair(self):
        public_key, private_key = create_domain_keypair()
        self.assertIsInstance(public_key, str)
        self.assertIsInstance(private_key, str)
        self.assertNotEqual(public_key, private_key)
        self.assertEqual(len(public_key), 64)

    def test_deterministic_hash(self):
        public_key, private_key = create_domain_keypair()
        expected = hashlib.sha256(private_key.encode()).hexdigest()
        self.assertEqual(public_key, expected)


if __name__ == "__main__":
    unittest.main()
