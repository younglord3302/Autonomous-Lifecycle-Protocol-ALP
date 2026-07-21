import * as fs from 'fs';
import * as path from 'path';
import { AlpReader, AlpObject } from './reader';
import { SyntaxError, ValidationError } from './error';
import { RemoteFetcher, FetchOptions } from './remote';
import { AlpValidator } from './validator';

/**
 * ALP Plugin System (v10.5.0, @type rewrite v8.0.0).
 *
 * Resolves file-level `!import` directives (spec/11): local `.alp` files
 * relative to the `.alp/` workspace root (§3.1), remote HTTPS URLs with
 * caching + integrity (§3.2–3.4), and registry aliases `@ns/name@version`
 * (§3.5). Builds a registry of custom types declared via the canonical
 * `@type` block (v8.0.0+, sole declaration since v9.0.0) and validates
 * custom-type instances (§4.1).
 */

export interface TypeProperty {
  name: string;
  type: string;
  required: boolean;
}

export interface CustomType {
  /** The block marker, e.g. "epic" for `@epic`. */
  typeName: string;
  id: string;
  description?: string;
  properties: TypeProperty[];
  allowedNested: string[];
}

export interface PluginInfo {
  id: string;
  name?: string;
  version?: string;
  types: string[]; // type ids referenced via `-> type-...`
}

const CORE_TYPES = new Set([
  'project', 'feature', 'task', 'agent', 'decision', 'rule', 'memory',
  'state', 'workflow', 'policy', 'macro', 'plugin', 'type',
  'workspace', 'repo', 'swarm', 'resource', 'constraint', 'context',
  'goal', 'artifact', 'event', 'package',
]);

export class PluginResolver {
  /** Custom types keyed by `type_name` (the block marker). */
  public types: Map<string, CustomType> = new Map();
  /** Loaded plugins keyed by plugin id. */
  public plugins: Map<string, PluginInfo> = new Map();

  /** All objects discovered across the root file + imported files. */
  public objects: AlpObject[] = [];

  /** Non-fatal notices (e.g. `!deprecated`). */
  public warnings: string[] = [];

  private reader = new AlpReader();
  private visited = new Set<string>();
  private fetcher: RemoteFetcher;
  private fetcherOptions: FetchOptions = {};
  private validator = new AlpValidator();

  /** Source paths for loaded plugins (for hot-reload). */
  private pluginSources: Map<string, string> = new Map();
  /** Type names registered by each plugin (for hot-reload cleanup). */
  private pluginTypes: Map<string, Set<string>> = new Map();

  constructor(rootDir?: string, fetchOptions: FetchOptions = {}) {
    this.fetcher = new RemoteFetcher(rootDir ?? process.cwd());
    this.fetcherOptions = fetchOptions;
  }

  /**
   * Parse `content` (a root `.alp` file) resolving local/remote/registry
   * `!import`s and registering any custom types. Returns every object found.
   */
  public async parseWorkspace(
    content: string,
    rootDir: string,
    options: FetchOptions = {},
    sourcePath?: string
  ): Promise<AlpObject[]> {
    this.fetcher = new RemoteFetcher(rootDir);
    this.fetcherOptions = { ...this.fetcherOptions, ...options };
    this.types.clear();
    this.plugins.clear();
    this.objects = [];
    this.visited.clear();
    this.pluginSources.clear();
    this.pluginTypes.clear();
    await this.resolveFile(content, rootDir, rootDir, 0, sourcePath);
    return this.objects;
  }

