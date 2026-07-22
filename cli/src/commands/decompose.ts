import { Command } from 'commander';
import { ArchDecomposerEngine } from '@alp/parser';

export function registerDecomposeCommand(program: Command) {
  const decompose = program
    .command('decompose')
    .description('AI-assisted monolith decomposition & architecture refactoring (v28.0.0)');

  decompose
    .command('analyze')
    .description('Analyze monolith files and calculate coupling score')
    .argument('<targetPath>', 'Monolith codebase path')
    .action((targetPath) => {
      const engine = new ArchDecomposerEngine();
      const mockFiles = [
        'src/auth/login.ts',
        'src/auth/oauth.ts',
        'src/billing/stripe.ts',
        'src/notify/email.ts',
        'src/core/app.ts',
      ];

      const analysis = engine.analyzeMonolith(targetPath, mockFiles);

      console.log('\n🏗️ Monolith Architecture Analysis (v28.0.0)');
      console.log('==========================================');
      console.log(`  Target Path:    ${analysis.targetPath}`);
      console.log(`  Total Files:    ${analysis.totalFiles}`);
      console.log(`  Coupling Score: ${(analysis.couplingScore * 100).toFixed(0)}%`);
      console.log(`  Modules:        ${Object.keys(analysis.modules).join(', ')}\n`);
    });

  decompose
    .command('generate')
    .description('Generate microservice boundaries and ALP package refactoring plan')
    .argument('<targetPath>', 'Monolith codebase path')
    .action((targetPath) => {
      const engine = new ArchDecomposerEngine();
      const mockFiles = [
        'src/auth/login.ts',
        'src/billing/stripe.ts',
        'src/notify/email.ts',
      ];

      const analysis = engine.analyzeMonolith(targetPath, mockFiles);
      const plan = engine.decompose(analysis);

      console.log('\n🧩 Microservice Decomposition Plan (v28.0.0)');
      console.log('==========================================');
      console.log(`  Refactor ID: ${plan.id}`);
      console.log(`  Services:    ${plan.proposedServices.join(', ')}`);
      console.log(`\n  Service Boundaries:`);
      Object.entries(plan.serviceBoundaries).forEach(([svc, files]) => {
        console.log(`    - ${svc}: [${files.join(', ')}]`);
      });
      console.log('');
    });
}
