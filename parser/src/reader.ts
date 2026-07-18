import { SyntaxError, IndentationError, DirectiveError } from './error';

export interface AlpObject {
  _type: string;
  [key: string]: any;
}

/**
 * Minimal ALPEL-style boolean expression evaluator for directives
 * (`!if`, `!assert`). Supports literals (numbers, "strings", true/false),
 * identifiers resolved against a context object, comparisons
 * (== != > < >= <=), logical and/or/not (&& || !), and parentheses.
 */
function evalExpr(expr: string, ctx: Record<string, any>): boolean {
  const tokens = tokenize(expr);
  let pos = 0;

  function peek(): string | undefined { return tokens[pos]; }
  function next(): string | undefined { return tokens[pos++]; }

  function parseOr(): any {
    let left = parseAnd();
    while (peek() === '||') { next(); const right = parseAnd(); left = left || right; }
    return left;
  }
  function parseAnd(): any {
    let left = parseComparison();
    while (peek() === '&&') { next(); const right = parseComparison(); left = left && right; }
    return left;
  }
  function parseComparison(): any {
    const left = parseNot();
    const op = peek();
    if (op === '==' || op === '!=' || op === '>=' || op === '<=' || op === '>' || op === '<') {
      next();
      const right = parseNot();
      switch (op) {
        case '==': return left === right;
        case '!=': return left !== right;
        case '>': return left > right;
        case '<': return left < right;
        case '>=': return left >= right;
        case '<=': return left <= right;
      }
    }
    return left;
  }
  function parseNot(): any {
    if (peek() === '!') { next(); return !coerceBool(parsePrimary()); }
    return parsePrimary();
  }
  function parsePrimary(): any {
    if (peek() === '(') { next(); const v = parseOr(); if (next() !== ')') throw new Error('Unbalanced parenthesis'); return v; }
    const tok = next();
    if (tok === undefined) throw new Error('Unexpected end of expression');
    if (tok.startsWith('"') || tok.startsWith("'")) return tok.slice(1, -1);
    if (tok === 'true') return true;
    if (tok === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(tok)) return Number(tok);
    if (tok in ctx) return ctx[tok];
    throw new Error(`Unknown identifier '${tok}'`);
  }

  const result = parseOr();
  if (pos < tokens.length) throw new Error(`Unexpected token '${tokens[pos]}'`);
  return coerceBool(result);
}

function coerceBool(v: any): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0;
  return Boolean(v);
}

function tokenize(expr: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (ch === ' ' || ch === '\t') { i++; continue; }
    if (ch === '(' || ch === ')' || ch === '|' || ch === '&' || ch === '!') {
      // multi-char operators
      if ((ch === '|' && expr[i + 1] === '|') || (ch === '&' && expr[i + 1] === '&')) {
        tokens.push(ch + expr[i + 1]); i += 2; continue;
      }
      if (ch === '|' || ch === '&') throw new Error(`Unsupported operator '${ch}' (use || / &&)`);
      tokens.push(ch); i++; continue;
    }
    if (ch === '=' || ch === '>' || ch === '<') {
      let op = ch;
      if (expr[i + 1] === '=') op += '=';
      tokens.push(op); i += op.length; continue;
    }
    if (ch === '"' || ch === "'") {
      const start = i;
      i++;
      while (i < expr.length && expr[i] !== ch) i++;
      i++; // include closing quote
      tokens.push(expr.slice(start, i));
      continue;
    }
    // identifier or number
    const start = i;
    while (i < expr.length && /[A-Za-z0-9_.]/.test(expr[i])) i++;
    tokens.push(expr.slice(start, i));
  }
  return tokens;
}

function exprContext(obj: AlpObject | null): Record<string, any> {
  const ctx: Record<string, any> = { alp_version: '2.0.0' };
  if (obj) {
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') ctx[k] = v;
    }
  }
  return ctx;
}

/**
 * Count the number of leading spaces on a line.
 */
function leadingSpaces(line: string): number {
  let count = 0;
  for (const ch of line) {
    if (ch === ' ') count++;
    else break;
  }
  return count;
}

export class AlpReader {
  /**
   * Non-fatal notices collected during the most recent parse (e.g.
   * `!deprecated` directives). Callers may inspect this after `parse`.
   */
  public warnings: string[] = [];
  private declaredVersion = '';
  private skipPending = false;
  private currentObject: AlpObject | null = null;
  private currentObjectSkipped = false;
  private currentNestedBlock: string | null = null;
  private currentListProp: string | null = null;

