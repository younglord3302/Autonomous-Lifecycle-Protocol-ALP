export type TransformType = 'rename_symbol' | 'extract_function' | 'inline_variable' | 'add_log_guard' | 'migration_rewrite';
export type TransformStatus = 'pending' | 'applied' | 'reverted';

export interface CodeTransformResult {
  id: string;
  transformType: TransformType;
  targetFile: string;
  originalCode: string;
  transformedCode: string;
  diffPreview: string;
  status: TransformStatus;
  appliedAt?: string;
}

export interface CodeTransformConfig {
  id: string;
  transformType: TransformType;
  targetFile: string;
  targetSymbol?: string;
  newSymbol?: string;
  diffPreview?: string;
  status?: TransformStatus;
  description?: string;
}

export class CodeTransformEngine {
  private transforms: Map<string, CodeTransformResult> = new Map();

  public applyTransform(
    id: string,
    transformType: TransformType,
    targetFile: string,
    sourceCode: string,
    targetSymbol?: string,
    newSymbol?: string
  ): CodeTransformResult {
    let transformedCode = sourceCode;

    switch (transformType) {
      case 'rename_symbol':
        if (targetSymbol && newSymbol) {
          const regex = new RegExp(`\\b${targetSymbol}\\b`, 'g');
          transformedCode = sourceCode.replace(regex, newSymbol);
        }
        break;
      case 'add_log_guard':
        transformedCode = `// [ALP Guarded Execution]\ntry {\n${sourceCode.replace(/^/gm, '  ')}\n} catch (err) {\n  console.error("[ALP Guard] Execution error:", err);\n}`;
        break;
      case 'extract_function':
        const extractedName = newSymbol || 'extractedHelper';
        transformedCode = `function ${extractedName}() {\n  // Extracted logic block\n}\n\n${sourceCode}`;
        break;
      case 'inline_variable':
        if (targetSymbol && newSymbol) {
          const regex = new RegExp(`const\\s+${targetSymbol}\\s*=\\s*[^;]+;\\s*`, 'g');
          transformedCode = sourceCode.replace(regex, '');
          transformedCode = transformedCode.replace(new RegExp(`\\b${targetSymbol}\\b`, 'g'), newSymbol);
        }
        break;
      case 'migration_rewrite':
        transformedCode = sourceCode.replace(/var\s+/g, 'let ');
        break;
    }

    const diffPreview = `--- ${targetFile}\n+++ ${targetFile} (transformed)\n@@ -1,${sourceCode.split('\n').length} +1,${transformedCode.split('\n').length} @@\n${transformedCode.slice(0, 150)}...`;

    const result: CodeTransformResult = {
      id,
      transformType,
      targetFile,
      originalCode: sourceCode,
      transformedCode,
      diffPreview,
      status: 'applied',
      appliedAt: new Date().toISOString(),
    };

    this.transforms.set(id, result);
    return result;
  }

  public revertTransform(id: string): CodeTransformResult | undefined {
    const transform = this.transforms.get(id);
    if (!transform) return undefined;

    transform.status = 'reverted';
    transform.transformedCode = transform.originalCode;
    return transform;
  }

  public getTransform(id: string): CodeTransformResult | undefined {
    return this.transforms.get(id);
  }
}
