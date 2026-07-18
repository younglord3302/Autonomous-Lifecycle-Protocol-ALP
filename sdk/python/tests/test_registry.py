import os
import sys
import json
import shutil
import tempfile
import threading
import unittest
import urllib.request
import hashlib

SDK_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SDK_ROOT not in sys.path:
    sys.path.insert(0, SDK_ROOT)

from alp_sdk import RegistryClient, satisfies, semver_cmp, load_alprc
from alp_sdk import verify_version_signature, signing_payload, sign, generate_keypair, fingerprint
from alp_sdk.signing import _HAVE_CRYPTO

REPO_ROOT = os.path.dirname(os.path.dirname(SDK_ROOT))
CLI = os.path.join(REPO_ROOT, "cli", "dist", "index.js")


class TestSemver(unittest.TestCase):
    def test_cmp_prerelease(self):
        self.assertLess(semver_cmp("1.0.0", "1.0.1"), 0)
        self.assertGreater(semver_cmp("2.0.0", "1.9.9"), 0)
        self.assertEqual(semver_cmp("1.0.0", "1.0.0"), 0)
        self.assertGreater(semver_cmp("1.0.0", "1.0.0-beta"), 0)

    def test_satisfies(self):
        self.assertTrue(satisfies("1.2.3", "^1.0.0"))
        self.assertFalse(satisfies("2.0.0", "^1.0.0"))
        self.assertTrue(satisfies("0.2.5", "^0.2.3"))
        self.assertFalse(satisfies("0.3.0", "^0.2.3"))
        self.assertTrue(satisfies("1.2.9", "~1.2.3"))
        self.assertFalse(satisfies("1.3.0", "~1.2.3"))
        self.assertTrue(satisfies("1.5.0", "1.x"))
        self.assertFalse(satisfies("2.0.0", "1.x"))
        self.assertTrue(satisfies("1.4.0", ">=1.2.0 <1.5.0"))
        self.assertFalse(satisfies("1.5.0", ">=1.2.0 <1.5.0"))
        self.assertTrue(satisfies("1.0.0", "*"))


class TestAlprc(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir, ignore_errors=True)

    def test_loads_and_expands_env(self):
        os.environ["ALP_TEST_TOKEN"] = "secret-123"
        self.addCleanup(os.environ.pop, "ALP_TEST_TOKEN", None)
        with open(os.path.join(self.dir, ".alprc.json"), "w", encoding="utf-8") as f:
            json.dump({
                "registries": {"default": "https://reg.example", "@internal": "https://alp.corp"},
                "auth": {"https://alp.corp": {"token": "${ALP_TEST_TOKEN}"}},
            }, f)
        cfg = load_alprc(self.dir)
        self.assertEqual(cfg["registries"]["@internal"], "https://alp.corp")
        self.assertEqual(cfg["auth"]["https://alp.corp"]["token"], "secret-123")

    def test_namespace_routing(self):
        cfg = {"registries": {"@internal": "https://alp.corp", "default": "https://reg.example"}}
        client = RegistryClient("http://127.0.0.1:4000", cfg)
        self.assertEqual(client.resolve_base_url("@internal/deploy"), "https://alp.corp")
        self.assertEqual(client.resolve_base_url("@community/scrum"), "https://reg.example")
        self.assertEqual(client.resolve_base_url("@other/x"), "https://reg.example")
        bare = RegistryClient("http://127.0.0.1:4000", {})
        self.assertEqual(bare.resolve_base_url("@other/x"), "http://127.0.0.1:4000")

    def test_rejects_plain_http_non_loopback(self):
        client = RegistryClient("http://evil.example.com")
        with self.assertRaises(RuntimeError):
            client.list()


