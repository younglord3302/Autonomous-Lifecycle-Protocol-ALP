import * as http from 'node:http';
import * as https from 'node:https';
import * as crypto from 'node:crypto';

/**
 * ALP Networked Swarm (v4 — The Federation Era, Pillar 1)
 *
 * Client for coordinating an ALP node with a swarm coordinator (an `alp serve`
 * instance exposing `/api/swarm`). Nodes register ("join"), report liveness
 * ("heartbeat"), negotiate task claims, and pull the merged graph. This lets
 * `alp run --swarm <id>` span machines, containers, and CI runners while still
 * respecting `@policy` and `@lock`.
 *
 * No third-party deps: uses Node's built-in http/https. Auth is a shared
 * bearer token (the swarm `token`); TLS is used automatically when the
 * coordinator URL is https.
 */

export interface SwarmNode {
  node_id: string;
  last_seen: string;
  claim?: string | null;
}

export interface SwarmClaim {
  task_id: string;
  node_id: string;
  agent: string;
}

export interface SwarmConfig {
  id: string;
  coordinator: string;
  token?: string;
  node_id?: string;
  heartbeat_seconds?: number;
  pull_state?: boolean;
  peers?: string[];
}

const UA = 'alp-swarm/4.0';

function request(
  method: string,
  url: string,
  token: string | undefined,
  body: unknown,
): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = lib.request(
      u,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': UA,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let json: any = null;
          if (raw) {
            try { json = JSON.parse(raw); } catch { json = { raw }; }
          }
          resolve({ status: res.statusCode || 0, json });
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('swarm request timeout')));
    if (data) req.write(data);
    req.end();
  });
}

export class SwarmClient {
  readonly config: SwarmConfig;
  readonly nodeId: string;

  constructor(config: SwarmConfig) {
    this.config = { heartbeat_seconds: 5, pull_state: true, ...config };
    this.nodeId = config.node_id || `node-${crypto.randomBytes(4).toString('hex')}`;
  }

  private endpoint(pathname: string): string {
    return `${this.config.coordinator.replace(/\/$/, '')}${pathname}`;
  }

  /** Register this node with the coordinator. */
  async join(): Promise<SwarmNode> {
    const r = await request('POST', this.endpoint('/api/swarm/join'), this.config.token, {
      swarm_id: this.config.id,
      node_id: this.nodeId,
    });
    if (r.status >= 400) throw new Error(`join failed (${r.status}): ${JSON.stringify(r.json)}`);
    return r.json;
  }

  /** Report liveness so the coordinator does not reap this node. */
  async heartbeat(claim?: string | null): Promise<void> {
    await request('POST', this.endpoint('/api/swarm/heartbeat'), this.config.token, {
      swarm_id: this.config.id,
      node_id: this.nodeId,
      claim: claim ?? null,
    });
  }

  /** Deregister this node. */
  async leave(): Promise<void> {
    await request('POST', this.endpoint('/api/swarm/leave'), this.config.token, {
      swarm_id: this.config.id,
      node_id: this.nodeId,
    });
  }

  /** Pull the merged roster of nodes. */
  async roster(): Promise<SwarmNode[]> {
    const r = await request(
      'GET',
      this.endpoint(`/api/swarm/roster?swarm_id=${encodeURIComponent(this.config.id)}`),
      this.config.token,
      undefined,
    );
    return Array.isArray(r.json) ? r.json : (r.json?.nodes ?? []);
  }

  /**
   * Attempt to claim a task on behalf of this node. Returns the granted claim
   * or null if another node already holds it.
   */
  async claim(taskId: string, agent: string): Promise<SwarmClaim | null> {
    const r = await request('POST', this.endpoint('/api/swarm/claim'), this.config.token, {
      swarm_id: this.config.id,
      node_id: this.nodeId,
      task_id: taskId,
      agent,
    });
    if (r.status === 200) return r.json as SwarmClaim;
    return null;
  }

  /** Release a previously claimed task. */
  async release(taskId: string): Promise<void> {
    await request('POST', this.endpoint('/api/swarm/release'), this.config.token, {
      swarm_id: this.config.id,
      node_id: this.nodeId,
      task_id: taskId,
    });
  }

  /** Start a heartbeat loop. Returns a stop() function. */
  startHeartbeat(getClaim?: () => string | null): () => void {
    const interval = (this.config.heartbeat_seconds || 5) * 1000;
    const timer = setInterval(() => {
      this.heartbeat(getClaim ? getClaim() : null).catch(() => {});
    }, interval);
    if (typeof timer.unref === 'function') timer.unref();
    return () => clearInterval(timer);
  }
}
