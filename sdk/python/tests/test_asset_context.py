import unittest
from alp_sdk.asset_context import AssetContextEngine

class TestAssetContext(unittest.TestCase):
    def test_bundle_and_verify_asset(self):
        engine = AssetContextEngine()
        bundle = engine.bundle_asset("ui-wireframe-1", "wireframe", "image/png", "wireframe-binary-content")

        self.assertEqual(bundle.id, "ui-wireframe-1")
        self.assertEqual(bundle.asset_type, "wireframe")
        self.assertTrue(len(bundle.digest) > 0)

        prompt = engine.encode_context_prompt(bundle)
        self.assertIn("[ALP Multi-Modal Asset Context: @ui-wireframe-1]", prompt)
        self.assertTrue(engine.verify_asset_integrity(bundle))

if __name__ == "__main__":
    unittest.main()
