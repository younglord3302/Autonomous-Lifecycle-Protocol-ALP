import os
import sys
import hashlib
import tempfile
import shutil
import unittest

SDK_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SDK_ROOT not in sys.path:
    sys.path.insert(0, SDK_ROOT)

from alp_sdk import PluginResolver
from alp_sdk.error import SyntaxError as AlpSyntaxError, ValidationError


PLUGIN = """
@plugin
  id: plugin-scrum
  name: "ALP Scrum Extension"
  version: 1.0.0
  types:
    - -> type-epic
    - -> type-sprint

---

@type_definition
  id: type-epic
  type_name: epic
  description: "A large body of work"
  properties:
    - { name: "id", type: "String", required: true }
    - { name: "name", type: "String", required: true }
    - { name: "status", type: "Status", required: true }
  allowed_nested:
    - "accept"
"""


class TestPluginResolver(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.resolver = PluginResolver()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _make(self, files):
        for name, content in files.items():
            full = os.path.join(self.tmp, name)
            os.makedirs(os.path.dirname(full), exist_ok=True)
            with open(full, "w", encoding="utf-8") as f:
                f.write(content)
        return self.tmp

    def _read(self, name):
        with open(os.path.join(self.tmp, name), encoding="utf-8") as f:
            return f.read()

    def test_registers_custom_types_from_local_import(self):
        root = self._make({
            "project.alp": '!import: "plugins/scrum.alp"\n\n@project\n  id: my-proj\n',
            "plugins/scrum.alp": PLUGIN,
        })
        objects = self.resolver.parse_workspace(
            self._read("project.alp"), root
        )
        self.assertTrue(self.resolver.is_custom_type("epic"))
        self.assertIn("status", [p.name for p in self.resolver.types["epic"].properties])
        self.assertTrue(any(o._type == "project" for o in objects))
        self.assertIn("plugin-scrum", self.resolver.plugins)

    def test_parses_custom_type_instance(self):
        root = self._make({
            "project.alp": '!import: "plugins/scrum.alp"\n\n@epic\n  id: epic-q3\n  name: "Q3"\n  status: [~]\n',
            "plugins/scrum.alp": PLUGIN,
        })
        objects = self.resolver.parse_workspace(
            self._read("project.alp"), root
        )
        epic = next((o for o in objects if o._type == "epic"), None)
        self.assertIsNotNone(epic)
        self.assertEqual(epic.id, "epic-q3")

    def test_validates_required_properties(self):
        root = self._make({
            "project.alp": '!import: "plugins/scrum.alp"\n\n@epic\n  id: epic-bad\n  name: "No status"\n',
            "plugins/scrum.alp": PLUGIN,
        })
        self.resolver.parse_workspace(
            self._read("project.alp"), root
        )
        epic = next(o for o in self.resolver.objects if o._type == "epic")
        with self.assertRaises(ValidationError):
            self.resolver.validate_custom(epic)

    def test_detects_circular_imports(self):
        root = self._make({
            "a.alp": '!import: "b.alp"\n@project\n  id: a\n',
            "b.alp": '!import: "a.alp"\n@feature\n  id: b\n',
        })
        with self.assertRaises(AlpSyntaxError):
            self.resolver.parse_workspace(
                open(os.path.join(root, "a.alp"), encoding="utf-8").read(), root
            )

    def test_rejects_remote_imports(self):
        # http (non-https) is rejected even though remote imports are supported.
        root = self._make({
            "project.alp": '!import: "http://example.com/x.alp"\n@project\n  id: p\n',
        })
        with self.assertRaises(AlpSyntaxError):
            self.resolver.parse_workspace(self._read("project.alp"), root)

    def test_loads_plugin_via_https_import(self):
        transport = lambda url: {"status": 200, "body": PLUGIN}
        root = self._make({
            "project.alp": '!import: "https://example.com/plugins/scrum.alp"\n\n@epic\n  id: epic-q3\n  name: "Q3"\n',
        })
        resolver = PluginResolver(root)
        objects = resolver.parse_workspace(
            self._read("project.alp"), root, {"transport": transport}
        )
        self.assertTrue(resolver.is_custom_type("epic"))
        self.assertTrue(any(o._type == "epic" and o.id == "epic-q3" for o in objects))

    def test_loads_plugin_via_registry_alias(self):
        hits = {}

        def transport(url):
            hits["url"] = url
            return {"status": 200, "body": PLUGIN}

        root = self._make({
            "project.alp": '!import: "@alp/scrum@1.0.0"\n\n@epic\n  id: epic-a\n  name: "A"\n',
        })
        resolver = PluginResolver(root)
        resolver.parse_workspace(
            self._read("project.alp"), root,
            {"registry_base": "https://reg.test", "transport": transport},
        )
        self.assertEqual(hits["url"], "https://reg.test/plugins/alp/scrum/1.0.0/plugin.alp")
        self.assertTrue(resolver.is_custom_type("epic"))

    def test_integrity_verification(self):
        good = "sha256:" + hashlib.sha256(PLUGIN.encode("utf-8")).hexdigest()
        root = self._make({
            "project.alp": '!import: "https://example.com/plugins/scrum.alp" !integrity: %s\n@epic\n  id: e\n  name: "n"\n' % good,
        })
        resolver = PluginResolver(root)
        resolver.parse_workspace(
            self._read("project.alp"), root, {"transport": lambda u: {"status": 200, "body": PLUGIN}}
        )
        self.assertTrue(resolver.is_custom_type("epic"))

        # Mismatched integrity must fail.
        root2 = self._make({
            "project.alp": '!import: "https://example.com/plugins/scrum.alp" !integrity: sha256:deadbeef\n@epic\n  id: e\n  name: "n"\n',
        })
        resolver2 = PluginResolver(root2)
        with self.assertRaises(AlpSyntaxError):
            resolver2.parse_workspace(
                self._read("project.alp"), root2,
                {"transport": lambda u: {"status": 200, "body": PLUGIN}},
            )


if __name__ == "__main__":
    unittest.main()