  /**
   * Resolve a single file: parse it, register plugin/type definitions it
   * declares, recurse into its imports, then collect its objects.
   */
  private async resolveFile(
    content: string,
    fileDir: string,
    rootDir: string,
    depth: number,
    sourcePath?: string,
    owningPluginId?: string
  ): Promise<void> {
    if (depth > 5) {
      throw new SyntaxError('Maximum local import depth (5) exceeded.');
    }

    let currentPluginId: string | undefined;

    // Intercept `!import` directives by pre-scanning file-level lines.
    const lines = content.split('\n');
    let body = '';
    for (const raw of lines) {
      const trimmed = raw.trim();
      if (trimmed.startsWith('!import')) {
        const { target, integrity } = this.extractImport(trimmed);
        const effectivePluginId = currentPluginId || owningPluginId;
        if (/^https?:\/\//.test(target) || target.startsWith('@')) {
          const remoteContent = await this.fetcher.fetchImport(target, {
            ...this.fetcherOptions,
            integrity,
          });
          await this.resolveFile(remoteContent, fileDir, rootDir, depth + 1, target, effectivePluginId);
        } else {
          const resolved = this.resolveLocalImport(target, fileDir, rootDir);
          await this.resolveFile(
            fs.readFileSync(resolved, 'utf8'),
            path.dirname(resolved),
            rootDir,
            depth + 1,
            resolved,
            effectivePluginId
          );
        }
        continue;
      }
      body += raw + '\n';
    }

    const parsed = this.reader.parse(body);
    for (const obj of parsed) {
      if (obj._type === 'plugin') {
        this.registerPlugin(obj);
        currentPluginId = obj.id;
        if (sourcePath) {
          this.pluginSources.set(obj.id, sourcePath);
        }
      } else if (obj._type === 'type') {
        this.registerType(obj, [], currentPluginId || owningPluginId);
      } else if (obj._type === 'type_definition') {
        throw new ValidationError(
          `@type_definition was removed in v9.0.0; declare custom types with @type instead.`
        );
      }
      this.objects.push(obj);
    }
  }

