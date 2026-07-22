import { Command } from 'commander';
import { EventMeshEngine, EventType } from '@alp/parser';

export function registerEventMeshCommand(program: Command) {
  const meshCmd = program
    .command('mesh')
    .description('Real-time agent collaboration & event mesh engine (v35.0.0)');

  meshCmd
    .command('publish')
    .description('Publish a workspace event to the agent event mesh')
    .argument('<id>', 'Event ID')
    .argument('<topic>', 'Mesh topic (e.g. tasks.updates, agent.broadcast)')
    .argument('<senderAgent>', 'Sender agent ID')
    .argument('<payload>', 'Event payload message')
    .option('--type <t>', 'Event type (state_change|task_update|agent_broadcast|alert)', 'agent_broadcast')
    .action((id, topic, senderAgent, payload, options) => {
      const engine = new EventMeshEngine();
      const event = engine.publish(id, topic, senderAgent, payload, options.type as EventType);

      console.log('\n📡 Event Published to Mesh (v35.0.0)');
      console.log('====================================');
      console.log(`  Event ID:     ${event.id}`);
      console.log(`  Topic:        ${event.topic}`);
      console.log(`  Sender Agent: ${event.senderAgent}`);
      console.log(`  Event Type:   ${event.eventType}`);
      console.log(`  Timestamp:    ${event.timestamp}`);
      console.log(`  Payload:      ${event.payload}\n`);
    });
}
