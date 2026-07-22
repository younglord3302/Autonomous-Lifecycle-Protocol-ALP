import unittest
from alp_sdk.self_healing import SelfHealingEngine

class TestSelfHealing(unittest.TestCase):
    def test_diagnose_empty_status(self):
        engine = SelfHealingEngine()
        content = "@task\n  id: t1\n  status: "
        diags = engine.diagnose(content)
        self.assertTrue(any("Empty status" in d.message for d in diags))

    def test_auto_patch_empty_status(self):
        engine = SelfHealingEngine()
        content = "@task\n  id: t1\n  status: "
        patches = engine.generate_patches(content)
        healed = engine.apply_patches(content, patches)
        self.assertIn("status: [ ]", healed)

if __name__ == "__main__":
    unittest.main()
