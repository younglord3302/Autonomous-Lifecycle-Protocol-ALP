import os
import sys
import unittest
import json as _json
import tempfile as _tempfile

SDK_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SDK_ROOT not in sys.path:
    sys.path.insert(0, SDK_ROOT)

from alp_sdk import (
    AlpObject,
    PolicyEngine,
    PolicyQuery,
    PolicyFederation,
    FederatedDecision,
    FederatedTrustRoot,
)


def pol(pid, **props):
    d = {"_type": "policy", "id": pid}
    d.update(props)
    return AlpObject.from_dict(d)


class TestPolicyFederationBasics(unittest.TestCase):
    def test_single_source_evaluate(self):
        fed = PolicyFederation.from_objects(
            [pol("p1", deny_commands=["rm -rf"], enforcement="strict")]
        )
        d = fed.evaluate(PolicyQuery("command", "rm -rf", agent="a1"))
        self.assertFalse(d.allowed)
        self.assertTrue(d.blocked)
        self.assertIn("p1", d.policies)

    def test_no_policies_allows(self):
        fed = PolicyFederation.from_objects([])
        d = fed.evaluate(PolicyQuery("command", "ls", agent="a1"))
        self.assertTrue(d.allowed)
        self.assertFalse(d.blocked)

    def test_scopes_property(self):
        fed = PolicyFederation.from_objects([pol("p1")], scope="local")
        self.assertEqual(fed.scopes(), ["local"])


class TestFederationAggregation(unittest.TestCase):
    def test_deny_in_any_source_blocks(self):
        # Workspace policy is permissive; registry namespace is strict-deny.
        local = [pol("local-permissive", allow_commands=["npm test"], enforcement="strict")]
        registry = [pol("ns-deny", deny_commands=["git push"], enforcement="strict")]
        fed = PolicyFederation([__import__("alp_sdk", fromlist=["policy_federation"]).PolicySource("local", PolicyEngine([local[0]]))])
        fed.add_source([registry[0]], "registry:@demo")
        d_push = fed.evaluate(PolicyQuery("command", "git push", agent="a1"))
        self.assertFalse(d_push.allowed)
        self.assertTrue(d_push.blocked)
        self.assertIn("registry:@demo", d_push.sources)

    def test_allow_list_missing_in_one_source_blocks(self):
        # Source A allows "npm test"; source B requires "eslint" in its allow-list
        # and denies nothing. The action "npm test" is not in B's allow-list.
        a = [pol("a", allow_commands=["npm test"], enforcement="strict")]
        b = [pol("b", allow_commands=["eslint"], enforcement="strict")]
        fed = PolicyFederation.from_objects(a, scope="a")
        fed.add_source(b, "b")
        d = fed.evaluate(PolicyQuery("command", "npm test", agent="a1"))
        self.assertFalse(d.allowed)
        self.assertIn("b", d.sources)

    def test_warn_source_reports_not_blocks(self):
        a = [pol("strict-deny", deny_commands=["rm -rf"], enforcement="strict")]
        b = [pol("warn-deny", deny_commands=["rm -rf"], enforcement="warn")]
        fed = PolicyFederation.from_objects(a, scope="a")
        fed.add_source(b, "b")
        d = fed.evaluate(PolicyQuery("command", "rm -rf", agent="a1"))
        # Strict source blocks; warn source only reports.
        self.assertFalse(d.allowed)
        self.assertTrue(d.blocked)
        # Both sources produced a reason.
        self.assertEqual(len(d.sources), 2)

    def test_neutral_source_ignored(self):
        a = [pol("a", deny_commands=["rm -rf"], enforcement="strict")]
        # b only governs paths, so it is neutral for a command query.
        b = [pol("b", allow_paths=["src/**"], enforcement="strict")]
        fed = PolicyFederation.from_objects(a, scope="a")
        fed.add_source(b, "b")
        d = fed.evaluate(PolicyQuery("command", "rm -rf", agent="a1"))
        self.assertFalse(d.allowed)
        self.assertEqual(d.sources, ["a"])


