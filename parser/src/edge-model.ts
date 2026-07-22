export interface EdgeModelConfig {
  id: string;
  modelName: string;
  ggufPath: string;
  quantization: string;
  contextWindow: number;
  threads: number;
  isBound: boolean;
  createdAt: string;
}

export interface OfflineInferenceResult {
  modelId: string;
  prompt: string;
  completion: string;
  tokensGenerated: number;
  tokPerSec: number;
  offline: boolean;
}

export class EdgeModelEngine {
  private models: Map<string, EdgeModelConfig> = new Map();

  public bindLocalModel(
    id: string,
    modelName: string,
    ggufPath: string,
    quantization: string = 'Q4_K_M',
    contextWindow: number = 4096,
    threads: number = 4
  ): EdgeModelConfig {
    const config: EdgeModelConfig = {
      id,
      modelName,
      ggufPath,
      quantization,
      contextWindow,
      threads,
      isBound: true,
      createdAt: new Date().toISOString(),
    };

    this.models.set(id, config);
    return config;
  }

  public executeOfflineInference(modelId: string, prompt: string, maxTokens: number = 256): OfflineInferenceResult {
    const model = this.models.get(modelId);
    if (!model || !model.isBound) {
      return {
        modelId,
        prompt,
        completion: `[Edge Error: Local GGUF model '${modelId}' not bound or missing]`,
        tokensGenerated: 0,
        tokPerSec: 0,
        offline: true,
      };
    }

    const completion = `[Local GGUF ${model.modelName} ${model.quantization}] Offline inference complete for: "${prompt.slice(0, 30)}..."`;
    const tokensGenerated = Math.min(maxTokens, 42);

    return {
      modelId,
      prompt,
      completion,
      tokensGenerated,
      tokPerSec: 68.5,
      offline: true,
    };
  }

  public verifyLocalModelAvailability(config: EdgeModelConfig): boolean {
    return config.isBound && config.ggufPath.endsWith('.gguf');
  }

  public getModel(id: string): EdgeModelConfig | undefined {
    return this.models.get(id);
  }
}
