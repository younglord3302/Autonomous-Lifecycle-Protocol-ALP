import unittest
from alp_sdk.arch_decomposer import ArchDecomposerEngine

class TestArchDecomposer(unittest.TestCase):
    def test_analyze_and_decompose_monolith(self):
        engine = ArchDecomposerEngine()
        files = ["src/auth/login.py", "src/billing/stripe.py"]
        analysis = engine.analyze_monolith("py-monolith", files)

        self.assertEqual(analysis.target_path, "py-monolith")
        self.assertEqual(len(analysis.modules["auth"]), 1)

        plan = engine.decompose(analysis)
        self.assertIn("service-auth", plan.proposed_services)
        self.assertIn("service-billing", plan.proposed_services)

if __name__ == "__main__":
    unittest.main()
