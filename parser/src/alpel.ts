import { AlpObject } from './reader';
import { createHash } from 'crypto';

/**
 * ALP Expression Language (ALPEL, spec/12).
 *
 * A secure, sandboxed, read-only expression language for conditional logic
 * (`!if`, `!assert`, engine conditions) and string interpolation (`${ }`).
 * No mutation, no I/O, deterministic (spec/12 §6).
 *
 * Supported:
 *   - Primitives: strings, numbers, true/false, null
 *   - Property access: `task.feature.name`, `feature.metadata['k']`
 *   - Comparison: == != < > <= >=
 *   - Logical: && || !
 *   - Math: + - * /
 *   - Collection: in, contains
 *   - Built-ins: length, toUpper, toLower, startsWith, size, isEmpty,
 *               hasStatus
 *   - Namespace built-ins (v10.3.0): date.*, math.*, crypto.*, string.*
 *   - Module imports (v10.3.0): `import('name')` for shared ALPEL snippets
 *   - Interpolation: `${ expr }` within string values
 */

export type AlpelValue = string | number | boolean | null | AlpelValue[] | { [k: string]: AlpelValue };

export interface EvalContext {
  [key: string]: AlpelValue;
}

const CONTEXT_KEYS = ['project', 'task', 'feature', 'agent', 'env', 'state'];
const NS_PREFIX = '__ALPEL_NS__:';
const NAMESPACE_NAMES = ['date', 'math', 'crypto', 'string'] as const;

// ── Tokenizer ──

type Token =
  | { t: string; v: any }
  | { t: 'lbrace'; v: string }
  | { t: 'rbrace'; v: string };

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    if (ch === '(' ) { tokens.push({ t: 'lp', v: '(' }); i++; continue; }
    if (ch === ')' ) { tokens.push({ t: 'rp', v: ')' }); i++; continue; }
    if (ch === ',' ) { tokens.push({ t: 'comma', v: ',' }); i++; continue; }
    if (ch === ':' ) { tokens.push({ t: 'colon', v: ':' }); i++; continue; }
    if (ch === '[' ) { tokens.push({ t: 'lb', v: '[' }); i++; continue; }
    if (ch === ']' ) { tokens.push({ t: 'rb', v: ']' }); i++; continue; }
    if (ch === '.' ) { tokens.push({ t: 'dot', v: '.' }); i++; continue; }
    if (ch === '{' ) { tokens.push({ t: 'lbrace', v: '{' }); i++; continue; }
    if (ch === '}' ) { tokens.push({ t: 'rbrace', v: '}' }); i++; continue; }
    if (ch === '&' && expr[i + 1] === '&') { tokens.push({ t: 'op', v: '&&' }); i += 2; continue; }
    if (ch === '|' && expr[i + 1] === '|') { tokens.push({ t: 'op', v: '||' }); i += 2; continue; }
    if (ch === '=' && expr[i + 1] === '=') { tokens.push({ t: 'op', v: '==' }); i += 2; continue; }
    if (ch === '!' && expr[i + 1] === '=') { tokens.push({ t: 'op', v: '!=' }); i += 2; continue; }
    if (ch === '<' && expr[i + 1] === '=') { tokens.push({ t: 'op', v: '<=' }); i += 2; continue; }
    if (ch === '>' && expr[i + 1] === '=') { tokens.push({ t: 'op', v: '>=' }); i += 2; continue; }
    if (ch === '=' || ch === '<' || ch === '>') { tokens.push({ t: 'op', v: ch }); i++; continue; }
    if (ch === '!' ) { tokens.push({ t: 'op', v: '!' }); i++; continue; }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') { tokens.push({ t: 'op', v: ch }); i++; continue; }
    if (ch === '"' || ch === "'") {
      const start = i;
      i++;
      while (i < expr.length && expr[i] !== ch) i++;
      i++;
      tokens.push({ t: 'str', v: expr.slice(start + 1, i - 1) });
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '-' && /[0-9]/.test(expr[i + 1] || ''))) {
      const start = i;
      i++;
      while (i < expr.length && /[0-9.]/.test(expr[i])) i++;
      tokens.push({ t: 'num', v: Number(expr.slice(start, i)) });
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      const start = i;
      i++;
      while (i < expr.length && /[a-zA-Z0-9_]/.test(expr[i])) i++;
      const word = expr.slice(start, i);
      if (word === 'true') { tokens.push({ t: 'bool', v: true }); }
      else if (word === 'false') { tokens.push({ t: 'bool', v: false }); }
      else if (word === 'null') { tokens.push({ t: 'null', v: null }); }
      else if (word === 'in') { tokens.push({ t: 'op', v: word }); }
      else { tokens.push({ t: 'id', v: word }); }
      continue;
    }
    throw new Error(`ALPEL: unexpected character '${ch}'`);
  }
  return tokens;
}

