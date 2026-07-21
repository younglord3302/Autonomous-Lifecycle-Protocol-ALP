import os
import sys
import unittest

SDK_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SDK_ROOT not in sys.path:
    sys.path.insert(0, SDK_ROOT)

from alp_sdk.bridge import (
    SUPPORTED_FORMATS,
    BridgeExportResult,
    BridgeImportResult,
    BridgeError,
    ProtocolBridge,
)


def _workflow():
    return {
        "id": "wf-dev",
        "name": "Development Loop",
        "steps": [
            {"id": "s1", "name": "implement"},
            {"id": "s2", "name": "test"},
            {"id": "s3", "name": "verify", "depends_on": ["s1", "s2"]},
        ],
    }


class TestProtocolBridgeBasics(unittest.TestCase):
    def test_supported_formats(self):
        self.assertEqual(set(SUPPORTED_FORMATS), {"openapi", "graphql", "grpc", "asyncapi"})

    def test_export_unknown_format_raises(self):
        bridge = ProtocolBridge()
        self.assertRaises(BridgeError, bridge.export_workflow, _workflow(), "xml")

    def test_import_unknown_format_raises(self):
        bridge = ProtocolBridge()
        self.assertRaises(BridgeError, bridge.import_spec, {}, "xml")


class TestOpenAPIBridge(unittest.TestCase):
    def setUp(self):
        self.bridge = ProtocolBridge()

    def test_export_returns_openapi_spec(self):
        result = self.bridge.export_workflow(_workflow(), "openapi")
        self.assertEqual(result.format, "openapi")
        self.assertEqual(result.spec["openapi"], "3.0.0")
        self.assertIn("/implement", result.spec["paths"])
        self.assertIn("/test", result.spec["paths"])
        self.assertIn("/verify", result.spec["paths"])

    def test_export_empty_workflow_warns(self):
        result = self.bridge.export_workflow({"id": "empty", "steps": []}, "openapi")
        self.assertEqual(result.format, "openapi")
        self.assertIn("empty", result.warnings[0].lower())

    def test_import_returns_workflow(self):
        spec = {
            "openapi": "3.0.0",
            "info": {"title": "Test API", "version": "1.0.0"},
            "paths": {"/hello": {"post": {"operationId": "sayHello"}}},
        }
        result = self.bridge.import_spec(spec, "openapi")
        self.assertEqual(result.format, "openapi")
        self.assertEqual(len(result.workflow["steps"]), 1)
        self.assertEqual(result.workflow["steps"][0]["id"], "sayHello")

    def test_round_trip(self):
        wf = _workflow()
        exported = self.bridge.export_workflow(wf, "openapi")
        imported = self.bridge.import_spec(exported.spec, "openapi")
        self.assertGreaterEqual(len(imported.workflow["steps"]), 1)
        self.assertEqual(imported.workflow["source_format"], "openapi")


class TestGraphQLBridge(unittest.TestCase):
    def setUp(self):
        self.bridge = ProtocolBridge()

    def test_export_returns_sdl_string(self):
        result = self.bridge.export_workflow(_workflow(), "graphql")
        self.assertEqual(result.format, "graphql")
        sdl = result.spec
        self.assertIn("type wf_devWorkflow", sdl)
        self.assertIn("implement: String", sdl)
        self.assertIn("test: String", sdl)
        self.assertIn("verify: String", sdl)

    def test_import_returns_workflow(self):
        sdl = "type Query {\n  hello: String\n}"
        result = self.bridge.import_spec(sdl, "graphql")
        self.assertEqual(result.format, "graphql")
        self.assertGreaterEqual(len(result.workflow["steps"]), 1)


class TestGRPCBridge(unittest.TestCase):
    def setUp(self):
        self.bridge = ProtocolBridge()

    def test_export_returns_proto_string(self):
        result = self.bridge.export_workflow(_workflow(), "grpc")
        self.assertEqual(result.format, "grpc")
        proto = result.spec
        self.assertIn('syntax = "proto3";', proto)
        self.assertIn("service wf_devService", proto)
        self.assertIn("rpc implement(implementRequest)", proto)
        self.assertIn("message implementRequest", proto)

    def test_import_returns_workflow(self):
        proto = 'syntax = "proto3";\nservice TestService {\n  rpc hello(HelloRequest) returns (HelloResponse);\n}'
        result = self.bridge.import_spec(proto, "grpc")
        self.assertEqual(result.format, "grpc")
        self.assertGreaterEqual(len(result.workflow["steps"]), 1)
        self.assertEqual(result.workflow["steps"][0]["id"], "hello")


class TestAsyncAPIBridge(unittest.TestCase):
    def setUp(self):
        self.bridge = ProtocolBridge()

    def test_export_returns_asyncapi_spec(self):
        result = self.bridge.export_workflow(_workflow(), "asyncapi")
        self.assertEqual(result.format, "asyncapi")
        spec = result.spec
        self.assertEqual(spec["asyncapi"], "2.0.0")
        self.assertIn("wf-dev/implement", spec["channels"])
        self.assertIn("publish", spec["channels"]["wf-dev/implement"])
        self.assertIn("subscribe", spec["channels"]["wf-dev/implement"])

    def test_import_returns_workflow(self):
        spec = {
            "asyncapi": "2.0.0",
            "info": {"title": "Test", "version": "1.0.0"},
            "channels": {
                "orders/created": {
                    "publish": {"message": {"name": "OrderCreated"}},
                    "subscribe": {"message": {"name": "OrderAck"}},
                }
            },
        }
        result = self.bridge.import_spec(spec, "asyncapi")
        self.assertEqual(result.format, "asyncapi")
        self.assertEqual(len(result.workflow["steps"]), 1)
        self.assertEqual(result.workflow["steps"][0]["id"], "OrderCreated")


if __name__ == "__main__":
    unittest.main()
