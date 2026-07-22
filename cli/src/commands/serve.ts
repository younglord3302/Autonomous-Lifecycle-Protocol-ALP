import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { AlpParser, AlpObject, StateStore, computeAnalytics } from '@alp/parser';
import { readEvents, runtimeLogPath } from '../runtime';
import { RegistryStore } from '../registry-store';
import { loadAlprc } from '../registry';

interface ServeOptions {
  port?: number;
  host?: string;
  db?: boolean;
  registry?: boolean;
  registryToken?: string;
  registrySignKey?: string;
}

interface SwarmNodeState {
  node_id: string;
  last_seen: string;
  claim: string | null;
}

/**
 * `alp serve` — Pillar 4 of V3: the Centralized State Server.
 *
 * Runs a local daemon that exposes the live state of the ALP swarm:
 *  - a REST/JSON API (`/api/state`, `/api/events`, `/api/graph`)
 *  - a Server-Sent Events stream (`/api/stream`) for real-time updates
 *  - a self-contained HTML dashboard at `/`
 *
 * It tails `.alp/.runtime/log.jsonl` (written by the swarm via `runtime.ts`)
 * and pushes new events to connected dashboards with zero external
 * dependencies (built on Node's `http` module).
 */
export function serveCommand(options?: ServeOptions) {
  const cwd = process.cwd();
  const alpDir = path.resolve(cwd, '.alp');
  if (!fs.existsSync(alpDir)) {
    console.error('Error: .alp directory not found. Run `alp init` first.');
    process.exit(1);
  }

  const port = options?.port || 4000;
  const host = options?.host || '127.0.0.1';

  // Optional persistent state store (Pillar 5). When enabled, ingested events
  // are durably stored and analytics survive restarts.
  const store = options?.db ? new StateStore(alpDir) : null;
  if (store) {
    // Seed the store with any history already in the log.
    const added = store.ingest(readEvents(alpDir) as any);
    store.save();
    console.log(`💾 State store enabled (${store.size} events, +${added} new).`);
  }

  // ─── Hosted registry (Pillar 3) ────────────────────────────────────
  // Trust roots (spec/14 §4.3) enforce publisher signatures on upload when a
  // namespace is configured with one in .alprc `trustedKeys`.
  const registryTrust = loadAlprc(cwd).trustedKeys;
  const registryStore = options?.registry ? new RegistryStore(cwd, registryTrust) : null;
  // Per-namespace bearer tokens (registry hardening, spec/14 §4.2). A single
  // token (global) gates every namespace; a `ns:token,ns2:token2` map gates
  // each namespace independently. Publish requires the namespace token; reads
  // require it only when that namespace is configured with one (private).
  const registryTokens = parseRegistryTokens(
    options?.registryToken || process.env.ALP_REGISTRY_TOKENS || '',
    process.env.ALP_REGISTRY_TOKEN || '',
  );
  // Optional host signing key (PEM Ed25519) to sign published versions (v4.1
  // registry trust). Sourced from --registry-sign-key or ALP_REGISTRY_SIGN_KEY.
  let registrySigner: string | undefined;
  const signKeyPath = options?.registrySignKey || process.env.ALP_REGISTRY_SIGN_KEY;
  if (signKeyPath && fs.existsSync(signKeyPath)) {
    try { registrySigner = fs.readFileSync(signKeyPath, 'utf-8'); } catch { /* ignore */ }
  } else if (signKeyPath && signKeyPath.includes('-----BEGIN')) {
    registrySigner = signKeyPath;
  }
  if (registryStore) {
    const protectedNs = Object.keys(registryTokens).filter((k) => k !== '*').length;
    const note = protectedNs ? ` (${protectedNs} private namespace(s))` : (registryTokens['*'] ? ' (token-protected)' : '');
    console.log(`📦 Registry enabled at /.alp/registry${note}`);
  }

  // ─── Networked swarm registry (Pillar 1) ────────────────────────────
  // In-memory coordinator state: nodes per swarm and remote task claims.
  const swarms = new Map<string, Map<string, SwarmNodeState>>();
  const swarmClaims = new Map<string, Map<string, { task_id: string; node_id: string; agent: string }>>();
  const SWARM_TIMEOUT_MS = 15000;

  function reapSwarms() {
    const now = Date.now();
    for (const [sid, nodes] of swarms) {
      for (const [nid, n] of nodes) {
        if (now - Date.parse(n.last_seen) > SWARM_TIMEOUT_MS) {
          nodes.delete(nid);
          if (swarmClaims.has(sid)) {
            for (const [tid, c] of swarmClaims.get(sid)!) {
              if (c.node_id === nid) swarmClaims.get(sid)!.delete(tid);
            }
          }
        }
      }
    }
  }
  const swarmTimer = setInterval(reapSwarms, 5000);

  // Live SSE clients.
  const clients = new Set<http.ServerResponse>();

  // ─── Tail the runtime log ─────────────────────────────────────────────
  let lastSize = 0;
  const logPath = runtimeLogPath(alpDir);

  function pumpNewEvents() {
    try {
      if (!fs.existsSync(logPath)) return;
      const { size } = fs.statSync(logPath);
      if (size <= lastSize) {
        lastSize = size; // handle truncation/rotation
        return;
      }
      const fd = fs.openSync(logPath, 'r');
      const buf = Buffer.alloc(size - lastSize);
      fs.readSync(fd, buf, 0, buf.length, lastSize);
      fs.closeSync(fd);
      lastSize = size;
      const chunk = buf.toString('utf-8');
      const ingested: any[] = [];
      for (const line of chunk.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        broadcast(trimmed);
        if (store) {
          try {
            ingested.push(JSON.parse(trimmed));
          } catch {
            /* skip malformed */
          }
        }
      }
      if (store && ingested.length) {
        store.ingest(ingested);
        store.save();
      }
    } catch {
      /* best-effort tail */
    }
  }

  function broadcast(rawJson: string) {
    for (const res of clients) {
      res.write(`data: ${rawJson}\n\n`);
    }
  }

  // Initialize lastSize to current size so we stream only *new* events,
  // while the API still serves the full history on demand.
  if (fs.existsSync(logPath)) {
    lastSize = fs.statSync(logPath).size;
  }
  const pollTimer = setInterval(pumpNewEvents, 500);

  // ─── Build a snapshot of workspace state ──────────────────────────────
  function buildState() {
    const parser = new AlpParser();
    const objects: AlpObject[] = [];
    loadAll(alpDir, parser, objects);

    const tasks = objects.filter((o) => o._type === 'task');
    const statusCount: Record<string, number> = {};
    for (const t of tasks) {
      const s = String(t.status ?? '[ ]');
      statusCount[s] = (statusCount[s] || 0) + 1;
    }
    const agents = objects.filter((o) => o._type === 'agent').map((a) => a.id);
    const events = readEvents(alpDir);
    const activeLocks = readLocks(cwd);

    return {
      project: objects.find((o) => o._type === 'project')?.id ?? null,
      totalTasks: tasks.length,
      statusCount,
      agents,
      activeLocks,
      recentEvents: events.slice(-50),
      tasks: tasks.map((t) => ({
        id: t.id,
        status: t.status ?? '[ ]',
        owner: (t as any).owner ?? null,
      })),
    };
  }

  function buildGraph() {
    const parser = new AlpParser();
    const objects: AlpObject[] = [];
    loadAll(alpDir, parser, objects);
    const nodes = objects
      .filter((o) => o._type === 'task')
      .map((t) => ({ id: t.id, status: t.status ?? '[ ]' }));
    const edges: { from: string; to: string }[] = [];
    for (const t of objects.filter((o) => o._type === 'task')) {
      for (const dep of extractDeps(t)) {
        edges.push({ from: dep, to: t.id as string });
      }
    }
    return { nodes, edges };
  }

  // ─── HTTP server ──────────────────────────────────────────────────────
  const server = http.createServer((req, res) => {
    const url = req.url || '/';

    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(DASHBOARD_HTML);
      return;
    }

    if (url === '/api/state') {
      sendJson(res, buildState());
      return;
    }

    if (url === '/api/graph') {
      sendJson(res, buildGraph());
      return;
    }

    if (url === '/api/events') {
      sendJson(res, readEvents(alpDir));
      return;
    }

    if (url === '/api/analytics') {
      const events = store ? store.analytics() : computeAnalytics(readEvents(alpDir) as any);
      sendJson(res, events);
      return;
    }

    // ─── Networked swarm coordination (Pillar 1) ───────────────────────
    if (url.startsWith('/api/swarm')) {
      handleSwarm(req, res, url, swarms, swarmClaims, broadcast);
      return;
    }

    // ─── Hosted registry (Pillar 3) ──────────────────────────────────
    if (url.startsWith('/api/registry')) {
      handleRegistry(req, res, url, registryStore, registryTokens, req.method || 'GET', registrySigner);
      return;
    }


    if (url === '/api/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.listen(port, host, () => {
    console.log(`\n🛰️  ALP State Server running at http://${host}:${port}`);
    console.log(`   Dashboard:   http://${host}:${port}/`);
    console.log(`   Live stream: http://${host}:${port}/api/stream`);
    console.log(`   Analytics:   http://${host}:${port}/api/analytics${store ? '  (persistent)' : ''}`);
    console.log(`   Tailing:     ${path.relative(cwd, logPath)}`);
    console.log(`\nPress Ctrl+C to stop.\n`);
  });

  const shutdown = () => {
    clearInterval(pollTimer);
    clearInterval(swarmTimer);
    for (const res of clients) res.end();
    server.close(() => process.exit(0));
    // Force-exit if close hangs.
    setTimeout(() => process.exit(0), 500);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// ─── Helpers ────────────────────────────────────────────────────────────
function sendJson(res: http.ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { resolve({}); }
    });
  });
}