// ── Parser (Pratt-ish, precedence: || < && < comparison < +/- < *// < unary ! < primary) ──

export class AlpelError extends Error {}

function parseExpr(tokens: Token[]): (ctx: EvalContext) => AlpelValue {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseOr(): (c: EvalContext) => AlpelValue {
    let left = parseAnd();
    while (peek()?.t === 'op' && peek().v === '||') {
      next();
      const right = parseAnd();
      const l = left;
      left = (c) =>Boolean((l(c) || right(c)));
    }
    return left;
  }
  function parseAnd(): (c: EvalContext) => AlpelValue {
    let left = parseComparison();
    while (peek()?.t === 'op' && peek().v === '&&') {
      next();
      const right = parseComparison();
      const l = left;
      left = (c) => Boolean(l(c) && right(c));
    }
    return left;
  }
  function parseComparison(): (c: EvalContext) => AlpelValue {
    const left = parseAdd();
    const op = peek();
    if (op?.t === 'op' && ['==', '!=', '<', '>', '<=', '>='].includes(op.v)) {
      next();
      const right = parseAdd();
      const l = left;
      return (c) => compare(l(c), op.v as string, right(c));
    }
    if (op?.t === 'op' && op.v === 'in') {
      next();
      const right = parseAdd();
      const l = left;
      return (c) => {
        const a = l(c), b = right(c);
        if (Array.isArray(b)) return b.some((x) => alpEquals(x, a));
        if (typeof b === 'string' && typeof a === 'string') return b.includes(a);
        return false;
      };
    }
    return left;
  }
  function parseAdd(): (c: EvalContext) => AlpelValue {
    let left = parseMul();
    while (peek()?.t === 'op' && (peek().v === '+' || peek().v === '-')) {
      const v = (next() as any).v;
      const right = parseMul();
      const l = left;
      left = (c) => {
        const a = l(c), b = right(c);
        if (typeof a === 'number' && typeof b === 'number') return v === '+' ? a + b : a - b;
        if (typeof a === 'string') return a + String(b); // string concat
        throw new AlpelError('ALPEL: + / - require numbers or a string');
      };
    }
    return left;
  }
  function parseMul(): (c: EvalContext) => AlpelValue {
    let left = parseUnary();
    while (peek()?.t === 'op' && (peek().v === '*' || peek().v === '/')) {
      const v = (next() as any).v;
      const right = parseUnary();
      const l = left;
      left = (c) => {
        const a = l(c), b = right(c);
        if (typeof a === 'number' && typeof b === 'number') return v === '*' ? a * b : a / b;
        throw new AlpelError('ALPEL: * / require numbers');
      };
    }
    return left;
  }
  function parseUnary(): (c: EvalContext) => AlpelValue {
    if (peek()?.t === 'op' && peek().v === '!') {
      next();
      const inner = parseUnary();
      return (c) => !truthy(inner(c));
    }
    if (peek()?.t === 'op' && peek().v === '-') {
      next();
      const inner = parseUnary();
      return (c) => {
        const v = inner(c);
        if (typeof v === 'number') return -v;
        throw new AlpelError('ALPEL: unary - requires a number');
      };
    }
    if (peek()?.t === 'op' && peek().v === '+') {
      next();
      return parseUnary();
    }
    return parsePostfix();
  }
  function parsePostfix(): (c: EvalContext) => AlpelValue {
    let node = parsePrimary();
    let isName = (node as any).__id != null;
    while (true) {
      if (peek()?.t === 'dot') {
        next();
        const id = next();
        if (id?.t !== 'id') throw new AlpelError('ALPEL: expected property after .');
        const base = node;
        const name = (id as any).v;
        node = (c) => getProp(base(c), name);
        (node as any).__id = name;
        (node as any).__base = base;
        isName = true;
      } else if (peek()?.t === 'lb') {
        // bracket access obj['k'] / arr[0] — always (never a call; calls use `(`).
        next();
        const keyTok = peek();
        let key: AlpelValue;
        if (keyTok?.t === 'str' || keyTok?.t === 'id' || keyTok?.t === 'num') {
          key = (next() as any).v;
        } else {
          key = (parseOr() as any) as AlpelValue;
        }
        if (peek()?.t !== 'rb') throw new AlpelError("ALPEL: expected ]");
        next();
        const base = node;
        node = (c) => getProp(base(c), key as any);
        isName = false;
      } else if (peek()?.t === 'lp') {
        if (!isName) {
          next();
          const e = parseOr();
          if (peek()?.t !== 'rp') throw new AlpelError('ALPEL: expected )');
          next();
          node = e;
        } else {
          next();
          const fnName = (node as any).__id;
          const base = (node as any).__base;
          const args: ((c: EvalContext) => AlpelValue)[] = [];
          if (peek()?.t !== 'rp') {
            args.push(parseOr());
            while (peek()?.t === 'comma') { next(); args.push(parseOr()); }
          }
          if (peek()?.t !== 'rp') throw new AlpelError('ALPEL: expected )');
          next();
          if (base) {
            node = (c) => callFn(fnName, [base(c), ...args.map((a) => a(c))]);
          } else {
            node = (c) => callFn(fnName, args.map((a) => a(c)));
          }
        }
        isName = false;
      } else {
        break;
      }
    }
    return node;
  }
  function parsePrimary(): (c: EvalContext) => AlpelValue {
    const tok = peek();
    if (!tok) throw new AlpelError('ALPEL: unexpected end of expression');
    if (tok.t === 'lp') {
      next();
      const e = parseOr();
      if (peek()?.t !== 'rp') throw new AlpelError('ALPEL: expected )');
      next();
      return e;
    }
    if (tok.t === 'lb') {
      next();
      const items: ((c: EvalContext) => AlpelValue)[] = [];
      if (peek()?.t !== 'rb') {
        items.push(parseOr());
        while (peek()?.t === 'comma') { next(); items.push(parseOr()); }
      }
      if (peek()?.t !== 'rb') throw new AlpelError("ALPEL: expected ]");
      next();
      return (c) => items.map((a) => a(c));
    }
    if (tok.t === 'lbrace') {
      next();
      const obj: Record<string, AlpelValue> = {};
      if (peek()?.t !== 'rbrace') {
        while (true) {
          const keyTok = next();
          const key = keyTok?.t === 'str' ? String(keyTok.v)
            : keyTok?.t === 'id' ? String(keyTok.v) : null;
          if (key == null) throw new AlpelError("ALPEL: expected object key");
          if (peek()?.t !== 'colon') throw new AlpelError("ALPEL: expected :");
          next();
          const val = parseOr();
          (obj as any)[key] = val;
          if (peek()?.t === 'comma') { next(); continue; }
          break;
        }
      }
      if (peek()?.t !== 'rbrace') throw new AlpelError("ALPEL: expected }");
      next();
      return (c) => {
        const result: Record<string, AlpelValue> = {};
        for (const k of Object.keys(obj)) {
          result[k] = (obj as any)[k](c);
        }
        return result;
      };
    }
    if (tok.t === 'num') { next(); return () => tok.v; }
    if (tok.t === 'str') { next(); return () => tok.v; }
    if (tok.t === 'bool') { next(); return () => tok.v; }
    if (tok.t === 'null') { next(); return () => null; }
    if (tok.t === 'id') {
      next();
      const node = (c: EvalContext) => resolveId(c, tok.v as string);
      (node as any).__id = tok.v;
      return node;
    }
    throw new AlpelError(`ALPEL: unexpected token '${JSON.stringify(tok)}'`);
  }

  return parseOr();
}

