import * as fs from 'fs';
import * as path from 'path';
import { AlpParser, AlpObject, SwarmClient, SwarmConfig } from '@alp/parser';

/**
 * `alp swarm` — V4 Pillar 1: Remote & Networked Swarms.
 *
 * Manages a node's membership in a networked swarm coordinated by an
 * `alp serve` instance. A node joins (registers + heartbeats), can list the
 * roster, and leaves on shutdown. `alp run --swarm <id>` runs the ordinary
 * execution loop but negotiates claims through the coordinator.
 */

interface SwarmOptions {
  coordinator?: string;
  token?: string;
  node?: string;
}

function resolveSwarm(alpDir: string, idOrUndefined: string | undefined, opts: SwarmOptions): { id: string; config: SwarmConfig } {
  const parser = new AlpParser();
  const objects: AlpObject[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.runtime' || entry.name === '.cache') continue;
        walk(full);
      } else if (entry.name.endsWith('.alp')) {
        try { objects.push(...parser.parse(fs.readFileSync(full, 'utf-8'))); } catch {}
      }
    }
  };
  walk(alpDir);

  const swarms = objects.filter((o) => o._type === 'swarm');
  if (swarms.length === 0) {
    console.error('Error: no @swarm object found in this workspace.');
    process.exit(1);
  }
  const target = idOrUndefined
    ? swarms.find((s) => s.id === idOrUndefined)
    : swarms[0];
  if (!target) {
    console.error(`Error: swarm "${idOrUndefined}" not found.`);
    process.exit(1);
  }

  const coordinator = opts.coordinator || (target as any).coordinator || 'http://127.0.0.1:4000';
  const token = opts.token || resolveToken((target as any).token);
  const rawHb = (target as any).heartbeat_seconds;
  const rawPull = (target as any).pull_state;
  const config: SwarmConfig = {
    id: target.id,
    coordinator,
    token,
    node_id: opts.node || (target as any).node_id,
    heartbeat_seconds: rawHb === undefined ? undefined : Number(rawHb),
    pull_state: rawPull === undefined ? undefined : (rawPull === true || rawPull === 'true'),
    peers: (target as any).peers,
  };
  return { id: target.id, config };
}

function resolveToken(raw?: string): string | undefined {
  if (!raw) return undefined;
  const m = /\$\{([^}]+)\}/.exec(raw);
  if (m) return process.env[m[1]];
  return raw;
}

export function swarmCommand(sub: string | undefined, swarmId: string | undefined, options?: SwarmOptions) {
  const alpDir = path.resolve(process.cwd(), '.alp');
  if (!fs.existsSync(alpDir)) {
    console.error('Error: .alp directory not found. Run `alp init` first.');
    process.exit(1);
  }

  const subcmd = sub || 'roster';
  const { id, config } = resolveSwarm(alpDir, swarmId, options || {});
  const client = new SwarmClient(config);

  switch (subcmd) {
    case 'join': {
      client.join()
        .then((node) => {
          console.log(`🐝 Joined swarm "${id}" as node "${node.node_id}".`);
          const stop = client.startHeartbeat();
          console.log('💓 Heartbeat started. Press Ctrl+C to leave.');
          const leave = () => { stop(); client.leave().finally(() => process.exit(0)); };
          process.on('SIGINT', leave);
          process.on('SIGTERM', leave);
        })
        .catch((e) => { console.error('Join failed:', e.message); process.exit(1); });
      return;
    }
    case 'leave': {
      client.leave()
        .then(() => console.log(`👋 Left swarm "${id}".`))
        .catch((e) => { console.error('Leave failed:', e.message); process.exit(1); });
      return;
    }
    case 'roster':
    case 'ls': {
      client.roster()
        .then((nodes) => {
          if (nodes.length === 0) { console.log(`Swarm "${id}" has no active nodes.`); return; }
          console.log(`Swarm "${id}" — ${nodes.length} node(s):`);
          for (const n of nodes) console.log(`  • ${n.node_id}  claim=${n.claim ?? '—'}  last_seen=${n.last_seen}`);
        })
        .catch((e) => { console.error('Roster failed:', e.message); process.exit(1); });
      return;
    }
    default:
      console.error(`Unknown swarm subcommand: ${subcmd}. Use join | leave | roster.`);
      process.exit(1);
  }
}