function handleSwarm(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  swarms: Map<string, Map<string, SwarmNodeState>>,
  swarmClaims: Map<string, Map<string, { task_id: string; node_id: string; agent: string }>>,
  broadcast: (raw: string) => void,
) {
  const ensureSwarm = (sid: string) => {
    let s = swarms.get(sid);
    if (!s) { s = new Map(); swarms.set(sid, s); }
    return s;
  };

  if (url.startsWith('/api/swarm/join') && req.method === 'POST') {
    readBody(req).then((b) => {
      const sid = String(b.swarm_id ?? '');
      const nid = String(b.node_id ?? '');
      if (!sid || !nid) return sendJson(res, { error: 'swarm_id and node_id required' }, 400);
      const nodes = ensureSwarm(sid);
      const now = new Date().toISOString();
      nodes.set(nid, { node_id: nid, last_seen: now, claim: nodes.get(nid)?.claim ?? null });
      broadcast(JSON.stringify({ timestamp: now, type: 'swarm_join', swarm_id: sid, node_id: nid, source: 'coordinator' }));
      sendJson(res, { node_id: nid, last_seen: now, claim: nodes.get(nid)!.claim });
    });
    return;
  }

  if (url.startsWith('/api/swarm/heartbeat') && req.method === 'POST') {
    readBody(req).then((b) => {
      const sid = String(b.swarm_id ?? '');
      const nid = String(b.node_id ?? '');
      const nodes = swarms.get(sid);
      if (!nodes || !nodes.has(nid)) return sendJson(res, { error: 'unknown node' }, 404);
      const now = new Date().toISOString();
      const node = nodes.get(nid)!;
      node.last_seen = now;
      if (b.claim !== undefined) node.claim = b.claim;
      sendJson(res, { ok: true, last_seen: now });
    });
    return;
  }

  if (url.startsWith('/api/swarm/leave') && req.method === 'POST') {
    readBody(req).then((b) => {
      const sid = String(b.swarm_id ?? '');
      const nid = String(b.node_id ?? '');
      swarms.get(sid)?.delete(nid);
      if (swarmClaims.has(sid)) {
        for (const [tid, c] of swarmClaims.get(sid)!) if (c.node_id === nid) swarmClaims.get(sid)!.delete(tid);
      }
      sendJson(res, { ok: true });
    });
    return;
  }

  if (url.startsWith('/api/swarm/claim') && req.method === 'POST') {
    readBody(req).then((b) => {
      const sid = String(b.swarm_id ?? '');
      const nid = String(b.node_id ?? '');
      const tid = String(b.task_id ?? '');
      const agent = String(b.agent ?? nid);
      const claims = swarmClaims.get(sid);
      if (claims && claims.has(tid)) {
        // Already claimed by someone (who may be dead). Reap first.
        const holder = claims.get(tid)!;
        const holderAlive = swarms.get(sid)?.has(holder.node_id);
        if (holderAlive) return sendJson(res, { error: 'already claimed', by: holder.node_id }, 409);
        claims.delete(tid);
      }
      ensureSwarm(sid);
      if (!swarmClaims.has(sid)) swarmClaims.set(sid, new Map());
      const claim = { task_id: tid, node_id: nid, agent };
      swarmClaims.get(sid)!.set(tid, claim);
      swarms.get(sid)!.get(nid)!.claim = tid;
      sendJson(res, claim);
    });
    return;
  }

  if (url.startsWith('/api/swarm/release') && req.method === 'POST') {
    readBody(req).then((b) => {
      const sid = String(b.swarm_id ?? '');
      const tid = String(b.task_id ?? '');
      swarmClaims.get(sid)?.delete(tid);
      sendJson(res, { ok: true });
    });
    return;
  }

  if (url.startsWith('/api/swarm/roster')) {
    const sid = new URL('http://x' + url).searchParams.get('swarm_id') ?? '';
    const nodes = [...(swarms.get(sid)?.values() ?? [])].map((n) => ({
      node_id: n.node_id,
      last_seen: n.last_seen,
      claim: n.claim,
    }));
    sendJson(res, nodes);
    return;
  }

  sendJson(res, { error: 'unknown swarm endpoint' }, 404);
}

