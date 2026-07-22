import { describe, it, expect } from 'vitest';
import { EdgeModelEngine } from '../src/edge-model';

describe('EdgeModelEngine (v29.0.0)', () => {
  it('binds local GGUF model and verifies availability', () => {
    const engine = new EdgeModelEngine();
    const config = engine.bindLocalModel('edge-llama', 'Llama-3.2-3B', 'models/llama3.gguf', 'Q4_K_M');

    expect(config.id).toBe('edge-llama');
    expect(config.modelName).toBe('Llama-3.2-3B');
    expect(config.isBound).toBe(true);
    expect(engine.verifyLocalModelAvailability(config)).toBe(true);
  });

  it('executes offline inference with tok/sec metrics', () => {
    const engine = new EdgeModelEngine();
    engine.bindLocalModel('edge-local', 'Phi-3-Mini', 'models/phi3.gguf');

    const result = engine.executeOfflineInference('edge-local', 'Write hello world function');
    expect(result.offline).toBe(true);
    expect(result.tokensGenerated).toBeGreaterThan(0);
    expect(result.tokPerSec).toBeGreaterThan(0);
  });

  it('handles unbound model gracefully', () => {
    const engine = new EdgeModelEngine();
    const result = engine.executeOfflineInference('missing-model', 'test');
    expect(result.tokensGenerated).toBe(0);
    expect(result.completion).toContain('not bound');
  });
});
