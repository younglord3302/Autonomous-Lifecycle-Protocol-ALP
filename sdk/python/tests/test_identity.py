import hashlib
import json
import os
import sys
import unittest

SDK_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SDK_ROOT not in sys.path:
    sys.path.insert(0, SDK_ROOT)

from alp_sdk.identity import (
    AgentIdentity,
    AgentKeyStore,
    create_did,
    generate_keypair,
    identity_dir,
    IdentityResolver,
    TrustRegistry,
    VerifiablePresentation,
    keys_path,
    trust_path,
)


class TestGenerateKeypair(unittest.TestCase):
    def test_returns_pair(self):
        public_key, private_key = generate_keypair()
        self.assertIsInstance(public_key, str)
        self.assertIsInstance(private_key, str)
        self.assertNotEqual(public_key, private_key)

    def test_deterministic_from_same_input(self):
        pk1, sk1 = generate_keypair()
        pk2, sk2 = generate_keypair()
        self.assertNotEqual(pk1, pk2)


class TestCreateDid(unittest.TestCase):
    def test_format(self):
        did = create_did("agent-1", "public-key-abc")
        self.assertTrue(did.startswith("did:alp:agent-1:"))

    def test_different_keys_produce_different_dids(self):
        did1 = create_did("agent-1", "key-a")
        did2 = create_did("agent-1", "key-b")
        self.assertNotEqual(did1, did2)


class TestAgentIdentity(unittest.TestCase):
    def test_round_trip(self):
        identity = AgentIdentity(did="did:alp:a:1", agent_id="a1", public_key="pk", metadata={"role": "worker"})
        d = identity.to_dict()
        restored = AgentIdentity.from_dict(d)
        self.assertEqual(restored.did, identity.did)
        self.assertEqual(restored.metadata["role"], "worker")

    def test_defaults(self):
        identity = AgentIdentity(did="did:alp:a:1", agent_id="a1", public_key="pk")
        self.assertIsNotNone(identity.created_at)


class TestVerifiablePresentation(unittest.TestCase):
    def test_verify_valid(self):
        public_key, private_key = generate_keypair()
        payload = json.dumps({"did": "did:alp:a:1", "agent_id": "a1", "claims": {"role": "admin"}}, sort_keys=True).encode()
        signature = hashlib.sha256(payload + public_key.encode()).hexdigest()
        vp = VerifiablePresentation(
            did="did:alp:a:1",
            agent_id="a1",
            claims={"role": "admin"},
            signature=signature,
        )
        self.assertTrue(vp.verify(public_key))

    def test_verify_invalid_signature(self):
        vp = VerifiablePresentation(did="did:alp:a:1", agent_id="a1", claims={}, signature="bad")
        self.assertFalse(vp.verify("some-key"))

    def test_to_dict(self):
        vp = VerifiablePresentation(did="did:alp:a:1", agent_id="a1", claims={}, signature="sig")
        d = vp.to_dict()
        self.assertEqual(d["did"], "did:alp:a:1")
        self.assertEqual(d["signature"], "sig")


def hashlib_hex(data: bytes) -> str:
    import hashlib
    return hashlib.sha256(data).hexdigest()


class TestTrustRegistry(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.tmpdir = tempfile.mkdtemp()
        self.registry = TrustRegistry(self.tmpdir)

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_register_and_resolve(self):
        self.registry.register("did:alp:a:1", "agent-1", ["read", "write"], "standard")
        entry = self.registry.resolve("did:alp:a:1")
        self.assertIsNotNone(entry)
        self.assertEqual(entry["agent_id"], "agent-1")
        self.assertIn("read", entry["scopes"])

    def test_revoke(self):
        self.registry.register("did:alp:a:1", "agent-1", ["read"])
        self.assertTrue(self.registry.revoke("did:alp:a:1"))
        self.assertIsNone(self.registry.resolve("did:alp:a:1"))
        self.assertFalse(self.registry.revoke("did:alp:a:1"))

    def test_list_dids(self):
        self.registry.register("did:alp:a:1", "agent-1", ["read"])
        self.registry.register("did:alp:a:2", "agent-2", ["write"])
        dids = self.registry.list_dids()
        self.assertEqual(len(dids), 2)

    def test_has_scope(self):
        self.registry.register("did:alp:a:1", "agent-1", ["read", "write"])
        self.assertTrue(self.registry.has_scope("did:alp:a:1", "read"))
        self.assertTrue(self.registry.has_scope("did:alp:a:1", "write"))
        self.assertFalse(self.registry.has_scope("did:alp:a:1", "admin"))
        self.assertFalse(self.registry.has_scope("did:alp:missing", "read"))

    def test_persists_to_file(self):
        self.registry.register("did:alp:a:1", "agent-1", ["read"])
        p = trust_path(self.tmpdir)
        self.assertTrue(os.path.exists(p))
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
        self.assertIn("did:alp:a:1", data)


class TestIdentityResolver(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.tmpdir = tempfile.mkdtemp()
        self.registry = TrustRegistry(self.tmpdir)
        self.resolver = IdentityResolver(self.registry)

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _make_vp(self, did: str, agent_id: str, public_key: str) -> VerifiablePresentation:
        payload = json.dumps({"did": did, "agent_id": agent_id, "claims": {"role": "worker"}}, sort_keys=True).encode()
        signature = hashlib.sha256(payload + public_key.encode()).hexdigest()
        return VerifiablePresentation(did=did, agent_id=agent_id, claims={"role": "worker"}, signature=signature)

    def test_verify_valid_presentation(self):
        public_key, private_key = generate_keypair()
        self.registry.register("did:alp:a:1", "agent-1", ["read"], "trusted")
        vp = self._make_vp("did:alp:a:1", "agent-1", public_key)
        result = self.resolver.verify_presentation(vp, public_key)
        self.assertTrue(result["valid"])
        self.assertEqual(result["agent_id"], "agent-1")
        self.assertIn("read", result["scopes"])

    def test_verify_unknown_did(self):
        public_key, _ = generate_keypair()
        vp = self._make_vp("did:alp:unknown", "x", public_key)
        result = self.resolver.verify_presentation(vp, public_key)
        self.assertFalse(result["valid"])
        self.assertEqual(result["reason"], "unknown_did")

    def test_verify_bad_signature(self):
        self.registry.register("did:alp:a:1", "agent-1", ["read"])
        vp = VerifiablePresentation(did="did:alp:a:1", agent_id="agent-1", claims={}, signature="bad")
        result = self.resolver.verify_presentation(vp, "key")
        self.assertFalse(result["valid"])
        self.assertEqual(result["reason"], "invalid_signature")


class TestAgentKeyStore(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.tmpdir = tempfile.mkdtemp()
        self.store = AgentKeyStore(self.tmpdir)

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_store_and_get(self):
        self.store.store_key("did:alp:a:1", "public", "private")
        entry = self.store.get_key("did:alp:a:1")
        self.assertIsNotNone(entry)
        self.assertEqual(entry["public_key"], "public")
        self.assertEqual(entry["private_key"], "private")

    def test_remove_key(self):
        self.store.store_key("did:alp:a:1", "public", "private")
        self.assertTrue(self.store.remove_key("did:alp:a:1"))
        self.assertIsNone(self.store.get_key("did:alp:a:1"))

    def test_persists_to_file(self):
        self.store.store_key("did:alp:a:1", "public", "private")
        p = keys_path(self.tmpdir)
        self.assertTrue(os.path.exists(p))


if __name__ == "__main__":
    unittest.main()