/**
 * Parse registry token configuration. A single bare token (global) gates all
 * namespaces via the `*` key. A comma-separated `ns=token` map gates each
 * namespace independently (e.g. `@demo=secret,@other=key`). Returns a map of
 * namespace -> token ('' = public).
 */
function parseRegistryTokens(tokenArg: string, globalEnv: string): Record<string, string> {
  const out: Record<string, string> = {};
  // Explicit global token (no '=' or matches `ns=token` only when namespaced).
  if (globalEnv && !globalEnv.includes('=')) out['*'] = globalEnv;
  const raw = tokenArg || globalEnv;
  if (!raw) return out;
  // Single global token form: no namespace separator.
  if (!raw.includes('=') || !/^[^\s,=]+=[^\s,]/.test(raw)) {
    out['*'] = raw.trim();
    return out;
  }
  for (const part of raw.split(',')) {
    const idx = part.indexOf('=');
    const ns = part.slice(0, idx).trim();
    const tok = part.slice(idx + 1).trim();
    if (ns) out[ns] = tok;
  }
  return out;
}

/** Resolve the effective token required for a namespace ('' means public). */
function tokenForNamespace(tokens: Record<string, string>, ns: string): string {
  return tokens['@' + ns] || tokens[ns] || tokens['*'] || '';
}

