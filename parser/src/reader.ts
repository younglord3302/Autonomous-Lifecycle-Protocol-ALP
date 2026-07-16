import { SyntaxError, IndentationError } from './error';

export interface AlpObject {
  _type: string;
  [key: string]: any;
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
   * Reads an .alp file content and returns an array of parsed objects.
   * This is a simplified line-by-line parser for the MVP.
   */
  public parse(content: string): AlpObject[] {
    const lines = content.split('\n');
    const objects: AlpObject[] = [];

    let currentObject: AlpObject | null = null;
    let currentNestedBlock: string | null = null;
    let currentListProp: string | null = null;

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

      // Directives (e.g., !alp-version: 2.0.0)
      if (trimmed.startsWith('!') && indent === 0) {
        continue;
      }

      // Top-level block markers (e.g., @project, @task)
      if (trimmed.startsWith('@') && indent === 0) {
        const typeMatch = trimmed.match(/^@([a-z_]+)$/);
        if (!typeMatch) {
          throw new SyntaxError(`Invalid block marker: '${trimmed}'`, lineNum);
        }
        if (currentObject) {
          objects.push(currentObject);
        }
        currentObject = { _type: typeMatch[1] };
        currentNestedBlock = null;
        currentListProp = null;
        continue;
      }

      // ── Level 1 (indent=2): Properties and nested block markers ──

      if (indent === 2 && currentObject) {
        // Nested block markers (e.g., @accept, @verify inside a task)
        if (trimmed.startsWith('@')) {
          const nestedMatch = trimmed.match(/^@([a-z_]+)$/);
          if (!nestedMatch) {
            throw new SyntaxError(`Invalid nested block marker: '${trimmed}'`, lineNum);
          }
          currentNestedBlock = nestedMatch[1];
          currentObject[currentNestedBlock] = [];
          currentListProp = null;
          continue;
        }

        // List property (e.g., tasks:)
        const listPropMatch = trimmed.match(/^([a-z_]+):$/);
        if (listPropMatch) {
          currentListProp = listPropMatch[1];
          currentObject[currentListProp] = [];
          currentNestedBlock = null;
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

          currentObject[key] = value;
          currentNestedBlock = null;
          currentListProp = null;
          continue;
        }

        throw new SyntaxError(`Invalid property format: '${trimmed}'`, lineNum);
      }

      // ── Level 2 (indent=4): List items and nested properties ──

      if (indent === 4 && currentObject && (currentNestedBlock || currentListProp)) {
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
          if (currentNestedBlock) {
             if (Array.isArray(currentObject[currentNestedBlock])) {
                currentObject[currentNestedBlock].push(val);
             }
          } else if (currentListProp) {
             if (Array.isArray(currentObject[currentListProp])) {
                currentObject[currentListProp].push(val);
             }
          }
          continue;
        }
        
        // Nested properties (e.g., limits block in agents)
        const nestedPropMatch = trimmed.match(/^([a-z_][a-z0-9_-]*):\s*(.*)$/);
        if (nestedPropMatch && currentListProp) {
           // We convert currentListProp from array to object if it's the first nested property
           if (Array.isArray(currentObject[currentListProp])) {
               currentObject[currentListProp] = {};
           }
           let key = nestedPropMatch[1];
           let value = nestedPropMatch[2];
           
           if (value.startsWith('"') && value.endsWith('"')) {
             value = value.substring(1, value.length - 1);
           }
           
           // Numeric conversion for limits/thresholds
           if (!isNaN(Number(value))) {
              currentObject[currentListProp][key] = Number(value);
           } else {
              currentObject[currentListProp][key] = value;
           }
           continue;
        }

        throw new SyntaxError(`Invalid list item or nested property format: '${trimmed}'`, lineNum);
      }

      // ── Invalid indentation ──

      // If we're inside an object and the indentation is wrong, report it
      if (currentObject && indent > 0) {
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
      if (!currentObject && indent > 0) {
        throw new IndentationError(
          'Unexpected indentation outside of a block',
          lineNum
        );
      }

      throw new SyntaxError(`Unrecognized syntax: '${trimmed}'`, lineNum);
    }

    if (currentObject) {
      objects.push(currentObject);
    }

    return objects;
  }
}
