import { SyntaxError, IndentationError, DirectiveError } from './error';
import { evaluateBool, interpolate, buildContext, AlpelValue } from './alpel';

export interface AlpObject {
  _type: string;
  [key: string]: any;
}

/** Strip one pair of surrounding quotes from a directive expression. */
function unquote(s: string): string {
  if (
    s.length >= 2 &&
    ((s[0] === '"' && s[s.length - 1] === '"') ||
      (s[0] === "'" && s[s.length - 1] === "'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

/** Evaluate a directive expression, treating any error (e.g. unknown
 *  identifier in a missing context) as false rather than throwing. */
function safeEvalBool(expr: string, ctx: Record<string, any>): boolean {
  try {
    return evaluateBool(expr, buildContext(ctx as any, { alp_version: '2.0.0' }));
  } catch {
    return false;
  }
}

/** Apply `${ }` interpolation to a scalar property or list value. */
function applyInterp(value: string, ctx: Record<string, any>): string {
  return interpolate(value, ctx as any);
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

      // In-block directives (e.g. `!if` / `!assert` inside a @block, per
      // spec/12) are handled before property parsing.
      if (indent === 2 && this.currentObject && trimmed.startsWith('!') &&
          /^\!(alp-version|if|assert|deprecated|import)(\s|:)/.test(trimmed)) {
        this.handleDirective(trimmed, lineNum);
        continue;
      }

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

          // Expand ${ } interpolation against the current object's context.
          if (value.includes('${')) {
            const ctx = buildContext(this.currentObject as any, { alp_version: '2.0.0' });
            value = applyInterp(value, ctx);
          }

          this.currentObject[key] = value;
          this.currentNestedBlock = null;
          this.currentListProp = null;

          // ── v8.0.0: status-marker deprecation ──
          // `[!]` (blocked) and `[?]` (human gate) MUST carry a
          // free-text reason as of v8.0.0. Unannotated markers emit
          // a deprecation warning now and become a hard error in v9.
          if (key === 'status' && (value === '[!]' || value === '[?]')) {
            this.warnings.push(
              `Deprecation (line ${lineNum}): status marker '${value}' requires a reason (e.g. '[!] reason text'). Required in v9.0.0.`
            );
          }

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
          if (val.includes('${')) {
            const ctx = buildContext(this.currentObject as any, { alp_version: '2.0.0' });
            val = applyInterp(val, ctx);
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
      const expr = unquote(m[1].trim());
      const result = this.safeEval(expr);
      if (!result) {
        this.skipPending = true;
        if (this.currentObject && !this.currentObjectSkipped) {
          this.currentObjectSkipped = true;
        }
      }
      return;
    }

    // !assert <expr>  — fail-closed as of v8.0.0: a false
    // expression OR an unparseable/errored expression raises. Earlier
    // versions silently treated eval errors as "pass"; v8 requires
    // the assertion to be both well-formed and true.
    m = trimmed.match(/^assert(?::|\s)\s*(.+)$/);
    if (m) {
      const expr = unquote(m[1].trim());
      let result = false;
      try {
        result = this.safeEval(expr);
      } catch (e) {
        throw new DirectiveError(`!assert expression error: ${expr}`, lineNum);
      }
      if (!result) {
        throw new DirectiveError(`!assert failed: ${expr}`, lineNum);
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

    // !import <target> — resolved by the PluginResolver (v6.5.0+),
    // which pre-scans import directives before invoking the reader.
    // When the reader sees one directly (e.g. a bare `AlpParser.parse`
    // without a resolver), it emits a non-fatal warning so callers
    // and the compliance suite can assert recognition.
    m = trimmed.match(/^import(?::|\s)\s*(.+)$/);
    if (m) {
      this.warnings.push(
        `!import is not yet resolved by the parser (line ${lineNum}); ` +
          `use PluginResolver or alp import.`
      );
      return;
    }

    // Unknown directive: as of v8.0.0 this is a HARD parse error
    // (fail-closed). Forward compatibility of *known* directives is
    // preserved by the grammar; an unrecognised directive name is a
    // syntax violation, not a silent no-op.
    throw new SyntaxError(`Unknown directive: '!${trimmed}'`, lineNum);
  }

  /**
   * Evaluate an ALPEL boolean directive (`!if` / `!assert`) against the
   * current object's context, treating any error as false (spec/12 §3.2).
   */
  private safeEval(expr: string): boolean {
    return safeEvalBool(expr, this.currentObject ?? {});
  }
}
