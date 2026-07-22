import unittest
from alp_sdk.sandbox_env import SandboxEnvEngine

class TestSandboxEnv(unittest.TestCase):
    def test_create_and_execute_sandbox(self):
        engine = SandboxEnvEngine()
        sb = engine.create_sandbox("sb-py-1", "wasm", 256)
        self.assertEqual(sb.id, "sb-py-1")
        self.assertEqual(sb.memory_mb, 256)

        res = engine.execute_in_sandbox("sb-py-1", "npm test")
        self.assertEqual(res.exit_code, 0)
        self.assertTrue(res.isolated)
        self.assertTrue(engine.verify_sandbox_isolation(res))

    def test_sandbox_permission_denied(self):
        engine = SandboxEnvEngine()
        engine.create_sandbox("sb-py-2")
        res = engine.execute_in_sandbox("sb-py-2", "rm -rf /")
        self.assertEqual(res.exit_code, 126)
        self.assertIn("Permission Denied", res.stderr)

if __name__ == "__main__":
    unittest.main()