class TestRegistryServer(unittest.TestCase):
    """End-to-end: publish + serve (TS CLI) then install via the Python client."""

    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.pkg = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        self.addCleanup(shutil.rmtree, self.pkg, ignore_errors=True)

        os.makedirs(os.path.join(self.root, ".alp"), exist_ok=True)
        with open(os.path.join(self.root, ".alp", "project.alp"), "w", encoding="utf-8") as f:
            f.write('@project\n  id: demo-ws\n  name: "Demo"\n')
        with open(os.path.join(self.pkg, "alp-package.json"), "w", encoding="utf-8") as f:
            json.dump({"name": "@demo/scrum-master", "version": "1.0.0",
                       "description": "Scrum", "files": ["plugin.alp"]}, f)
        with open(os.path.join(self.pkg, "plugin.alp"), "w", encoding="utf-8") as f:
            f.write('@agent\n  id: agent-scrum\n')

        self._run(["node", CLI, "registry", "publish", self.pkg], cwd=self.root)
        self.port = 4399
        self.proc = self._spawn(["node", CLI, "serve", "--registry",
                                 "--port", str(self.port)], cwd=self.root)
        self._wait_for(self.port)

    def tearDown(self):
        self._kill(self.proc)

    def _run(self, cmd, cwd=None, timeout=30):
        import subprocess
        return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)

    def _spawn(self, cmd, cwd=None):
        import subprocess
        return subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def _kill(self, proc):
        if proc and proc.poll() is None:
            proc.kill()

    def _wait_for(self, port, tries=50):
        import time
        for _ in range(tries):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/state", timeout=1):
                    return
            except Exception:
                time.sleep(0.1)
        raise RuntimeError("registry server did not start")

    def test_install_over_http(self):
        consumer = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, consumer, ignore_errors=True)
        os.makedirs(os.path.join(consumer, ".alp"), exist_ok=True)

        client = RegistryClient(f"http://127.0.0.1:{self.port}")
        path = client.install("@demo/scrum-master", os.path.join(consumer, ".alp"), "1.0.0")

        self.assertTrue(os.path.exists(path))
        with open(os.path.join(consumer, ".alp", "registry.lock.json"), encoding="utf-8") as f:
            lock = json.load(f)
        self.assertEqual(lock["@demo/scrum-master"]["version"], "1.0.0")


class TestRegistryHardening(unittest.TestCase):
    """Per-namespace tokens + publish-time auth (registry hardening)."""

    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.pkg = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        self.addCleanup(shutil.rmtree, self.pkg, ignore_errors=True)

        os.makedirs(os.path.join(self.root, ".alp"), exist_ok=True)
        with open(os.path.join(self.root, ".alp", "project.alp"), "w", encoding="utf-8") as f:
            f.write('@project\n  id: demo-ws\n  name: "Demo"\n')
        with open(os.path.join(self.pkg, "alp-package.json"), "w", encoding="utf-8") as f:
            json.dump({"name": "@demo/scrum-master", "version": "1.0.0",
                       "description": "Scrum", "files": ["plugin.alp"]}, f)
        with open(os.path.join(self.pkg, "plugin.alp"), "w", encoding="utf-8") as f:
            f.write('@agent\n  id: agent-scrum\n')

        self.port = 4401
        self.proc = self._spawn(["node", CLI, "serve", "--registry",
                                 "--registry-token", "@demo=demo-secret",
                                 "--port", str(self.port)], cwd=self.root)
        self._wait_for(self.port)

    def tearDown(self):
        self._kill(self.proc)

    def _spawn(self, cmd, cwd=None):
        import subprocess
        return subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def _kill(self, proc):
        if proc and proc.poll() is None:
            proc.kill()

    def _wait_for(self, port, tries=50):
        import time
        for _ in range(tries):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/state", timeout=1):
                    return
            except Exception:
                time.sleep(0.1)
        raise RuntimeError("registry server did not start")

    def _get_status(self, path, token=None):
        headers = {"Authorization": "Bearer " + token} if token else {}
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", headers=headers)
        try:
            with urllib.request.urlopen(req) as resp:
                return resp.status
        except urllib.error.HTTPError as e:
            return e.code

    def test_private_namespace_read_requires_token(self):
        # @demo is private (token configured) -> read without token is 401.
        self.assertEqual(self._get_status("/api/registry/-/demo/scrum-master/meta.json"), 401)
        # After publishing with the token, the same token reads it (200), and a
        # wrong token is still 401.
        auth = RegistryClient(f"http://127.0.0.1:{self.port}", token="demo-secret")
        auth.publish(self.pkg)
        self.assertEqual(self._get_status("/api/registry/-/demo/scrum-master/meta.json", "demo-secret"), 200)
        self.assertEqual(self._get_status("/api/registry/-/demo/scrum-master/meta.json", "wrong"), 401)

    def test_publish_requires_namespace_token(self):
        # Publish into @demo without the token is rejected.
        anon = RegistryClient(f"http://127.0.0.1:{self.port}")
        with self.assertRaises(RuntimeError):
            anon.publish(self.pkg)

        # With the namespace token it succeeds and the package is readable.
        auth = RegistryClient(f"http://127.0.0.1:{self.port}", token="demo-secret")
        meta = auth.publish(self.pkg)
        self.assertEqual(meta["name"], "@demo/scrum-master")
        self.assertEqual(self._get_status("/api/registry/-/demo/scrum-master/meta.json"), 401)