class TestRegistryFederation(unittest.TestCase):
    def test_add_registry_policies(self):
        fed = PolicyFederation.from_objects(
            [pol("local", deny_commands=["rm -rf"], enforcement="strict")]
        )
        fed.add_registry_policies(
            [{"_type": "policy", "id": "ns-policy", "deny_paths": [".env"], "enforcement": "strict"}],
            namespace="demo",
        )
        self.assertIn("registry:@demo", fed.scopes())
        d_path = fed.evaluate(PolicyQuery("path", ".env", agent="a1"))
        self.assertFalse(d_path.allowed)
        self.assertIn("registry:@demo", d_path.sources)

    def test_registry_policy_dict_to_object(self):
        fed = PolicyFederation()
        fed.add_registry_policies(
            [{"_type": "policy", "id": "r1", "deny_commands": ["curl"], "enforcement": "strict"}],
            "ns",
        )
        d = fed.evaluate(PolicyQuery("command", "curl http://x", agent="a1"))
        self.assertFalse(d.allowed)


class TestAuditTrail(unittest.TestCase):
    def test_audit_trail_structure(self):
        fed = PolicyFederation.from_objects(
            [pol("p1", deny_commands=["rm -rf"], enforcement="strict")]
        )
        trail = fed.audit_trail(PolicyQuery("command", "rm -rf", agent="a1"))
        self.assertFalse(trail["allowed"])
        self.assertTrue(trail["blocked"])
        self.assertIn("query", trail)
        self.assertIn("sources_evaluated", trail)
        self.assertIn("per_source", trail)
        self.assertEqual(len(trail["per_source"]), 1)
        self.assertIn("p1", trail["policies"])

    def test_audit_trail_clean_allow(self):
        fed = PolicyFederation.from_objects([pol("p1", allow_commands=["ls"], enforcement="strict")])
        trail = fed.audit_trail(PolicyQuery("command", "ls", agent="a1"))
        self.assertTrue(trail["allowed"])
        self.assertEqual(trail["sources_violated"], [])


class TestDenyOnly(unittest.TestCase):
    def test_evaluate_deny_only_ignores_allow(self):
        a = [pol("a", allow_commands=["npm test"], enforcement="strict")]
        b = [pol("b", deny_commands=["rm -rf"], enforcement="strict")]
        fed = PolicyFederation.from_objects(a, scope="a")
        fed.add_source(b, "b")
        d = fed.evaluate_deny_only(PolicyQuery("command", "npm test", agent="a1"))
        self.assertTrue(d.allowed)
        self.assertFalse(d.blocked)