/** §4.2: when the namespace is configured with a token, require Bearer auth. */
function authorize(req: http.IncomingMessage, tokens: Record<string, string>, ns: string): boolean {
  const required = tokenForNamespace(tokens, ns);
  if (!required) return true;
  const auth = req.headers['authorization'] || '';
  return auth === `Bearer ${required}`;
}

function handleRegistry(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  store: RegistryStore | null,
  tokens: Record<string, string>,
  method: string,
  signer?: string,
) {
  if (!store) { sendJson(res, { error: 'registry not enabled; start `alp serve --registry`' }, 404); return; }
  const u = new URL('http://x' + url);

  // Publish (registry hardening): PUT /api/registry/-/<ns>/<name> with a
  // multipart-free JSON body carrying the manifest + file contents, gated by
  // the namespace token. Read access stays public unless namespaced private.
  if (method === 'PUT' || method === 'POST') {
    const pub = /^\/api\/registry\/-\/([^/]+)\/([^/]+)$/.exec(url);
    if (pub) {
      const ns = decodeURIComponent(pub[1]);
      if (!authorize(req, tokens, ns)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
      readBody(req).then((body) => {
        try {
          const meta = store.publishFromRequest(body, ns, signer);
          sendJson(res, meta, 201);
        } catch (e: any) {
          sendJson(res, { error: e.message }, 400);
        }
      }).catch(() => sendJson(res, { error: 'bad request body' }, 400));
      return;
    }
  }

  // Marketplace listing + search. Global endpoint: gate it when a global
  // (`*`) token is configured; per-namespace tokens only affect reads of
  // that namespace's metadata/file endpoints above.
  if (url === '/api/registry' || url === '/api/registry/') {
    if (!authorize(req, tokens, '*')) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const q = u.searchParams.get('q');
    sendJson(res, q ? store.search(q) : store.list());
    return;
  }

  // Metadata: /api/registry/-/<ns>/<name>/meta.json
  const meta = /^\/api\/registry\/-\/([^/]+)\/([^/]+)\/meta\.json$/.exec(url);
  if (meta) {
    const ns = decodeURIComponent(meta[1]);
    if (!authorize(req, tokens, ns)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const full = `@${ns}/${decodeURIComponent(meta[2])}`;
    const m = store.getMeta(full);
    if (!m) return sendJson(res, { error: 'not found' }, 404);
    return sendJson(res, m);
  }

  // File download: /api/registry/-/<ns>/<name>/<version>/<file>
  const dl = /^\/api\/registry\/-\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/.exec(url);
  if (dl) {
    const ns = decodeURIComponent(dl[1]);
    if (!authorize(req, tokens, ns)) { sendJson(res, { error: 'unauthorized' }, 401); return; }
    const full = `@${ns}/${decodeURIComponent(dl[2])}`;
    const buf = store.readFile(full, decodeURIComponent(dl[3]), decodeURIComponent(dl[4]));
    if (!buf) return sendJson(res, { error: 'not found' }, 404);
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(buf);
    return;
  }

  sendJson(res, { error: 'unknown registry endpoint' }, 404);
}

function loadAll(dir: string, parser: AlpParser, out: AlpObject[]) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.runtime' || entry.name === '.cache') continue;
      loadAll(full, parser, out);
    } else if (entry.name.endsWith('.alp')) {
      try {
        const content = fs.readFileSync(full, 'utf-8');
        out.push(...parser.parse(content));
      } catch {
        /* skip unparseable files */
      }
    }
  }
}