  /**
   * Reads an .alp file content and returns an array of parsed objects.
   * This is a simplified line-by-line parser for the MVP.
   */
  public parse(content: string): AlpObject[] {
    const lines = content.split('\n');
    const objects: AlpObject[] = [];
    this.warnings = [];
    this.skipPending = false;
    this.declaredVersion = '';
    this.currentObject = null;
    this.currentObjectSkipped = false;
    this.currentNestedBlock = null;
    this.currentListProp = null;

    for (let i = 0; i < lines.length; i++) {
      const lineStr = lines[i];
      const lineNum = i + 1;

      // Check for tab characters (spec 16.4)
      if (lineStr.includes('\t')) {
        throw new IndentationError(
          'Tab characters are not allowed. Use spaces for indentation.',
          lineNum,
          lineStr.indexOf('\t') + 1
        );
      }

      const trimmed = lineStr.trim();

      // Skip empty lines, comments, and markdown separators
      if (!trimmed || trimmed.startsWith('//') || trimmed === '---') {
        continue;
      }

      const indent = leadingSpaces(lineStr);

      // ── Level 0: Directives and top-level block markers ──

      // Directives (e.g., !alp-version: 2.0.0, !if, !assert, !deprecated)
      if (trimmed.startsWith('!') && indent === 0) {
        this.handleDirective(trimmed, lineNum);
        continue;
      }

      // Top-level block markers (e.g., @project, @task)
      if (trimmed.startsWith('@') && indent === 0) {
        const typeMatch = trimmed.match(/^@([a-z_]+)$/);
        if (!typeMatch) {
          throw new SyntaxError(`Invalid block marker: '${trimmed}'`, lineNum);
        }
        if (this.skipPending) {
          this.skipPending = false;
          // Discard this object: read its body into a throwaway that is
          // never committed to `objects`.
          this.currentObject = { _type: typeMatch[1] };
          this.currentObjectSkipped = true;
          this.currentNestedBlock = null;
          this.currentListProp = null;
          continue;
        }
        if (this.currentObject && !this.currentObjectSkipped) {
          objects.push(this.currentObject);
        }
        this.currentObject = { _type: typeMatch[1] };
        this.currentObjectSkipped = false;
        this.currentNestedBlock = null;
        this.currentListProp = null;
        continue;
      }

      // ── Level 1 (indent=2): Properties and nested block markers ──

      if (indent === 2 && this.currentObject) {
        // Nested block markers (e.g., @accept, @verify inside a task)
        if (trimmed.startsWith('@')) {
          const nestedMatch = trimmed.match(/^@([a-z_]+)$/);
          if (!nestedMatch) {
            throw new SyntaxError(`Invalid nested block marker: '${trimmed}'`, lineNum);
          }
          this.currentNestedBlock = nestedMatch[1];
          this.currentObject[this.currentNestedBlock] = [];
          this.currentListProp = null;
          continue;
        }

        // List property (e.g., tasks:)
        const listPropMatch = trimmed.match(/^([a-z_]+):$/);
        if (listPropMatch) {
          this.currentListProp = listPropMatch[1];
          this.currentObject[this.currentListProp] = [];
          this.currentNestedBlock = null;
          continue;
        }

        // Property assignments (e.g., id: my-task or !fail-strategy: rollback)
        const propMatch = trimmed.match(/^([a-z_!][a-z0-9_-]*):\s*(.*)$/);
        if (propMatch) {
          let key = propMatch[1];
          let value = propMatch[2];

          // Normalize directive properties by stripping the ! so they map to JSON Schema correctly
          if (key.startsWith('!')) {
             key = key.substring(1).replace(/-/g, '_');
          }

          // Remove quotes if present
          if (value.startsWith('"') && value.endsWith('"')) {
            value = value.substring(1, value.length - 1);
          } else if (value.startsWith('"') && !value.endsWith('"')) {
            throw new SyntaxError('Unclosed string literal', lineNum);
          }

          this.currentObject[key] = value;
          this.currentNestedBlock = null;
          this.currentListProp = null;
          continue;
        }

        throw new SyntaxError(`Invalid property format: '${trimmed}'`, lineNum);
      }

      // ── Level 2 (indent=4): List items and nested properties ──

      if (indent === 4 && this.currentObject && (this.currentNestedBlock || this.currentListProp)) {
        // List items
        if (trimmed.startsWith('- ')) {
          let val = trimmed.substring(2).trim();
          // Strip surrounding quotes so list values (e.g. `verify` shell
          // commands) match the unquoting applied to scalar properties.
          if (val.length >= 2 &&
              ((val.startsWith('"') && val.endsWith('"')) ||
               (val.startsWith("'") && val.endsWith("'")))) {
            val = val.substring(1, val.length - 1);
          }
          if (this.currentNestedBlock) {
             if (Array.isArray(this.currentObject[this.currentNestedBlock])) {
                this.currentObject[this.currentNestedBlock].push(val);
             }
          } else if (this.currentListProp) {
             if (Array.isArray(this.currentObject[this.currentListProp])) {
                this.currentObject[this.currentListProp].push(val);
             }
          }
          continue;
        }

        // Nested properties (e.g., limits block in agents)
        const nestedPropMatch = trimmed.match(/^([a-z_][a-z0-9_-]*):\s*(.*)$/);
        if (nestedPropMatch && this.currentListProp) {
           // We convert currentListProp from array to object if it's the first nested property
           if (Array.isArray(this.currentObject[this.currentListProp])) {
               this.currentObject[this.currentListProp] = {};
           }
           let key = nestedPropMatch[1];
           let value = nestedPropMatch[2];

           if (value.startsWith('"') && value.endsWith('"')) {
             value = value.substring(1, value.length - 1);
           }

           // Numeric conversion for limits/thresholds
           if (!isNaN(Number(value))) {
              this.currentObject[this.currentListProp][key] = Number(value);
           } else {
              this.currentObject[this.currentListProp][key] = value;
           }
           continue;
        }

        throw new SyntaxError(`Invalid list item or nested property format: '${trimmed}'`, lineNum);
      }

      // ── Invalid indentation ──

      // If we're inside an object and the indentation is wrong, report it
      if (this.currentObject && indent > 0) {
        if (indent === 1 || indent === 3 || (indent > 4 && indent % 2 !== 0)) {
          throw new IndentationError(
            `Invalid indentation: ${indent} spaces. Properties must be indented by exactly 2 spaces.`,
            lineNum
          );
        }
        // Even indent but unexpected level
        throw new IndentationError(
          `Unexpected indentation level: ${indent} spaces`,
          lineNum
        );
      }

      // If we're outside any block and there's non-zero indent, that's an error
      if (!this.currentObject && indent > 0) {
        throw new IndentationError(
          'Unexpected indentation outside of a block',
          lineNum
        );
      }

      throw new SyntaxError(`Unrecognized syntax: '${trimmed}'`, lineNum);
    }

    if (this.currentObject && !this.currentObjectSkipped) {
      objects.push(this.currentObject);
    }

    return objects;
  }