class TestCrossFederationTrust(unittest.TestCase):
    def test_federated_trust_root_dataclass(self):
        root = FederatedTrustRoot(
            namespace="ns-a",
            public_key_pem="-----BEGIN PUBLIC KEY-----\nABCD\n-----END PUBLIC KEY-----",
            fingerprint="aa:bb:cc",
        )
        self.assertEqual(root.namespace, "ns-a")
        self.assertIn("BEGIN PUBLIC KEY", root.public_key_pem)
        self.assertEqual(root.fingerprint, "aa:bb:cc")

    def test_bootstrap_trust_returns_provided_when_file_missing(self):
        root = FederatedTrustRoot(namespace="ns-b", public_key_pem="pem-b", fingerprint="ff-b")
        result = PolicyFederation.bootstrap_trust("/nonexistent/path", root)
        self.assertEqual(result.namespace, "ns-b")
        self.assertEqual(result.public_key_pem, "pem-b")
        self.assertEqual(result.fingerprint, "ff-b")

    def test_bootstrap_trust_reads_from_file_when_exists(self):
        with _tempfile.TemporaryDirectory() as tmpdir:
            trust_dir = os.path.join(tmpdir, ".alp", "trust")
            os.makedirs(trust_dir, exist_ok=True)
            with open(os.path.join(trust_dir, "root.json"), "w", encoding="utf-8") as fh:
                _json.dump({
                    "namespace": "ns-file",
                    "publicKeyPem": "pem-file",
                    "fingerprint": "ff-file",
                }, fh)
            provided = FederatedTrustRoot(namespace="ns-provided", public_key_pem="pem-provided", fingerprint="ff-provided")
            result = PolicyFederation.bootstrap_trust(tmpdir, provided)
            self.assertEqual(result.namespace, "ns-file")
            self.assertEqual(result.public_key_pem, "pem-file")
            self.assertEqual(result.fingerprint, "ff-file")

    def test_inherited_policies_merges_and_deduplicates(self):
        parent = PolicyFederation.from_objects(
            [pol("policy-parent", allow_paths=["shared/**"], deny_paths=["shared/secret"], enforcement="strict")],
            scope="parent",
        )
        child = PolicyFederation.from_objects(
            [pol("policy-child", allow_paths=["child/**"], deny_paths=["child/secret"], enforcement="strict")],
            scope="child",
        )
        merged = PolicyFederation.inherited_policies(parent, child)
        ids = [p.id for p in merged]
        self.assertIn("policy-parent", ids)
        self.assertIn("policy-child", ids)
        self.assertEqual(len(merged), 2)

    def test_inherited_policies_child_overrides_parent(self):
        parent = PolicyFederation.from_objects(
            [pol("policy-parent", allow_paths=["shared/**"], enforcement="strict")],
            scope="parent",
        )
        child = PolicyFederation.from_objects(
            [pol("policy-parent", allow_paths=["child-only/**"], enforcement="strict")],
            scope="child",
        )
        merged = PolicyFederation.inherited_policies(parent, child)
        ids = [p.id for p in merged]
        self.assertIn("policy-parent", ids)
        self.assertEqual(ids.count("policy-parent"), 1)
        parent_policy = next(p for p in merged if p.id == "policy-parent")
        self.assertIn("child-only/**", parent_policy.properties.get("allow_paths", []))

    def test_cross_federation_evaluate_empty_roots(self):
        fed = PolicyFederation.from_objects(
            [pol("p1", allow_paths=["src/**"], enforcement="strict")]
        )
        d = fed.cross_federation_evaluate(PolicyQuery("path", "src/main.ts"), [])
        self.assertTrue(d.allowed)
        self.assertFalse(d.blocked)
        self.assertEqual(d.reasons, [])

    def test_cross_federation_evaluate_prefixes_reasons_with_namespace(self):
        fed = PolicyFederation.from_objects(
            [pol("p1", deny_paths=[".env"], enforcement="strict")]
        )
        roots = [
            FederatedTrustRoot(namespace="ns-a", public_key_pem="pem-a", fingerprint="ff-a"),
            FederatedTrustRoot(namespace="ns-b", public_key_pem="pem-b", fingerprint="ff-b"),
        ]
        d = fed.cross_federation_evaluate(PolicyQuery("path", ".env"), roots)
        self.assertFalse(d.allowed)
        self.assertTrue(d.reasons)
        for r in d.reasons:
            self.assertTrue(r.startswith("[ns-a,ns-b]"), f"reason '{r}' missing namespace prefix")

    def test_cross_federation_evaluate_prefixes_policies_with_namespace(self):
        fed = PolicyFederation.from_objects(
            [pol("p1", deny_paths=[".env"], enforcement="strict")]
        )
        roots = [
            FederatedTrustRoot(namespace="ns-x", public_key_pem="pem-x", fingerprint="ff-x"),
        ]
        d = fed.cross_federation_evaluate(PolicyQuery("path", ".env"), roots)
        self.assertTrue(d.policies)
        for p in d.policies:
            self.assertTrue(p.startswith("[ns-x]"), f"policy '{p}' missing namespace prefix")


if __name__ == "__main__":
    unittest.main()
