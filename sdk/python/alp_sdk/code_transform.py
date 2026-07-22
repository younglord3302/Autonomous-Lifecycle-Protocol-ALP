from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Dict, Any, Optional

class CodeTransformResult:
    __test__ = False

    def __init__(
        self,
        transform_id: str,
        transform_type: str,
        target_file: str,
        original_code: str,
        transformed_code: str,
        diff_preview: str,
        status: str = "applied",
        applied_at: Optional[str] = None,
    ):
        self.id = transform_id
        self.transform_type = transform_type
        self.target_file = target_file
        self.original_code = original_code
        self.transformed_code = transformed_code
        self.diff_preview = diff_preview
        self.status = status
        self.applied_at = applied_at or datetime.now(timezone.utc).isoformat()

class CodeTransformConfig:
    __test__ = False

    def __init__(
        self,
        transform_id: str,
        transform_type: str,
        target_file: str,
        target_symbol: Optional[str] = None,
        new_symbol: Optional[str] = None,
        diff_preview: Optional[str] = None,
        status: str = "pending",
        description: Optional[str] = None,
    ):
        self.id = transform_id
        self.transform_type = transform_type
        self.target_file = target_file
        self.target_symbol = target_symbol
        self.new_symbol = new_symbol
        self.diff_preview = diff_preview
        self.status = status
        self.description = description

class CodeTransformEngine:
    def __init__(self):
        self.transforms: Dict[str, CodeTransformResult] = {}

    def apply_transform(
        self,
        transform_id: str,
        transform_type: str,
        target_file: str,
        source_code: str,
        target_symbol: Optional[str] = None,
        new_symbol: Optional[str] = None,
    ) -> CodeTransformResult:
        transformed_code = source_code

        if transform_type == "rename_symbol" and target_symbol and new_symbol:
            pattern = rf"\b{re.escape(target_symbol)}\b"
            transformed_code = re.sub(pattern, new_symbol, source_code)
        elif transform_type == "add_log_guard":
            indented = "\n".join("  " + line for line in source_code.split("\n"))
            transformed_code = f"// [ALP Guarded Execution]\ntry {{\n{indented}\n}} catch (err) {{\n  console.error('[ALP Guard] Error:', err);\n}}"
        elif transform_type == "extract_function":
            func_name = new_symbol or "extracted_helper"
            transformed_code = f"def {func_name}():\n    pass # Extracted logic\n\n{source_code}"
        elif transform_type == "migration_rewrite":
            transformed_code = re.sub(r"var\s+", "let ", source_code)

        orig_lines = len(source_code.split("\n"))
        trans_lines = len(transformed_code.split("\n"))
        diff_preview = f"--- {target_file}\n+++ {target_file} (transformed)\n@@ -1,{orig_lines} +1,{trans_lines} @@\n{transformed_code[:150]}..."

        result = CodeTransformResult(
            transform_id=transform_id,
            transform_type=transform_type,
            target_file=target_file,
            original_code=source_code,
            transformed_code=transformed_code,
            diff_preview=diff_preview,
            status="applied",
        )

        self.transforms[transform_id] = result
        return result

    def revert_transform(self, transform_id: str) -> Optional[CodeTransformResult]:
        transform = self.transforms.get(transform_id)
        if not transform:
            return None
        transform.status = "reverted"
        transform.transformed_code = transform.original_code
        return transform

    def get_transform(self, transform_id: str) -> Optional[CodeTransformResult]:
        return self.transforms.get(transform_id)
