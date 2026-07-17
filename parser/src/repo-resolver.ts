import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'node:child_process';
import { AlpParser, AlpObject } from './index';

/**
 * Cross-Repository Orchestration (v4 — The Federation Era, Pillar 2)
 *
 * Lets one ALP workspace span multiple repositories. A `@repo` object
 * declares an external repo (local path or Git URL). The resolver fetches
 * Git repos into `.alp/.cache/repos/<id>/` (pinned to a commit when given),
 * loads their `.alp` graphs, and resolves `-> repo::object` references across
 * the federation. Cross-repo references are read-only by design.
 */

export interface RepoDeclaration {
  id: string;
  src: string;
  commit?: string;
  branch?: string;
  localPath: string; // resolved on-disk path to the repo root
  fetched: boolean;  // true if fetched via git
}

export interface CrossRepoReference {
  from: string;          // object id where the ref appears
  raw: string;          // raw ref text e.g. "-> billing::task-stripe"
  repo: string | null;  // target repo id (null if unqualified)
  target: string;       // target object id
  resolved: boolean;
}

export interface ResolveResult {
  repos: RepoDeclaration[];
  objects: Map<string, { repo: string; object: AlpObject }>;
  references: CrossRepoReference[];
  dangling: CrossRepoReference[];
  graph: { nodes: { id: string; repo: string; status?: string }[]; edges: { from: string; to: string; type: string }[] };
}

const REPO_CACHE = path.join('.alp', '.cache', 'repos');
const REF_RE = /^->\s*([a-z0-9-]+)::(.+)$/;
const WS_REF_RE = /^->\s*([a-z0-9-]+)::([a-z0-9-]+)::(.+)$/;

function isGitUrl(src: string): boolean {
  return /^(https?:\/\/|git\+https?:\/\/|git@|ssh:\/\/)/.test(src) || src.endsWith('.git');
}

function walkAlp(dir: string, parser: AlpParser, out: AlpObject[]) {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.runtime' || entry.name === '.cache') continue;
      walkAlp(full, parser, out);
    } else if (entry.name.endsWith('.alp')) {
      try { out.push(...parser.parse(fs.readFileSync(full, 'utf-8'))); } catch {}
    }
  }
}

export class ExternalResolver {
  private alpRoot: string;

  constructor(alpRoot: string) {
    this.alpRoot = alpRoot;
  }

  /** Discover @repo declarations in this workspace. */
  discover(): RepoDeclaration[] {
    const parser = new AlpParser();
    const all: AlpObject[] = [];
    walkAlp(this.alpRoot, parser, all);
    const repos: RepoDeclaration[] = [];
    for (const o of all) {
      if (o._type !== 'repo') continue;
      const src = String(o.src ?? '');
      let localPath: string;
      let fetched = false;
      if (!src) {
        localPath = this.alpRoot;
      } else if (path.isAbsolute(src) || !isGitUrl(src)) {
        localPath = path.isAbsolute(src) ? src : path.resolve(this.alpRoot, '..', src);
        if (!fs.existsSync(localPath)) localPath = path.resolve(this.alpRoot, src);
      } else {
        localPath = path.resolve(this.alpRoot, '..', REPO_CACHE, String(o.id));
        fetched = true;
      }
      repos.push({ id: String(o.id), src, commit: o.commit, branch: o.branch, localPath, fetched });
    }
    return repos;
  }

