import os
import sys
import unittest

SDK_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SDK_ROOT not in sys.path:
    sys.path.insert(0, SDK_ROOT)

from alp_sdk import (
    parse_registry_alias,
    resolve_dependency_graph,
    VersionConflictError,
    satisfies,
    semver_cmp,
)


class TestParseRegistryAlias(unittest.TestCase):
    def test_exact(self):
        pkg, ns, rng = parse_registry_alias("@alp/scrum@1.0.0")
        self.assertEqual(pkg, "@alp/scrum")
        self.assertEqual(ns, "alp")
        self.assertEqual(rng, "1.0.0")

    def test_range(self):
        pkg, ns, rng = parse_registry_alias("@alp/kanban@^2.1.0")
        self.assertEqual(pkg, "@alp/kanban")
        self.assertEqual(rng, "^2.1.0")

    def test_latest(self):
        pkg, ns, rng = parse_registry_alias("@internal/deploy@latest")
        self.assertEqual(pkg, "@internal/deploy")
        self.assertEqual(rng, "latest")

    def test_invalid_raises(self):
        with self.assertRaises(ValueError):
            parse_registry_alias("not-an-alias")
        with self.assertRaises(ValueError):
            parse_registry_alias("@alp/scrum")


def _make_meta(versions):
    """Build a minimal meta.json from {version: {deps: {pkg: range}}}."""
    out = {"name": "x", "versions": {}}
    for v, deps in versions.items():
        out["versions"][v] = {
            "url": f"https://reg/x/{v}/plugin.alp",
            "integrity": "sha256:" + "0" * 64,
            "dependencies": deps,
        }
    return out


class TestStrictSingleton(unittest.TestCase):
    def test_single_dependency_resolves_latest(self):
        def fetch(pkg):
            return _make_meta({"1.0.0": {}, "1.1.0": {}, "1.2.0": {}})
        graph = resolve_dependency_graph(["@alp/a"], fetch)
        self.assertEqual(graph["@alp/a"], "1.2.0")

    def test_transitive_dependency_included(self):
        state = {
            "@alp/a": _make_meta({"1.0.0": {"@alp/b": "^1.0.0"}}),
            "@alp/b": _make_meta({"1.0.0": {}, "1.5.0": {}}),
        }
        graph = resolve_dependency_graph(["@alp/a"], state.get)
        self.assertEqual(graph["@alp/a"], "1.0.0")
        self.assertEqual(graph["@alp/b"], "1.5.0")

    def test_compatible_ranges_intersect(self):
        # Two packages both require @alp/core, ranges ^1.0.0 and ~1.2.0.
        state = {
            "@alp/x": _make_meta({"1.0.0": {"@alp/core": "^1.0.0"}}),
            "@alp/y": _make_meta({"1.0.0": {"@alp/core": "~1.2.0"}}),
            "@alp/core": _make_meta({"1.2.0": {}, "1.2.3": {}, "1.3.0": {}}),
        }
        graph = resolve_dependency_graph(["@alp/x", "@alp/y"], state.get)
        self.assertEqual(graph["@alp/core"], "1.2.3")

    def test_incompatible_ranges_raise_conflict(self):
        state = {
            "@alp/x": _make_meta({"1.0.0": {"@alp/core": "^1.0.0"}}),
            "@alp/y": _make_meta({"1.0.0": {"@alp/core": "^2.0.0"}}),
            "@alp/core": _make_meta({"1.5.0": {}, "2.1.0": {}}),
        }
        with self.assertRaises(VersionConflictError):
            resolve_dependency_graph(["@alp/x", "@alp/y"], state.get)

    def test_exact_mismatch_raises_conflict(self):
        state = {
            "@alp/x": _make_meta({"1.0.0": {"@alp/core": "1.0.0"}}),
            "@alp/y": _make_meta({"1.0.0": {"@alp/core": "2.0.0"}}),
            "@alp/core": _make_meta({"1.0.0": {}, "2.0.0": {}}),
        }
        with self.assertRaises(VersionConflictError):
            resolve_dependency_graph(["@alp/x", "@alp/y"], state.get)

    def test_only_one_version_per_package(self):
        state = {
            "@alp/top": _make_meta({"1.0.0": {"@alp/mid": "^1.0.0"}}),
            "@alp/mid": _make_meta({"1.0.0": {"@alp/leaf": "^1.0.0"}, "1.4.0": {"@alp/leaf": "^1.0.0"}}),
            "@alp/leaf": _make_meta({"1.0.0": {}, "1.9.0": {}}),
        }
        graph = resolve_dependency_graph(["@alp/top"], state.get)
        self.assertIn("@alp/leaf", graph)
        self.assertEqual(len([k for k in graph if k == "@alp/leaf"]), 1)


if __name__ == "__main__":
    unittest.main()
