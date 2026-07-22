import unittest
from alp_sdk.code_transform import (
    CodeTransformEngine,
    CodeTransformConfig,
    CodeTransformResult,
)

class TestCodeTransformConfig(unittest.TestCase):
    def test_default_values(self):
        config = CodeTransformConfig("t1", "rename_symbol", "app.py")
        self.assertEqual(config.id, "t1")
        self.assertEqual(config.transform_type, "rename_symbol")
        self.assertEqual(config.target_file, "app.py")
        self.assertEqual(config.status, "pending")

class TestCodeTransformEngine(unittest.TestCase):
    def test_rename_symbol_transform(self):
        engine = CodeTransformEngine()
        source = "def old_fn(): return 42"
        result = engine.apply_transform(
            transform_id="t1",
            transform_type="rename_symbol",
            target_file="math.py",
            source_code=source,
            target_symbol="old_fn",
            new_symbol="new_fn",
        )

        self.assertIsInstance(result, CodeTransformResult)
        self.assertEqual(result.id, "t1")
        self.assertIn("new_fn", result.transformed_code)
        self.assertNotIn("old_fn", result.transformed_code)
        self.assertEqual(result.status, "applied")

    def test_migration_rewrite_transform(self):
        engine = CodeTransformEngine()
        source = "var x = 10;\nvar y = 20;"
        result = engine.apply_transform(
            transform_id="t2",
            transform_type="migration_rewrite",
            target_file="legacy.js",
            source_code=source,
        )
        self.assertIn("let x = 10;", result.transformed_code)
        self.assertNotIn("var ", result.transformed_code)

    def test_revert_transform(self):
        engine = CodeTransformEngine()
        source = "var item = 1;"
        engine.apply_transform("t3", "migration_rewrite", "test.js", source)
        reverted = engine.revert_transform("t3")
        self.assertIsNotNone(reverted)
        self.assertEqual(reverted.status, "reverted")
        self.assertEqual(reverted.transformed_code, source)