  /** Fetch (or update) a Git-backed repo into the cache, pinned if specified. */
  fetch(repo: RepoDeclaration): void {
    if (!repo.fetched) return;
    const url = repo.src;
    if (fs.existsSync(repo.localPath)) {
      // Already cached; update unless pinned to a commit.
      if (!repo.commit) {
        try { execFileSync('git', ['fetch', '--quiet', 'origin'], { cwd: repo.localPath, stdio: 'ignore' }); } catch {}
        try { execFileSync('git', ['reset', '--hard', repo.branch || 'origin/HEAD'], { cwd: repo.localPath, stdio: 'ignore' }); } catch {}
      }
      return;
    }
    fs.mkdirSync(path.dirname(repo.localPath), { recursive: true });
    execFileSync('git', ['clone', '--quiet', url, repo.localPath], { stdio: 'ignore' });
    if (repo.commit) {
      execFileSync('git', ['checkout', '--quiet', repo.commit], { cwd: repo.localPath, stdio: 'ignore' });
    } else if (repo.branch) {
      execFileSync('git', ['checkout', '--quiet', repo.branch], { cwd: repo.localPath, stdio: 'ignore' });
    }
  }

  /** Resolve the full cross-repo graph. */
  resolve(): ResolveResult {
    const repos = this.discover();
    for (const r of repos) if (r.fetched) this.fetch(r);

    const objects = new Map<string, { repo: string; object: AlpObject }>();
    const parser = new AlpParser();
    const graphNodes: ResolveResult['graph']['nodes'] = [];
    const graphEdges: ResolveResult['graph']['edges'] = [];

    // Local workspace objects (repo = "local").
    const localObjs: AlpObject[] = [];
    walkAlp(this.alpRoot, parser, localObjs);
    for (const o of localObjs) {
      if (o._type === 'repo') continue;
      objects.set(o.id, { repo: 'local', object: o });
      graphNodes.push({ id: o.id, repo: 'local', status: o.status });
    }

    for (const r of repos) {
      const repoObjs: AlpObject[] = [];
      walkAlp(path.join(r.localPath, '.alp'), parser, repoObjs);
      for (const o of repoObjs) {
        objects.set(`${r.id}::${o.id}`, { repo: r.id, object: o });
        graphNodes.push({ id: o.id, repo: r.id, status: o.status });
      }
    }

    // Resolve references.
    const references: CrossRepoReference[] = [];
    const refFields = ['depends_on', 'blocked_by', 'requires', 'owner', 'related'];
    for (const o of localObjs) {
      if (o._type === 'repo') continue;
      this.collectRefs(o, references, objects, 'local');
    }
    for (const r of repos) {
      const repoObjs: AlpObject[] = [];
      walkAlp(path.join(r.localPath, '.alp'), parser, repoObjs);
      for (const o of repoObjs) this.collectRefs(o, references, objects, r.id);
    }

    for (const ref of references) {
      if (ref.resolved) {
        const key = ref.repo ? `${ref.repo}::${ref.target}` : ref.target;
        graphEdges.push({ from: key, to: ref.from, type: 'ref' });
      }
    }

    const dangling = references.filter((r) => !r.resolved);
    return { repos, objects, references, dangling, graph: { nodes: graphNodes, edges: graphEdges } };
  }

  private collectRefs(
    obj: AlpObject,
    out: CrossRepoReference[],
    objects: Map<string, { repo: string; object: AlpObject }>,
    sourceRepo: string,
  ) {
    const fields = ['depends_on', 'blocked_by', 'requires', 'owner', 'related'];
    const scan = (raw: string) => {
      let repo: string | null = null;
      let target = raw;
      const wsMatch = WS_REF_RE.exec(raw.trim());
      if (wsMatch) { /* cross-workspace: treat whole middle as repo */ repo = wsMatch[1]; target = wsMatch[3]; }
      else {
        const m = REF_RE.exec(raw.trim());
        if (m) { repo = m[1]; target = m[2]; }
      }
      if (!repo) return; // unqualified local ref
      const key = `${repo}::${target}`;
      const resolved = objects.has(key);
      out.push({ from: obj.id, raw: raw.trim(), repo, target, resolved });
    };
    for (const f of fields) {
      const v = (obj as any)[f];
      if (!v) continue;
      const arr = Array.isArray(v) ? v : [v];
      for (const item of arr) {
        const s = String(item).replace(/^->\s*/, '').replace(/\|.*$/, '').trim();
        if (s.includes('::')) scan(`-> ${s}`);
      }
    }
  }
}
