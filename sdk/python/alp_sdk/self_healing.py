import re
from typing import List, Optional

class ASTDiagnosis:
    def __init__(self, line: int, message: str, severity: str = "error", node_type: Optional[str] = None):
        self.line = line
        self.message = message
        self.severity = severity
        self.node_type = node_type

class HealPatch:
    def __init__(self, patch_id: str, target_file: str, diagnosis: ASTDiagnosis,
                 original_line: str, patched_line: str, applied: bool):
        self.id = patch_id
        self.target_file = target_file
        self.diagnosis = diagnosis
        self.original_line = original_line
        self.patched_line = patched_line
        self.applied = applied

class SelfHealingEngine:
    def diagnose(self, content: str) -> List[ASTDiagnosis]:
        lines = content.split("\n")
        diagnostics: List[ASTDiagnosis] = []

        for idx, line in enumerate(lines):
            line_num = idx + 1
            trimmed = line.strip()

            if trimmed.startswith("@") and "!" not in trimmed and "#" not in trimmed:
                obj_type = trimmed.lstrip("@")
                next_block = "\n".join(lines[idx + 1: idx + 5])
                if "id:" not in next_block:
                    diagnostics.append(ASTDiagnosis(
                        line=line_num,
                        message=f"@{obj_type} declaration missing required 'id' field",
                        severity="error",
                        node_type=obj_type,
                    ))

            if re.match(r"^\t+ ", line):
                diagnostics.append(ASTDiagnosis(
                    line=line_num,
                    message="Mixed tabs and spaces indentation detected",
                    severity="warning",
                ))

            if re.match(r"^\s*status:\s*$", trimmed):
                diagnostics.append(ASTDiagnosis(
                    line=line_num,
                    message="Empty status field — use [ ], [x], [~], [!], or [?]",
                    severity="error",
                ))

        return diagnostics

    def generate_patches(self, content: str, target_file: str = "spec.alp") -> List[HealPatch]:
        diagnostics = self.diagnose(content)
        lines = content.split("\n")
        patches: List[HealPatch] = []

        for idx, diag in enumerate(diagnostics):
            line_idx = diag.line - 1
            original = lines[line_idx] if line_idx < len(lines) else ""
            patched = original

            if "Empty status field" in diag.message:
                patched = re.sub(r"status:\s*$", "status: [ ]", original)
            elif "Mixed tabs and spaces" in diag.message:
                patched = original.replace("\t", "  ")

            patches.append(HealPatch(
                patch_id=f"patch-{idx + 1}",
                target_file=target_file,
                diagnosis=diag,
                original_line=original,
                patched_line=patched,
                applied=patched != original,
            ))

        return patches

    def apply_patches(self, content: str, patches: List[HealPatch]) -> str:
        lines = content.split("\n")
        for patch in patches:
            if patch.applied:
                line_idx = patch.diagnosis.line - 1
                if 0 <= line_idx < len(lines):
                    lines[line_idx] = patch.patched_line
        return "\n".join(lines)