// ── Evaluation helpers ──

function truthy(v: AlpelValue): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return v != null;
}

function compare(a: AlpelValue, op: string, b: AlpelValue): boolean {
  if (op === '==') return alpEquals(a, b);
  if (op === '!=') return !alpEquals(a, b);
  if (op === '<' || op === '>' || op === '<=' || op === '>=') {
    const av = typeof a === 'number' || typeof a === 'string' ? a : null;
    const bv = typeof b === 'number' || typeof b === 'string' ? b : null;
    if (av == null || bv == null) throw new AlpelError('ALPEL: < > <= >= need comparable values');
    if (av < bv) return op === '<' || op === '<=';
    if (av > bv) return op === '>' || op === '>=';
    return op === '<=' || op === '>=';
  }
  throw new AlpelError(`ALPEL: unknown comparison '${op}'`);
}

function alpEquals(a: AlpelValue, b: AlpelValue): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  if (typeof a === 'string' && typeof b === 'string') return a === b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b;
  if (a == null && b == null) return true;
  return false;
}

function getProp(base: AlpelValue, key: string | number): AlpelValue {
  if (base == null) return null;
  if (Array.isArray(base)) {
    if (key === 'size') return base.length;
    if (key === 'isEmpty') return base.length === 0;
    return (base as AlpelValue[])[key as number] ?? null;
  }
  if (typeof base === 'object') {
    const o = base as { [k: string]: AlpelValue };
    if (key === 'size') return Object.keys(o).length;
    if (key === 'isEmpty') return Object.keys(o).length === 0;
    return o[key as string] ?? null;
  }
  return null;
}

