import { AlpObject } from './reader';

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
 *   - Interpolation: `${ expr }` within string values
 */

export type AlpelValue = string | number | boolean | null | AlpelValue[] | { [k: string]: AlpelValue };

export interface EvalContext {
  [key: string]: AlpelValue;
}

const CONTEXT_KEYS = ['project', 'task', 'feature', 'agent', 'env', 'state'];

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
          const args: ((c: EvalContext) => AlpelValue)[] = [];
          if (peek()?.t !== 'rp') {
            args.push(parseOr());
            while (peek()?.t === 'comma') { next(); args.push(parseOr()); }
          }
          if (peek()?.t !== 'rp') throw new AlpelError('ALPEL: expected )');
          next();
          node = (c) => callFn(fnName, args.map((a) => a(c)));
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
      return () => obj;
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
  // search context objects (task.feature.name → task.feature.name)
  for (const k of CONTEXT_KEYS) {
    const c = ctx[k];
    if (c && typeof c === 'object' && !Array.isArray(c) && name in (c as object)) {
      return (c as any)[name];
    }
  }
  throw new AlpelError(`ALPEL: unknown identifier '${name}'`);
}

function callFn(name: string, args: AlpelValue[]): AlpelValue {
  const a = args[0];
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
