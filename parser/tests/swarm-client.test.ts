import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'node:http';
import { SwarmClient } from '../src/index';

/**
 * Tests for the networked swarm client (v4 Pillar 1). Spins up a minimal
 * in-process coordinator implementing the /api/swarm/* contract and asserts
 * join / claim / roster / release / leave behaviour.
 */
describe('SwarmClient (Pillar 1)', () => {
  let server: http.Server | null = null;
  let baseUrl = '';

  afterEach(() => {
    if (server) server.close();
    server = null;
  });

  function startCoordinator() {
    const swarms = new Map<string, Map<string, any>>();
    const claims = new Map<string, Map<string, any>>();
    const app = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const b = body ? JSON.parse(body) : {};
        const u = new URL(req.url || '', 'http://x');
        const send = (code: number, obj: any) => {
          res.writeHead(code, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(obj));
        };
        if (u.pathname === '/api/swarm/join' && req.method === 'POST') {
          const sid = b.swarm_id, nid = b.node_id;
          const nodes = swarms.get(sid) || new Map();
          const now = new Date().toISOString();
          nodes.set(nid, { node_id: nid, last_seen: now, claim: null });
          swarms.set(sid, nodes);
          return send(200, { node_id: nid, last_seen: now, claim: null });
        }
        if (u.pathname === '/api/swarm/claim' && req.method === 'POST') {
          const sid = b.swarm_id, tid = b.task_id, nid = b.node_id;
          const c = claims.get(sid) || new Map();
          if (c.has(tid)) return send(409, { error: 'already claimed', by: c.get(tid).node_id });
          const claim = { task_id: tid, node_id: nid, agent: b.agent };
          c.set(tid, claim); claims.set(sid, c);
          return send(200, claim);
        }
        if (u.pathname === '/api/swarm/release' && req.method === 'POST') {
          claims.get(b.swarm_id)?.delete(b.task_id);
          return send(200, { ok: true });
        }
        if (u.pathname === '/api/swarm/roster') {
          const sid = u.searchParams.get('swarm_id') || '';
          return send(200, [...(swarms.get(sid)?.values() || [])]);
        }
        if (u.pathname === '/api/swarm/leave' && req.method === 'POST') {
          swarms.get(b.swarm_id)?.delete(b.node_id);
          return send(200, { ok: true });
        }
        send(404, { error: 'unknown' });
      });
    });
    return new Promise<string>((resolve) => {
      app.listen(0, '127.0.0.1', () => {
        const addr = app.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        server = app;
        resolve(baseUrl);
      });
    });
  }

  it('joins, claims a task, lists roster, releases and leaves', async () => {
    await startCoordinator();
    const client = new SwarmClient({ id: 'swarm-1', coordinator: baseUrl });
    const node = await client.join();
    expect(node.node_id).toBe(client.nodeId);

    const claim = await client.claim('task-auth', 'agent-1');
    expect(claim?.task_id).toBe('task-auth');
    expect(claim?.node_id).toBe(client.nodeId);

    // A second claim of the same task by another node should be denied.
    const other = new SwarmClient({ id: 'swarm-1', coordinator: baseUrl, node_id: 'other-node' });
    await other.join();
    const denied = await other.claim('task-auth', 'agent-2');
    expect(denied).toBeNull();

    const roster = await client.roster();
    expect(roster.length).toBe(2);

    await client.release('task-auth');
    const reclaimed = await other.claim('task-auth', 'agent-2');
    expect(reclaimed?.node_id).toBe('other-node');

    await client.leave();
    await other.leave();
  });
});
