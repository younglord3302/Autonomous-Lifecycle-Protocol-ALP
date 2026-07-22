import pytest
from alp_sdk.code_transform import (
    CodeTransformEngine,
    CodeTransformConfig,
    CodeTransformResult,
)

class TestCodeTransformConfig:
    def test_default_values(self):
        config = CodeTransformConfig("t1", "rename_symbol", "app.py")
        assert config.id == "t1"
        assert config.transform_type == "rename_symbol"
        assert config.target_file == "app.py"
        assert config.status == "pending"

class TestCodeTransformEngine:
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

        assert isinstance(result, CodeTransformResult)
        assert result.id == "t1"
        assert "new_fn" in result.transformed_code
        assert "old_fn" not in result.transformed_code
        assert result.status == "applied"

    def test_migration_rewrite_transform(self):
        engine = CodeTransformEngine()
        source = "var x = 10;\nvar y = 20;"
        result = engine.apply_transform(
            transform_id="t2",
            transform_type="migration_rewrite",
            target_file="legacy.js",
            source_code=source,
        )
        assert "let x = 10;" in result.transformed_code
        assert "var " not in result.transformed_code

    def test_revert_transform(self):
        engine = CodeTransformEngine()
        source = "var item = 1;"
        engine.apply_transform("t3", "migration_rewrite", "test.js", source)
        reverted = engine.revert_transform("t3")
        assert reverted is not None
        assert reverted.status == "reverted"
        assert reverted.transformed_code == source
