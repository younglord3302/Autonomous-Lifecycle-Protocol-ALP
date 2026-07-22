import { Command } from 'commander';
import { EdgeModelEngine } from '@alp/parser';

export function registerEdgeCommand(program: Command) {
  const edge = program
    .command('edge')
    .description('Offline edge & on-device GGUF model execution (v29.0.0)');

  edge
    .command('bind')
    .description('Bind a local GGUF model binary for offline zero-latency inference')
    .argument('<id>', 'Model ID')
    .argument('<modelName>', 'Model name (e.g. Llama-3.2-3B)')
    .argument('<ggufPath>', 'File path to .gguf weights')
    .option('--quant <q>', 'Quantization type', 'Q4_K_M')
    .action((id, modelName, ggufPath, options) => {
      const engine = new EdgeModelEngine();
      const config = engine.bindLocalModel(id, modelName, ggufPath, options.quant);

      console.log('\n💻 Offline Edge GGUF Model Bound (v29.0.0)');
      console.log('==========================================');
      console.log(`  Model ID:     ${config.id}`);
      console.log(`  Model Name:   ${config.modelName}`);
      console.log(`  GGUF File:    ${config.ggufPath}`);
      console.log(`  Quantization: ${config.quantization}`);
      console.log(`  Offline Mode: 🔒 ZERO-CLOUD RELIANCE\n`);
    });

  edge
    .command('run')
    .description('Execute offline inference using bound local GGUF model')
    .argument('<modelId>', 'Model ID')
    .argument('<prompt>', 'Inference prompt')
    .action((modelId, prompt) => {
      const engine = new EdgeModelEngine();
      engine.bindLocalModel(modelId, 'Llama-3.2-3B', 'models/llama-3.2-3b-q4.gguf');

      const result = engine.executeOfflineInference(modelId, prompt);

      console.log('\n⚡ Edge Local Inference Result (v29.0.0)');
      console.log('=======================================');
      console.log(`  Model ID:    ${result.modelId}`);
      console.log(`  Tokens/Sec:  ${result.tokPerSec} tok/s`);
      console.log(`  Offline:     ${result.offline ? '✅ YES' : '❌ NO'}`);
      console.log(`\n  Output:\n  ${result.completion}\n`);
    });
}
