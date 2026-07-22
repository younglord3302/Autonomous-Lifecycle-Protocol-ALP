export interface ASTDiagnosis {
  line: number;
  column?: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
  nodeType?: string;
}

export interface HealPatch {
  id: string;
  targetFile: string;
  diagnosis: ASTDiagnosis;
  originalLine: string;
  patchedLine: string;
  applied: boolean;
}

export class SelfHealingEngine {
  /**
   * Diagnose common ALP specification errors by scanning raw content lines.
   */
  public diagnose(content: string): ASTDiagnosis[] {
    const lines = content.split('\n');
    const diagnostics: ASTDiagnosis[] = [];

    lines.forEach((line, idx) => {
      const lineNum = idx + 1;
      const trimmed = line.trim();

      // Missing id field on object declarations
      if (trimmed.startsWith('@') && !trimmed.includes('!') && !trimmed.includes('#')) {
        const objectType = trimmed.replace('@', '');
        const nextLines = lines.slice(idx + 1, idx + 5).join('\n');
        if (!nextLines.includes('id:')) {
          diagnostics.push({
            line: lineNum,
            message: `@${objectType} declaration missing required 'id' field`,
            severity: 'error',
            nodeType: objectType,
          });
        }
      }

      // Bad indentation (tabs mixed with spaces)
      if (line.match(/^\t+ /)) {
        diagnostics.push({
          line: lineNum,
          message: 'Mixed tabs and spaces indentation detected',
          severity: 'warning',
        });
      }

      // Empty status field
      if (trimmed.match(/^status:\s*$/)) {
        diagnostics.push({
          line: lineNum,
          message: 'Empty status field — use [ ], [x], [~], [!], or [?]',
          severity: 'error',
        });
      }
    });

    return diagnostics;
  }

  /**
   * Generate auto-heal patches for diagnosed issues.
   */
  public generatePatches(content: string, targetFile: string = 'spec.alp'): HealPatch[] {
    const diagnostics = this.diagnose(content);
    const lines = content.split('\n');
    const patches: HealPatch[] = [];

    diagnostics.forEach((diag, idx) => {
      const lineIdx = diag.line - 1;
      const originalLine = lines[lineIdx] || '';

      let patchedLine = originalLine;

      if (diag.message.includes('Empty status field')) {
        patchedLine = originalLine.replace(/status:\s*$/, 'status: [ ]');
      } else if (diag.message.includes('Mixed tabs and spaces')) {
        patchedLine = originalLine.replace(/\t/g, '  ');
      }

      patches.push({
        id: `patch-${idx + 1}`,
        targetFile,
        diagnosis: diag,
        originalLine,
        patchedLine,
        applied: patchedLine !== originalLine,
      });
    });

    return patches;
  }

  /**
   * Apply patches to content and return healed output.
   */
  public applyPatches(content: string, patches: HealPatch[]): string {
    const lines = content.split('\n');

    patches.forEach((patch) => {
      if (patch.applied) {
        const lineIdx = patch.diagnosis.line - 1;
        if (lineIdx >= 0 && lineIdx < lines.length) {
          lines[lineIdx] = patch.patchedLine;
        }
      }
    });

    return lines.join('\n');
  }
}
