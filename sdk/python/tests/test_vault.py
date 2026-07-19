import os
import sys
import tempfile
import unittest

SDK_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SDK_ROOT not in sys.path:
    sys.path.insert(0, SDK_ROOT)

from alp_sdk.vault import _HAVE_CRYPTO, Vault  # noqa: E402


@unittest.skipUnless(_HAVE_CRYPTO, "requires optional 'cryptography' package")
class TestVault(unittest.TestCase):
    def setUp(self):
        from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
        from cryptography.hazmat.primitives import serialization

        self.dir = tempfile.mkdtemp()
        self.a = X25519PrivateKey.generate()
        self.b = X25519PrivateKey.generate()
        self.a_pub = self.a.public_key().public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        ).decode()
        self.a_priv = self.a.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ).decode()
        self.b_priv = self.b.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ).decode()

    def tearDown(self):
        import shutil
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_seal_unseal(self):
        vault = Vault({"dir": self.dir})
        vault.set("db-password", "s3cr3t", [self.a_pub])
        self.assertEqual(vault.get("db-password", self.a_priv), "s3cr3t")

    def test_no_plaintext_on_disk(self):
        vault = Vault({"dir": self.dir})
        vault.set("api-key", "topsecret-value", [self.a_pub])
        with open(os.path.join(self.dir, "store.jsonl"), "r") as fh:
            self.assertNotIn("topsecret-value", fh.read())

    def test_unauthorized_rejected(self):
        vault = Vault({"dir": self.dir})
        vault.set("secret", "value", [self.a_pub])
        with self.assertRaises(PermissionError):
            vault.get("secret", self.b_priv)

    def test_unknown_id(self):
        vault = Vault({"dir": self.dir})
        with self.assertRaises(KeyError):
            vault.get("missing", self.a_priv)

    def test_list_no_values(self):
        vault = Vault({"dir": self.dir})
        vault.set("s1", "v1", [self.a_pub])
        vault.set("s2", "v2", [self.a_pub])
        self.assertEqual(sorted(s["id"] for s in vault.list()), ["s1", "s2"])

    def test_rotate(self):
        vault = Vault({"dir": self.dir})
        vault.set("rotate-me", "original", [self.a_pub])
        rotated = vault.rotate("rotate-me", self.a_priv)
        self.assertIsNotNone(rotated.rotated_at)
        self.assertEqual(vault.get("rotate-me", self.a_priv), "original")

    def test_multiple_recipients(self):
        from cryptography.hazmat.primitives import serialization

        vault = Vault({"dir": self.dir})
        b_pub = self.b.public_key().public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
        ).decode()
        vault.set("shared", "team-secret", [self.a_pub, b_pub])
        self.assertEqual(vault.get("shared", self.a_priv), "team-secret")
        self.assertEqual(vault.get("shared", self.b_priv), "team-secret")

    def test_audit_trail(self):
        vault = Vault({"dir": self.dir})
        vault.set("audited", "v", [self.a_pub])
        vault.get("audited", self.a_priv)
        actions = [t.action for t in vault.audit()]
        self.assertIn("set", actions)
        self.assertIn("get", actions)


if __name__ == "__main__":
    unittest.main()
