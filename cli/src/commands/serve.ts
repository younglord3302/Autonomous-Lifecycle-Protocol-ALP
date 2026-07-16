import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { AlpParser, AlpObject, StateStore, computeAnalytics } from '@alp/parser';
import { readEvents, runtimeLogPath } from '../runtime';

interface ServeOptions {
  port?: number;
  host?: string;
  db?: boolean;
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
<title>ALP State Server</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
         background: #0d1117; color: #e6edf3; }
  header { padding: 16px 24px; border-bottom: 1px solid #21262d; display:flex;
           align-items:center; gap:12px; }
  header h1 { font-size: 16px; margin: 0; }
  .dot { width:10px;height:10px;border-radius:50%;background:#3fb950;
         box-shadow:0 0 8px #3fb950; }
   main { display:grid; grid-template-columns: 1fr 1fr; gap:16px; padding:24px; }
   .card { background:#161b22; border:1px solid #21262d; border-radius:8px; padding:16px; }
   #analytics { grid-column: 1 / -1; }
  .card h2 { font-size:13px; text-transform:uppercase; letter-spacing:.05em;
             color:#8b949e; margin:0 0 12px; }
  .stat { display:flex; justify-content:space-between; padding:4px 0;
          border-bottom:1px solid #21262d; }
  .badge { padding:2px 8px; border-radius:4px; font-size:12px; }
  .b-done{background:#238636;} .b-blocked{background:#da3633;}
  .b-review{background:#9e6a03;} .b-progress{background:#1f6feb;}
  .b-todo{background:#30363d;}
  #log { grid-column: 1 / -1; height:320px; overflow:auto; }
  .evt { padding:3px 0; font-size:12px; white-space:pre-wrap; border-bottom:1px solid #161b22; }
  .evt .t { color:#58a6ff; } .evt .ty { color:#d2a8ff; } .evt .id { color:#7ee787; }
</style>
</head>
<body>
<header><span class="dot"></span><h1>ALP State Server</h1><span id="proj" style="color:#8b949e"></span></header>
<main>
  <div class="card"><h2>Task Status</h2><div id="status"></div></div>
  <div class="card"><h2>Agents &amp; Locks</h2><div id="agents"></div></div>
   <div class="card" id="log"><h2>Live Event Stream</h2><div id="events"></div></div>
   <div class="card" id="analytics"><h2>Analytics</h2><div id="analyticsBody">loading…</div></div>
</main>
<script>
async function refresh() {
  const s = await (await fetch('/api/state')).json();
  document.getElementById('proj').textContent = s.project ? '— ' + s.project : '';
  const cls = st => ({'[x]':'b-done','[!]':'b-blocked','[?]':'b-review','[~]':'b-progress','[ ]':'b-todo'}[st]||'b-todo');
  document.getElementById('status').innerHTML =
    'Total tasks: <b>' + s.totalTasks + '</b><br/><br/>' +
    Object.entries(s.statusCount).map(([k,v]) =>
      '<div class="stat"><span class="badge '+cls(k)+'">'+k+'</span><b>'+v+'</b></div>').join('');
   document.getElementById('agents').innerHTML =
     '<b>Agents:</b> ' + (s.agents.join(', ') || 'none') +
     '<br/><br/><b>Active locks:</b> ' + (s.activeLocks.join(', ') || 'none');
   await renderAnalytics();
}
async function renderAnalytics() {
  let a;
  try { a = await (await fetch('/api/analytics')).json(); }
  catch { return; }
  const fmt = ms => ms == null ? '—' : (ms/1000).toFixed(1) + 's';
  const sec = h => '<div class="stat"><span>' + h.task_id + '</span><span>b' + h.failures + ' / ?' + h.handoffs + '</span></div>';
  document.getElementById('analyticsBody').innerHTML =
    '<div class="stat"><span>Total events</span><b>' + a.total_events + '</b></div>' +
    '<div class="stat"><span>Runs</span><b>' + a.runs + '</b></div>' +
    '<div class="stat"><span>Avg cycle time</span><b>' + fmt(a.avg_cycle_time_ms) + '</b></div>' +
    '<div class="stat"><span>Agents active</span><b>' + a.agents.length + '</b></div>' +
    (a.failure_hotspots.length
      ? '<br/><b>Failure hotspots</b>' + a.failure_hotspots.slice(0,8).map(sec).join('')
      : '<br/><b>Failure hotspots</b><br/>none 🎉');
}
function addEvent(e) {
  const box = document.getElementById('events');
  const div = document.createElement('div');
  div.className = 'evt';
  div.innerHTML = '<span class="t">' + (e.timestamp||'').replace('T',' ').replace('Z','') + '</span> ' +
    '<span class="ty">' + (e.type||'') + '</span> ' +
    (e.task_id ? '<span class="id">' + e.task_id + '</span> ' : '') +
    (e.status ? '[' + e.status + '] ' : '') +
    (e.message || '');
  box.prepend(div);
  refresh();
}
fetch('/api/events').then(r=>r.json()).then(evts => evts.slice(-30).forEach(addEvent));
const es = new EventSource('/api/stream');
es.onmessage = ev => { try { addEvent(JSON.parse(ev.data)); } catch {} };
refresh();
setInterval(refresh, 3000);
</script>
</body>
</html>`;