function resolveId(ctx: EvalContext, name: string): AlpelValue {
  if (name in ctx) return ctx[name];
  if (NAMESPACE_NAMES.includes(name as any)) return NS_PREFIX + name;
  for (const k of CONTEXT_KEYS) {
    const c = ctx[k];
    if (c && typeof c === 'object' && !Array.isArray(c) && name in (c as object)) {
      return (c as any)[name];
    }
  }
  throw new AlpelError(`ALPEL: unknown identifier '${name}'`);
}

function callNsFn(ns: string, name: string, args: AlpelValue[]): AlpelValue {
  switch (ns) {
    case 'date': return callDateFn(name, args);
    case 'math': return callMathFn(name, args);
    case 'crypto': return callCryptoFn(name, args);
    case 'string': return callStringFn(name, args);
    default: throw new AlpelError(`ALPEL: unknown namespace '${ns}'`);
  }
}

function utcIso(dt: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
    + `T${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}:${pad(dt.getUTCSeconds())}+00:00`;
}

function callDateFn(name: string, args: AlpelValue[]): AlpelValue {
  switch (name) {
    case 'now': return new Date().toISOString();
    case 'formatDate': {
      const d = args[0];
      const fmt = args[1];
      if (typeof d !== 'string' || typeof fmt !== 'string') return '';
      if (fmt === 'iso') return d;
      const dt = new Date(d);
      if (isNaN(dt.getTime())) return d;
      const pad = (n: number) => String(n).padStart(2, '0');
      if (fmt === 'date') return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
      if (fmt === 'time') return `${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}:${pad(dt.getUTCSeconds())}`;
      return d;
    }
    case 'parseDate': {
      const s = args[0];
      if (typeof s !== 'string') return '';
      const dt = new Date(s);
      return isNaN(dt.getTime()) ? s : utcIso(dt);
    }
    case 'addDays': {
      const d = args[0];
      const n = args[1];
      if (typeof d !== 'string' || typeof n !== 'number') return '';
      const dt = new Date(d);
      if (isNaN(dt.getTime())) return d;
      dt.setUTCDate(dt.getUTCDate() + n);
      return utcIso(dt);
    }
    default: throw new AlpelError(`ALPEL: date.${name} is undefined`);
  }
}

function callMathFn(name: string, args: AlpelValue[]): AlpelValue {
  const a = args[0];
  switch (name) {
    case 'round': return Math.round(a as number);
    case 'floor': return Math.floor(a as number);
    case 'ceil': return Math.ceil(a as number);
    case 'min': return Math.min(a as number, (args[1] as number) ?? 0);
    case 'max': return Math.max(a as number, (args[1] as number) ?? 0);
    case 'abs': return Math.abs(a as number);
    default: throw new AlpelError(`ALPEL: math.${name} is undefined`);
  }
}

function callCryptoFn(name: string, args: AlpelValue[]): AlpelValue {
  const s = String(args[0] ?? '');
  switch (name) {
    case 'sha256': return createHash('sha256').update(s, 'utf8').digest('hex');
    case 'base64': return Buffer.from(s, 'utf8').toString('base64');
    case 'base64Decode': return Buffer.from(s, 'base64').toString('utf8');
    default: throw new AlpelError(`ALPEL: crypto.${name} is undefined`);
  }
}