class TestVerifyVersionSignature(unittest.TestCase):
    """Shared verifier parity with the TS CLI (v4.5)."""

    def _info(self, content, signer=None, trust_roots=None):
        entry_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
        info = {
            "url": "/x",
            "integrity": "sha256:" + entry_hash,
            "dependencies": {},
            "size": len(content),
            "entry": "plugin.alp",
            "files": ["plugin.alp"],
        }
        if signer:
            info["signature"] = sign(
                signer,
                signing_payload(name="@demo/x", version="1.0.0", entry="plugin.alp", entry_hash=entry_hash, dependencies={}),
            )
        return info

    def test_unsigned_without_trust_root(self):
        r = verify_version_signature("@demo/x", "1.0.0", self._info("@agent\n  id: a\n"))
        self.assertFalse(r["signed"])
        self.assertFalse(r["valid"])
        self.assertFalse(r["trusted"])

    @unittest.skipUnless(_HAVE_CRYPTO, "Ed25519 signing requires the cryptography package")
    def test_unsigned_with_trust_root_requires_signature(self):
        roots = {"@demo": generate_keypair()[1]}
        r = verify_version_signature("@demo/x", "1.0.0", self._info("@agent\n  id: a\n"), trust_roots=roots)
        self.assertFalse(r["signed"])
        self.assertRegex(r["reason"], "trust root requires a signature")

    @unittest.skipUnless(_HAVE_CRYPTO, "Ed25519 signing requires the cryptography package")
    def test_trusted_and_untrusted_signatures(self):
        priv, pub = generate_keypair()
        other = generate_keypair()
        content = "@agent\n  id: a\n"
        roots = {"@demo": pub}

        ok = verify_version_signature("@demo/x", "1.0.0", self._info(content, priv), trust_roots=roots)
        self.assertTrue(ok["signed"])
        self.assertTrue(ok["valid"])
        self.assertTrue(ok["trusted"])

        bad = verify_version_signature("@demo/x", "1.0.0", self._info(content, other[0]), trust_roots=roots)
        self.assertTrue(bad["signed"])
        self.assertTrue(bad["valid"])
        self.assertFalse(bad["trusted"])
        self.assertRegex(bad["reason"], "not in trust root")

        tampered = self._info(content, priv, trust_roots=roots)
        tampered["integrity"] = "sha256:" + "0" * 64
        invalid = verify_version_signature("@demo/x", "1.0.0", tampered, trust_roots=roots)
        self.assertFalse(invalid["valid"])

    @unittest.skipUnless(_HAVE_CRYPTO, "Ed25519 signing requires the cryptography package")
    def test_fingerprint_root_and_explicit_key(self):
        priv, pub = generate_keypair()
        content = "@agent\n  id: a\n"
        by_fp = verify_version_signature("@demo/x", "1.0.0", self._info(content, priv), trust_roots={"@demo": fingerprint(pub)})
        self.assertTrue(by_fp["trusted"])

        other = generate_keypair()
        explicit = verify_version_signature("@demo/x", "1.0.0", self._info(content, other[0]), explicit_trust_pem=other[1])
        self.assertTrue(explicit["trusted"])
        self.assertTrue(explicit["valid"])


if __name__ == "__main__":
    unittest.main()