  /**
   * Handle a top-level directive line. Supports:
   *   !alp-version: 2.0.0   — records the declared version (context for !if)
   *   !if <expr>            — if the expression is false, the next block is skipped
   *   !assert <expr>        — throws DirectiveError when the expression is false
   *   !deprecated: "msg"    — records a non-fatal deprecation warning
   *   !import <target>      — deferred to V6.6 (federation); recognised, no-op for now
   */
  private handleDirective(line: string, lineNum: number): void {
    const trimmed = line.replace(/^!/, '').trim();

    // !alp-version: 2.0.0
    let m = trimmed.match(/^alp-version:\s*(.+)$/);
    if (m) {
      this.declaredVersion = m[1].trim().replace(/^"|"$/g, '');
      return;
    }

    // !if <expr>  (expr may be unquoted or after a colon)
    m = trimmed.match(/^if(?::|\s)\s*(.+)$/);
    if (m) {
      const result = evalExpr(m[1].trim(), exprContext(this.currentObject));
      if (!result) this.skipPending = true;
      return;
    }

    // !assert <expr>
    m = trimmed.match(/^assert(?::|\s)\s*(.+)$/);
    if (m) {
      const result = evalExpr(m[1].trim(), exprContext(this.currentObject));
      if (!result) {
        throw new DirectiveError(`!assert failed: ${m[1].trim()}`, lineNum);
      }
      return;
    }

    // !deprecated: "message"
    m = trimmed.match(/^deprecated(?::|\s)\s*(.+)$/);
    if (m) {
      let msg = m[1].trim();
      if ((msg.startsWith('"') && msg.endsWith('"')) || (msg.startsWith("'") && msg.endsWith("'"))) {
        msg = msg.slice(1, -1);
      }
      this.warnings.push(`Deprecation (line ${lineNum}): ${msg}`);
      return;
    }

    // !import <target> — federation (V6.6). Recognised, not yet resolved.
    m = trimmed.match(/^import(?::|\s)\s*(.+)$/);
    if (m) {
      this.warnings.push(`!import is not yet resolved by the parser (line ${lineNum}); pending V6.6 federation.`);
      return;
    }

    // Unknown directive: ignore gracefully (forward compatibility).
  }
}
