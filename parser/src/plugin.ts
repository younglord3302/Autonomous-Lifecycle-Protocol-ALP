import * as fs from 'fs';
import * as path from 'path';
import { AlpReader, AlpObject } from './reader';
import { SyntaxError, ValidationError } from './error';
import { RemoteFetcher, FetchOptions } from './remote';

/**
 * ALP Plugin System (v6.5.0).
 *
 * Resolves file-level `!import` directives (spec/11): local `.alp` files
 * relative to the `.alp/` workspace root (§3.1), remote HTTPS URLs with
 * caching + integrity (§3.2–3.4), and registry aliases `@ns/name@version`
 * (§3.5). Builds a registry of custom types from `@type_definition` blocks
 * (§2) and validates custom-type instances (§4.1).
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
  'state', 'workflow', 'policy', 'macro', 'plugin', 'type_definition',
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

  private reader = new AlpReader();
  private visited = new Set<string>();
  private fetcher: RemoteFetcher;
  private fetcherOptions: FetchOptions = {};

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
    options: FetchOptions = {}
  ): Promise<AlpObject[]> {
    this.fetcher = new RemoteFetcher(rootDir);
    this.fetcherOptions = { ...this.fetcherOptions, ...options };
    this.types.clear();
    this.plugins.clear();
    this.objects = [];
    this.visited.clear();
    await this.resolveFile(content, rootDir, rootDir, 0);
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
    depth: number
  ): Promise<void> {
    if (depth > 5) {
      throw new SyntaxError('Maximum local import depth (5) exceeded.');
    }

    // Intercept `!import` directives by pre-scanning file-level lines.
    const lines = content.split('\n');
    let body = '';
    for (const raw of lines) {
      const trimmed = raw.trim();
        if (trimmed.startsWith('!import')) {
          const { target, integrity } = this.extractImport(trimmed);
          if (/^https?:\/\//.test(target) || target.startsWith('@')) {
          const remoteContent = await this.fetcher.fetchImport(target, {
            ...this.fetcherOptions,
            integrity,
          });
          await this.resolveFile(remoteContent, fileDir, rootDir, depth + 1);
        } else {
          const resolved = this.resolveLocalImport(target, fileDir, rootDir);
          await this.resolveFile(
            fs.readFileSync(resolved, 'utf8'),
            path.dirname(resolved),
            rootDir,
            depth + 1
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
      } else if (obj._type === 'type_definition') {
        this.registerType(obj);
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

  private registerType(obj: AlpObject): void {
    const typeName = obj['type_name'] as string;
    if (!typeName) {
      throw new ValidationError(`@type_definition '${obj.id}' missing type_name`);
    }
    if (CORE_TYPES.has(typeName)) {
      throw new ValidationError(
        `@type_definition '${obj.id}' redefines core type '${typeName}'`
      );
    }
    const rawProps = Array.isArray(obj['properties']) ? obj['properties'] : [];
    const properties: TypeProperty[] = rawProps.map((p: any) => {
      // List items may be literal objects `{ name: "id", type: "String", required: true }`
      // (the common spec form) or already-parsed objects.
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
          `Unknown property '${key}' in @${obj._type} '${obj.id}' (not in type_definition)`
        );
      }
    }
  }

  /** Is `typeName` a registered custom type? */
  public isCustomType(typeName: string): boolean {
    return this.types.has(typeName);
  }
}

/**
 * Parse a single inline object literal of the form
 * `{ name: "id", type: "String", required: true }` into a plain object.
 * Used for `@type_definition` `properties` / `dependencies` lists that the
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