function callStringFn(name: string, args: AlpelValue[]): AlpelValue {
  const a = args[0];
  switch (name) {
    case 'trim': return typeof a === 'string' ? a.trim() : String(a);
    case 'replace': {
      const str = typeof a === 'string' ? a : String(a);
      const old = typeof args[1] === 'string' ? args[1] : String(args[1]);
      const rep = typeof args[2] === 'string' ? args[2] : String(args[2]);
      return str.split(old).join(rep);
    }
    case 'split': {
      const str = typeof a === 'string' ? a : String(a);
      const delim = typeof args[1] === 'string' ? args[1] : String(args[1]);
      return str.split(delim);
    }
    case 'join': {
      const arr = Array.isArray(a) ? a : [];
      const delim = typeof args[1] === 'string' ? args[1] : String(args[1]);
      return arr.map((x) => String(x)).join(delim);
    }
    case 'endsWith': {
      const str = typeof a === 'string' ? a : String(a);
      const suf = typeof args[1] === 'string' ? args[1] : String(args[1]);
      return str.endsWith(suf);
    }
    default: throw new AlpelError(`ALPEL: string.${name} is undefined`);
  }
}

// ── Module imports (v10.3.0): shared ALPEL snippets ──

const MODULES: Record<string, Record<string, AlpelValue>> = {};

/** Register a named module of reusable constants/snippets for ALPEL `import()`. */
export function registerModule(name: string, defs: Record<string, AlpelValue>): void {
  MODULES[name] = defs;
}

/** Retrieve a registered module object (property-accessible in ALPEL). */
export function importModule(name: string): Record<string, AlpelValue> {
  const m = MODULES[name];
  if (!m) throw new AlpelError(`ALPEL: module '${name}' is not registered`);
  return m;
}

function callFn(name: string, args: AlpelValue[]): AlpelValue {
  const a = args[0];
  if (name === 'import') {
    const modName = typeof a === 'string' ? a : '';
    return importModule(modName);
  }
  if (typeof a === 'string' && a.startsWith(NS_PREFIX)) {
    const ns = a.slice(NS_PREFIX.length);
    return callNsFn(ns, name, args.slice(1));
  }
  switch (name) {
    case 'length':
      return typeof a === 'string' ? a.length : Array.isArray(a) ? a.length : 0;
    case 'toUpper':
      return typeof a === 'string' ? a.toUpperCase() : String(a);
    case 'toLower':
      return typeof a === 'string' ? a.toLowerCase() : String(a);
    case 'startsWith':
      return typeof a === 'string' && typeof args[1] === 'string'
        ? a.startsWith(args[1] as string)
        : false;
    case 'size':
      return Array.isArray(a) ? a.length : typeof a === 'object' && a ? Object.keys(a).length : 0;
    case 'isEmpty':
      return Array.isArray(a) ? a.length === 0 : !(a && Object.keys(a as any).length);
    case 'contains':
      if (Array.isArray(a)) return a.some((x) => alpEquals(x, args[1]));
      if (typeof a === 'string' && typeof args[1] === 'string') return a.includes(args[1] as string);
      return false;
    case 'hasStatus':
      if (Array.isArray(a)) return (a as any[]).some((t: any) => t && t.status === args[1]);
      return false;
    default:
      throw new AlpelError(`ALPEL: unknown function '${name}'`);
  }
}

// ── Public API ──

/** Build an evaluation context from the surrounding ALP objects. */
export function buildContext(obj: AlpObject | null, extra: EvalContext = {}): EvalContext {
  const ctx: EvalContext = {};
  if (obj) ctx[obj._type] = obj as unknown as AlpelValue;
  for (const k of CONTEXT_KEYS) {
    const v = (obj as any)?.[k];
    if (v != null) ctx[k] = v;
  }
  return { ...ctx, ...extra };
}

/** Evaluate an ALPEL boolean/value expression against a context. */
export function evaluate(expr: string, ctx: EvalContext): AlpelValue {
  const tokens = tokenize(expr);
  const fn = parseExpr(tokens);
  return fn(ctx);
}

/** Evaluate as a boolean (for `!if` / `!assert`). */
export function evaluateBool(expr: string, ctx: EvalContext): boolean {
  return truthy(evaluate(expr, ctx));
}

const INTERP_RE = /\$\{\s*([^}]+?)\s*\}/g;

/**
 * Expand `${ expr }` interpolations in a string value using an ALPEL context.
 * Unknown identifiers are left as empty strings (deterministic, no throw).
 */
export function interpolate(value: string, ctx: EvalContext): string {
  return value.replace(INTERP_RE, (_m, expr) => {
    try {
      const v = evaluate(String(expr).trim(), ctx);
      if (v == null) return '';
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
      return JSON.stringify(v);
    } catch {
      return '';
    }
  });
}