function extractDeps(obj: AlpObject): string[] {
  const deps: string[] = [];
  for (const key of ['depends_on', 'blocked_by', 'requires']) {
    const val = (obj as any)[key];
    if (!val) continue;
    const arr = Array.isArray(val) ? val : [val];
    for (const v of arr) {
      const cleaned = String(v).replace(/^->\s*/, '').trim();
      if (cleaned) deps.push(cleaned);
    }
  }
  return deps;
}

function readLocks(cwd: string): string[] {
  const lockFile = path.join(cwd, '.alp', '.runtime', 'locks.json');
  if (!fs.existsSync(lockFile)) return [];
  try {
    const locks = JSON.parse(fs.readFileSync(lockFile, 'utf-8')) as Record<string, unknown>;
    return Object.keys(locks);
  } catch {
    return [];
  }
}

// Self-contained dashboard. No external assets, no build step.
const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ALP Live Swarm &amp; State Server</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --bg-dark: #08090f;
    --bg-card: rgba(18, 21, 35, 0.75);
    --border: rgba(255, 255, 255, 0.08);
    --text-main: #f0f4fd;
    --text-muted: #7e89a3;
    --cyan: #00f0ff;
    --emerald: #10b981;
    --amber: #f59e0b;
    --rose: #f43f5e;
    --purple: #9d4edd;
    --blue: #3b82f6;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg-dark);
    color: var(--text-main);
    font-family: 'Inter', system-ui, sans-serif;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }
  header {
    padding: 16px 28px;
    background: rgba(12, 14, 24, 0.9);
    backdrop-filter: blur(16px);
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    position: sticky;
    top: 0;
    z-index: 100;
  }
  .brand { display: flex; align-items: center; gap: 12px; }
  .logo {
    width: 32px; height: 32px;
    background: linear-gradient(135deg, var(--cyan), var(--purple));
    border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    font-weight: 800; font-family: 'JetBrains Mono', monospace; color: #000;
    box-shadow: 0 0 16px rgba(0, 240, 255, 0.35);
  }
  .title { font-size: 1.1rem; font-weight: 700; background: linear-gradient(90deg, #fff, var(--text-muted)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
  .pulse-dot {
    width: 10px; height: 10px; border-radius: 50%;
    background: var(--emerald);
    box-shadow: 0 0 10px var(--emerald);
    animation: pulse 2s infinite;
  }
  @keyframes pulse { 0% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.85); } 100% { opacity: 1; transform: scale(1); } }
  .status-tag { display: flex; align-items: center; gap: 8px; font-size: 0.8rem; font-family: 'JetBrains Mono', monospace; padding: 4px 12px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 20px; color: var(--emerald); }
  
  main { flex: 1; padding: 28px; max-width: 1400px; margin: 0 auto; width: 100%; display: flex; flex-direction: column; gap: 24px; }
  
  /* Progress Section */
  .progress-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    backdrop-filter: blur(12px);
    border-radius: 12px;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .progress-header { display: flex; justify-content: space-between; align-items: center; font-size: 0.9rem; font-weight: 600; }
  .progress-bar-bg { width: 100%; height: 10px; background: rgba(255, 255, 255, 0.05); border-radius: 5px; overflow: hidden; position: relative; }
  .progress-bar-fill { height: 100%; background: linear-gradient(90deg, var(--cyan), var(--emerald)); width: 0%; transition: width 0.5s ease; box-shadow: 0 0 12px rgba(0, 240, 255, 0.5); }
  
  /* Grid Layout */
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }

  .card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    backdrop-filter: blur(12px);
    border-radius: 12px;
    padding: 20px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  }
  .card h2 { font-size: 0.85rem; font-family: 'JetBrains Mono', monospace; text-transform: uppercase; letter-spacing: 0.08em; color: var(--cyan); margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between; }
  
  /* Stat Cards */
  .stat-card { display: flex; flex-direction: column; gap: 6px; }
  .stat-num { font-size: 1.8rem; font-weight: 800; font-family: 'JetBrains Mono', monospace; }
  .stat-desc { font-size: 0.78rem; color: var(--text-muted); }

  .stat-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 0.85rem; }
  .stat-row:last-child { border-bottom: none; }

  .badge { padding: 3px 8px; border-radius: 4px; font-size: 0.75rem; font-family: 'JetBrains Mono', monospace; font-weight: 700; }
  .b-done { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
  .b-progress { background: rgba(0, 240, 255, 0.15); color: #38bdf8; border: 1px solid rgba(0, 240, 255, 0.3); }
  .b-blocked { background: rgba(244, 63, 94, 0.15); color: #fb7185; border: 1px solid rgba(244, 63, 94, 0.3); }
  .b-review { background: rgba(157, 78, 221, 0.15); color: #c084fc; border: 1px solid rgba(157, 78, 221, 0.3); }
  .b-todo { background: rgba(255, 255, 255, 0.05); color: var(--text-muted); border: 1px solid rgba(255, 255, 255, 0.1); }

  /* Event Stream Log */
  #log { height: 360px; overflow-y: auto; font-family: 'JetBrains Mono', monospace; display: flex; flex-direction: column; gap: 8px; }
  .evt-item { padding: 8px 12px; background: rgba(0, 0, 0, 0.3); border: 1px solid rgba(255,255,255,0.03); border-radius: 6px; font-size: 0.8rem; display: flex; flex-direction: column; gap: 4px; }
  .evt-header { display: flex; justify-content: space-between; color: var(--text-muted); font-size: 0.72rem; }
  .evt-type { color: var(--purple); font-weight: 700; }
  .evt-id { color: var(--cyan); }
  .evt-body { color: var(--text-main); }
</style>
</head>
<body>
<header>
  <div class="brand">
    <div class="logo">ALP</div>
    <div>
      <div class="title">ALP Live Swarm &amp; State Server</div>
      <div id="proj" style="font-size:0.75rem; color:var(--text-muted);"></div>
    </div>
  </div>
  <div class="status-tag">
    <span class="pulse-dot"></span> LIVE SSE STREAM
  </div>
</header>

<main>
  <!-- Task Completion Progress -->
  <div class="progress-card">
    <div class="progress-header">
      <span>WORKSPACE TASK COMPLETION</span>
      <span id="progressPct" style="color:var(--cyan); font-family:'JetBrains Mono';">0%</span>
    </div>
    <div class="progress-bar-bg">
      <div id="progressBar" class="progress-bar-fill"></div>
    </div>
  </div>

  <!-- Key Metrics 4-Grid -->
  <div class="grid-4">
    <div class="card stat-card">
      <div class="stat-desc">TOTAL TASKS</div>
      <div id="mTotal" class="stat-num" style="color:var(--text-main);">0</div>
    </div>
    <div class="card stat-card">
      <div class="stat-desc">COMPLETED [x]</div>
      <div id="mDone" class="stat-num" style="color:var(--emerald);">0</div>
    </div>
    <div class="card stat-card">
      <div class="stat-desc">IN PROGRESS [~]</div>
      <div id="mProgress" class="stat-num" style="color:var(--cyan);">0</div>
    </div>
    <div class="card stat-card">
      <div class="stat-desc">BLOCKED [!]</div>
      <div id="mBlocked" class="stat-num" style="color:var(--rose);">0</div>
    </div>
  </div>

  <!-- Main Status & Swarm Info -->
  <div class="grid-2">
    <div class="card">
      <h2>TASK BREAKDOWN BY STATUS</h2>
      <div id="statusList">loading...</div>
    </div>
    <div class="card">
      <h2>ACTIVE AGENTS &amp; LOCKS</h2>
      <div id="agentsList">loading...</div>
    </div>
  </div>

  <!-- Analytics -->
  <div class="card">
    <h2>RUNTIME ANALYTICS</h2>
    <div id="analyticsBody">loading telemetry...</div>
  </div>

  <!-- Live Log Stream -->
  <div class="card">
    <h2>LIVE EVENT STREAM</h2>
    <div id="log"></div>
  </div>
</main>

<script>
async function refresh() {
  const s = await (await fetch('/api/state')).json();
  document.getElementById('proj').textContent = s.project ? 'Workspace: ' + s.project : 'Workspace: default';
  
  const done = s.statusCount['[x]'] || 0;
  const progress = s.statusCount['[~]'] || 0;
  const blocked = s.statusCount['[!]'] || 0;
  const total = s.totalTasks || 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  document.getElementById('mTotal').textContent = total;
  document.getElementById('mDone').textContent = done;
  document.getElementById('mProgress').textContent = progress;
  document.getElementById('mBlocked').textContent = blocked;

  document.getElementById('progressPct').textContent = pct + '% (' + done + '/' + total + ')';
  document.getElementById('progressBar').style.width = pct + '%';

  const cls = st => ({'[x]':'b-done','[!]':'b-blocked','[?]':'b-review','[~]':'b-progress','[ ]':'b-todo'}[st]||'b-todo');
  document.getElementById('statusList').innerHTML =
    Object.entries(s.statusCount).map(([k,v]) =>
      '<div class="stat-row"><span class="badge '+cls(k)+'">'+k+'</span><b>'+v+' tasks</b></div>').join('') || 'No tasks found';

  document.getElementById('agentsList').innerHTML =
    '<div class="stat-row"><span>Active Swarm Agents</span><b>' + (s.agents.join(', ') || 'none') + '</b></div>' +
    '<div class="stat-row"><span>Active File Locks</span><b>' + (s.activeLocks.join(', ') || 'none') + '</b></div>';

  await renderAnalytics();
}

async function renderAnalytics() {
  let a;
  try { a = await (await fetch('/api/analytics')).json(); } catch { return; }
  const fmt = ms => ms == null ? '—' : (ms/1000).toFixed(1) + 's';
  const sec = h => '<div class="stat-row"><span>Task: ' + h.task_id + '</span><span style="color:var(--rose);">failures: ' + h.failures + ' / handoffs: ' + h.handoffs + '</span></div>';
  document.getElementById('analyticsBody').innerHTML =
    '<div class="grid-4">' +
      '<div class="stat-row"><span>Total Runtime Events</span><b>' + a.total_events + '</b></div>' +
      '<div class="stat-row"><span>Execution Engine Runs</span><b>' + a.runs + '</b></div>' +
      '<div class="stat-row"><span>Avg Cycle Time</span><b>' + fmt(a.avg_cycle_time_ms) + '</b></div>' +
      '<div class="stat-row"><span>Agents Active</span><b>' + a.agents.length + '</b></div>' +
    '</div>' +
    '<br/>' +
    '<h2>FAILURE HOTSPOTS</h2>' +
    (a.failure_hotspots && a.failure_hotspots.length
      ? a.failure_hotspots.slice(0,5).map(sec).join('')
      : '<div class="stat-row" style="color:var(--emerald);">Zero failure hotspots detected 🎉</div>');
}

function addEvent(e) {
  const box = document.getElementById('log');
  const div = document.createElement('div');
  div.className = 'evt-item';
  div.innerHTML =
    '<div class="evt-header">' +
      '<span class="evt-type">' + (e.type || 'event').toUpperCase() + '</span>' +
      '<span>' + (e.timestamp || '').replace('T',' ').replace('Z','') + '</span>' +
    '</div>' +
    '<div class="evt-body">' +
      (e.task_id ? '<span class="evt-id">[' + e.task_id + ']</span> ' : '') +
      (e.status ? '[' + e.status + '] ' : '') +
      (e.message || '') +
    '</div>';
  box.prepend(div);
  refresh();
}

fetch('/api/events').then(r=>r.json()).then(evts => evts.slice(-30).forEach(addEvent));
const es = new EventSource('/api/stream');
es.onmessage = ev => { try { addEvent(JSON.parse(ev.data)); } catch {} };
refresh();
setInterval(refresh, 4000);
</script>
</body>
</html>`;
