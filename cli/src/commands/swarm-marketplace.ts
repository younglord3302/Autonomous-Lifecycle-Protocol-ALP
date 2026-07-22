import { Command } from 'commander';
import { SwarmMarketplaceEngine } from '@alp/parser';

export function registerSwarmMarketplaceCommand(program: Command) {
  const marketCmd = program
    .command('marketplace')
    .description('Autonomous swarm marketplace & skill registry (v36.0.0)');

  marketCmd
    .command('register')
    .description('Register an agent skill in the swarm marketplace')
    .argument('<id>', 'Skill listing ID')
    .argument('<providerAgent>', 'Provider agent ID')
    .argument('<skillName>', 'Skill name')
    .option('--category <c>', 'Skill category', 'general')
    .option('--cost <n>', 'Cost per invocation (USD)', '0.01')
    .action((id, providerAgent, skillName, options) => {
      const engine = new SwarmMarketplaceEngine();
      const listing = engine.registerSkill(id, providerAgent, skillName, options.category, parseFloat(options.cost));

      console.log('\n🏪 Skill Registered in Swarm Marketplace (v36.0.0)');
      console.log('================================================');
      console.log(`  Listing ID:      ${listing.id}`);
      console.log(`  Provider Agent:  ${listing.providerAgent}`);
      console.log(`  Skill Name:      ${listing.skillName}`);
      console.log(`  Category:        ${listing.category}`);
      console.log(`  Cost per Call:   $${listing.costPerCall}`);
      console.log(`  Rating:          ${listing.rating}/5.0\n`);
    });

  marketCmd
    .command('invoke')
    .description('Invoke a marketplace skill from another agent')
    .argument('<listingId>', 'Skill listing ID to invoke')
    .argument('<callerAgent>', 'Caller agent ID')
    .argument('<input>', 'Input payload for the skill')
    .action((listingId, callerAgent, input) => {
      const engine = new SwarmMarketplaceEngine();
      engine.registerSkill(listingId, 'demo-provider', 'code-review', 'analysis', 0.02);
      const result = engine.invokeSkill(listingId, callerAgent, input);

      if (!result) {
        console.log('❌ Skill listing not found.');
        return;
      }

      console.log('\n⚡ Skill Invocation Result (v36.0.0)');
      console.log('===================================');
      console.log(`  Listing ID:     ${result.listingId}`);
      console.log(`  Caller Agent:   ${result.callerAgent}`);
      console.log(`  Provider Agent: ${result.providerAgent}`);
      console.log(`  Skill Name:     ${result.skillName}`);
      console.log(`  Cost Charged:   $${result.costCharged}`);
      console.log(`  Latency:        ${result.latencyMs}ms`);
      console.log(`  Output:         ${result.output}\n`);
    });
}