  /**
   * Parse a `!import` directive, returning the target and any `!integrity`
   * hash (spec/11 §3.4).
   */
  private extractImport(directive: string): { target: string; integrity?: string } {
    const m = directive.match(
      /^!import(?::|\s)\s*"([^"]+)"(?:\s+!integrity:\s*(sha256:[a-fA-F0-9]+))?/
    );
    if (!m) {
      throw new SyntaxError(`Malformed !import directive: '${directive}'`);
    }
    return { target: m[1].trim(), integrity: m[2] };
  }

  /**
   * Resolve a local import path relative to the `.alp/` root (spec/11 §3.1):
   * the path is relative to the root, not the importing file. Guards against
   * path traversal and circular imports.
   */
  private resolveLocalImport(target: string, fileDir: string, rootDir: string): string {
    const root = path.resolve(rootDir);
    // Resolve against root first (spec: relative to .alp/ root).
    const candidate = path.resolve(root, target);
    const within = candidate === root || candidate.startsWith(root + path.sep);
    if (!within) {
      throw new SyntaxError(`!import path escapes workspace root: '${target}'`);
    }
    if (this.visited.has(candidate)) {
      throw new SyntaxError(`Circular !import detected: '${target}'`);
    }
    if (!fs.existsSync(candidate)) {
      throw new SyntaxError(`!import target not found: '${target}'`);
    }
    this.visited.add(candidate);
    return candidate;
  }

  private registerPlugin(obj: AlpObject): void {
    const types = Array.isArray(obj['types']) ? obj['types'] as string[] : [];
    const ids = types
      .map((t) => (t.startsWith('-> ') ? t.substring(3).trim() : t))
      .filter((t) => t.startsWith('type-'));
    this.plugins.set(obj.id, {
      id: obj.id,
      name: obj['name'],
      version: obj['version'],
      types: ids,
    });
  }

  private registerType(obj: AlpObject, warnings: string[] = [], pluginId?: string): void {
    const typeName = obj['type_name'] as string;
    if (!typeName) {
      throw new ValidationError(`@type '${obj.id}' missing type_name`);
    }
    if (CORE_TYPES.has(typeName)) {
      throw new ValidationError(
        `@type '${obj.id}' redefines core type '${typeName}'`
      );
    }
    const rawProps = Array.isArray(obj['properties']) ? obj['properties'] : [];
    const properties: TypeProperty[] = rawProps.map((p: any) => {
      const parsed = typeof p === 'string' ? parseInlineObject(p) : p;
      return {
        name: String(parsed.name ?? ''),
        type: String(parsed.type ?? 'String'),
        required: Boolean(parsed.required),
      };
    });
    const allowedNested = Array.isArray(obj['allowed_nested'])
      ? (obj['allowed_nested'] as string[])
      : [];
    this.types.set(typeName, {
      typeName,
      id: obj.id,
      description: obj['description'],
      properties,
      allowedNested,
    });
    if (pluginId) {
      if (!this.pluginTypes.has(pluginId)) {
        this.pluginTypes.set(pluginId, new Set());
      }
      this.pluginTypes.get(pluginId)!.add(typeName);
    }
    for (const w of warnings) this.warnings.push(w);
  }

  /**
   * Validate a custom-type instance (a block marker registered in `types`).
   * Throws `ValidationError` on missing required property or unknown
   * property type. Unknown properties produce a warning, not a fatal error
   * (spec/11 §4.1).
   */
  public validateCustom(obj: AlpObject, warnings: string[] = []): void {
    const def = this.types.get(obj._type);
    if (!def) return; // not a custom type; caller decides forward-compat

    for (const prop of def.properties) {
      if (prop.required && !(prop.name in obj)) {
        throw new ValidationError(
          `Missing required property '${prop.name}' in @${obj._type} '${obj.id}'`
        );
      }
    }

    const known = new Set(def.properties.map((p) => p.name));
    for (const key of Object.keys(obj)) {
      if (key === '_type' || key === 'id') continue;
      if (key.startsWith('@')) continue;
      if (!known.has(key)) {
        warnings.push(
          `Unknown property '${key}' in @${obj._type} '${obj.id}' (not in type schema)`
        );
      }
    }
  }

  /**
   * Validate a standalone plugin file: schema validity, circular dependency
   * detection, and version-range intersection across declared dependencies.
   */
  public async validate(pluginPath: string): Promise<void> {
    if (!fs.existsSync(pluginPath)) {
      throw new SyntaxError(`Plugin file not found: ${pluginPath}`);
    }
    const content = fs.readFileSync(pluginPath, 'utf8');
    const parsed = this.reader.parse(content);

    for (const obj of parsed) {
      try {
        this.validator.validate(obj);
      } catch (e) {
        throw new ValidationError(
          `Schema validation failed for @${obj._type} '${obj.id}': ${(e as Error).message}`
        );
      }
    }

    const plugins = parsed.filter((o) => o._type === 'plugin');
    if (!plugins.length) {
      throw new ValidationError(`No @plugin block found in ${pluginPath}`);
    }

    const depGraph: Record<string, string[]> = {};
    const depRanges: Record<string, { plugin: string; range: string }[]> = {};

    for (const p of plugins) {
      const raw = Array.isArray(p['dependencies']) ? p['dependencies'] : [];
      const depNames: string[] = [];
      for (const dep of raw) {
        const depStr = typeof dep === 'string' ? dep : JSON.stringify(dep);
        const m = depStr.match(/^@[^/]+\/([^@]+)@(.+)$/);
        if (m) {
          const name = m[1];
          const range = m[2];
          depNames.push(name);
          if (!depRanges[name]) depRanges[name] = [];
          depRanges[name].push({ plugin: p.id, range });
        }
      }
      depGraph[p.id] = depNames;
    }

    const visited = new Set<string>();
    const inStack = new Set<string>();
    for (const id of Object.keys(depGraph)) {
      if (this._detectCycle(depGraph, id, visited, inStack)) {
        throw new ValidationError(`Circular plugin dependency detected involving '${id}'`);
      }
    }

    for (const [name, ranges] of Object.entries(depRanges)) {
      if (ranges.length > 1) {
        for (let i = 0; i < ranges.length; i++) {
          for (let j = i + 1; j < ranges.length; j++) {
            if (!this._rangesIntersect(ranges[i].range, ranges[j].range)) {
              throw new ValidationError(
                `Version range conflict for dependency '${name}': ` +
                  `${ranges[i].plugin} requires '${ranges[i].range}' but ` +
                  `${ranges[j].plugin} requires '${ranges[j].range}'`
              );
            }
          }
        }
      }
    }
  }

  /**
   * Hot-reload a plugin by id: removes the old registration and re-parses
   * its source file without re-parsing the entire workspace.
   */
  public async hotReload(pluginId: string): Promise<void> {
    const sourcePath = this.pluginSources.get(pluginId);
    if (!sourcePath) {
      throw new Error(`Cannot hot-reload plugin '${pluginId}': source path not tracked.`);
    }
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Plugin source not found: ${sourcePath}`);
    }

    this.plugins.delete(pluginId);
    const typesToRemove = this.pluginTypes.get(pluginId);
    if (typesToRemove) {
      for (const typeName of typesToRemove) {
        this.types.delete(typeName);
      }
      this.pluginTypes.delete(pluginId);
    }
    this.pluginSources.delete(pluginId);

    const content = fs.readFileSync(sourcePath, 'utf8');
    const rootDir = path.dirname(sourcePath);
    await this.resolveFile(content, rootDir, rootDir, 0, sourcePath, undefined);
  }

  /**
   * Return info for all loaded plugins.
   */
  public listPlugins(): PluginInfo[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Lint a plugin file for style and best-practice warnings.
   * Returns an array of warning strings (empty if clean).
   */
  public lintPlugin(pluginPath: string): string[] {
    const warnings: string[] = [];
    if (!fs.existsSync(pluginPath)) {
      warnings.push(`Plugin file not found: ${pluginPath}`);
      return warnings;
    }
    const content = fs.readFileSync(pluginPath, 'utf8');
    const parsed = this.reader.parse(content);

    const plugin = parsed.find((o) => o._type === 'plugin');
    if (!plugin) {
      warnings.push('No @plugin block found.');
      return warnings;
    }

    if (!plugin['version']) {
      warnings.push(`Plugin '${plugin.id}' is missing a 'version' field.`);
    }
    if (!plugin['description']) {
      warnings.push(`Plugin '${plugin.id}' is missing a 'description' field.`);
    }
    const rawTypes = Array.isArray(plugin['types']) ? plugin['types'] : [];
    if (!rawTypes.length) {
      warnings.push(`Plugin '${plugin.id}' has no 'types' references.`);
    }
    for (const t of rawTypes) {
      const ref = typeof t === 'string' ? t : String(t);
      if (!ref.startsWith('-> ')) {
        warnings.push(`Type reference '${ref}' in '${plugin.id}' should start with '-> '.`);
      } else if (!ref.substring(3).trim().startsWith('type-')) {
        warnings.push(`Type reference '${ref}' in '${plugin.id}' should reference a custom type (type-...).`);
      }
    }
    const rawDeps = Array.isArray(plugin['dependencies']) ? plugin['dependencies'] : [];
    for (const dep of rawDeps) {
      const depStr = typeof dep === 'string' ? dep : JSON.stringify(dep);
      if (!depStr.includes('@')) {
        warnings.push(`Dependency '${depStr}' in '${plugin.id}' should use @ns/name@version format.`);
      }
    }
    if (plugin['id'] && !/^[a-z0-9-]+$/.test(plugin['id'])) {
      warnings.push(`Plugin id '${plugin['id']}' is not kebab-case.`);
    }

    const typesInFile = parsed.filter((o) => o._type === 'type');
    for (const t of typesInFile) {
      const typeName = t['type_name'];
      if (!typeName) {
        warnings.push(`@type '${t.id}' is missing type_name.`);
      } else if (!/^[a-z0-9-]+$/.test(typeName)) {
        warnings.push(`Custom type name '${typeName}' is not kebab-case.`);
      }
      if (!t['description']) {
        warnings.push(`@type '${t.id}' is missing a description.`);
      }
    }

    return warnings;
  }

  private _detectCycle(
    graph: Record<string, string[]>,
    node: string,
    visited: Set<string>,
    inStack: Set<string>
  ): boolean {
    visited.add(node);
    inStack.add(node);
    for (const neighbor of graph[node] || []) {
      if (!visited.has(neighbor)) {
        if (this._detectCycle(graph, neighbor, visited, inStack)) return true;
      } else if (inStack.has(neighbor)) {
        return true;
      }
    }
    inStack.delete(node);
    return false;
  }

  private _parseSemver(v: string): [number, number, number, string] {
    const core = v.replace(/^[^0-9]*/, '').replace(/[-+].*$/, '');
    const parts = core.split('.').map((n) => parseInt(n, 10) || 0);
    while (parts.length < 3) parts.push(0);
    const pre = v.includes('-') ? v.split('-').slice(1).join('-') : '';
    return [parts[0], parts[1], parts[2], pre];
  }

  private _semverCmp(a: string, b: string): number {
    const pa = this._parseSemver(a);
    const pb = this._parseSemver(b);
    for (let i = 0; i < 3; i++) {
      if (pa[i] !== pb[i]) return (pa[i] as number) - (pb[i] as number);
    }
    if (!pa[3] && pb[3]) return 1;
    if (pa[3] && !pb[3]) return -1;
    return pa[3].localeCompare(pb[3]);
  }

  private _satisfies(v: string, range: string): boolean {
    range = range.trim();
    if (range === '*' || range === 'x' || range === '') return true;
    const caret = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range);
    if (caret) {
      const maj = parseInt(caret[1], 10);
      const min = parseInt(caret[2], 10);
      const pat = parseInt(caret[3], 10);
      if (this._semverCmp(v, range.slice(1)) < 0) return false;
      if (maj > 0) return this._parseSemver(v)[0] === maj;
      if (min > 0) return this._parseSemver(v)[0] === 0 && this._parseSemver(v)[1] === min;
      return this._parseSemver(v)[0] === 0 && this._parseSemver(v)[1] === 0 && this._parseSemver(v)[2] === pat;
    }
    const tilde = /^~(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(range);
    if (tilde) {
      const maj = parseInt(tilde[1], 10);
      const min = tilde[2] !== undefined ? parseInt(tilde[2], 10) : null;
      if (maj > 0 || min !== null) {
        if (this._parseSemver(v)[0] !== maj) return false;
        if (min !== null && this._parseSemver(v)[1] !== min) return false;
        return this._semverCmp(v, `${maj}.${min ?? 0}.0`) >= 0;
      }
      return this._parseSemver(v)[0] === maj;
    }
    const xr = /^(\d+|x|\*)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/.exec(range);
    if (xr && (range.includes('x') || range.includes('*'))) {
      const a = xr[1], b = xr[2], c = xr[3];
      if (a !== 'x' && a !== '*' && this._parseSemver(v)[0] !== parseInt(a, 10)) return false;
      if (b !== undefined && b !== 'x' && b !== '*' && this._parseSemver(v)[1] !== parseInt(b, 10)) return false;
      if (c !== undefined && c !== 'x' && c !== '*' && this._parseSemver(v)[2] !== parseInt(c, 10)) return false;
      return true;
    }
    if (/>=|<=|>|</.test(range)) {
      const comps = range.split(/\s+/).filter(Boolean);
      return comps.every((cmp) => {
        const m = /^(>=|<=|>|<)\s*(\d+\.\d+\.\d+)$/.exec(cmp);
        if (!m) return false;
        const op = m[1];
        const target = m[2];
        const c = this._semverCmp(v, target);
        if (op === '>=') return c >= 0;
        if (op === '<=') return c <= 0;
        if (op === '>') return c > 0;
        return c < 0;
      });
    }
    return this._semverCmp(v, range) === 0;
  }

  private _rangesIntersect(r1: string, r2: string): boolean {
    if (r1 === r2) return true;
    if (r1 === '*' || r1 === 'x' || r2 === '*' || r2 === 'x') return true;
    const exact1 = /^(\d+)\.(\d+)\.(\d+)$/.exec(r1);
    const exact2 = /^(\d+)\.(\d+)\.(\d+)$/.exec(r2);
    if (exact1 && exact2) return r1 === r2;
    if (exact1 && !exact2) return this._satisfies(r1, r2);
    if (!exact1 && exact2) return this._satisfies(r2, r1);
    const versions = ['0.0.0', '1.0.0', '1.5.0', '2.0.0', '2.5.0', '3.0.0'];
    for (const v of versions) {
      if (this._satisfies(v, r1) && this._satisfies(v, r2)) return true;
    }
    return false;
  }

  /** Is `typeName` a registered custom type? */
  public isCustomType(typeName: string): boolean {
    return this.types.has(typeName);
  }
}

/**
 * Parse a single inline object literal of the form
 * `{ name: "id", type: "String", required: true }` into a plain object.
 * Used for `@type` `properties` / `dependencies` lists that the
 * line-based reader stores as raw strings.
 */
function parseInlineObject(literal: string): Record<string, any> {
  const inner = literal.trim().replace(/^\{/, '').replace(/\}$/, '');
  const out: Record<string, any> = {};
  if (!inner.trim()) return out;
  for (const pair of inner.split(',')) {
    const idx = pair.indexOf(':');
    if (idx === -1) continue;
    let key = pair.slice(0, idx).trim();
    let value = pair.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else if (value === 'true') {
      value = true as any;
    } else if (value === 'false') {
      value = false as any;
    }
    out[key] = value;
  }
  return out;
}
