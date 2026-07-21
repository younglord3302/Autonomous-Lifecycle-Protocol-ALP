import fs from 'fs';
import path from 'path';
import { EventStore, EventType, ReplayOptions } from '@alp/parser';

export function replayCommand(opts: {
  from?: string;
  to?: string;
  type?: string;
  objectId?: string;
  tail?: boolean;
}) {
  const alpDir = path.join(process.cwd(), '.alp');
  if (!fs.existsSync(alpDir)) {
    console.error('Error: .alp directory not found. Run `alp init` first.');
    process.exit(1);
  }

  const store = new EventStore(alpDir);
  const allEvents = store.readAll();

  if (allEvents.length === 0) {
    console.log('📭 No events recorded yet. Events are emitted as the workspace mutates.');
    return;
  }

  const filterTypes: EventType[] | undefined = opts.type
    ? (opts.type.split(',').map((t) => t.trim()) as EventType[])
    : undefined;

  const replayOpts: ReplayOptions = {
    from: opts.from,
    to: opts.to,
    types: filterTypes,
    objectId: opts.objectId,
  };

  const result = store.replay(replayOpts);

  console.log(`\n📼 ALP Event Replay`);
  console.log(`===================`);
  console.log(`Total events:    ${allEvents.length}`);
  console.log(`Replayed:        ${result.applied}`);
  console.log(`Skipped:         ${result.skipped}`);
  if (opts.from || opts.to || opts.type || opts.objectId) {
    console.log(`Filters:         ${[opts.type, opts.objectId, opts.from && `from=${opts.from}`, opts.to && `to=${opts.to}`].filter(Boolean).join(', ') || 'none'}`);
  }
  console.log('');

  for (const event of result.events) {
    const time = new Date(event.timestamp).toLocaleString();
    const payload = Object.entries(event.payload)
      .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(', ');
    console.log(`[${time}] ${event.type}(${event.id.slice(0, 8)}) ${payload}`);
  }
  console.log('');
}
