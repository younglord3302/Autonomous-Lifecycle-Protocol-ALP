/**
 * ALP MacroEngine — Dynamic @macro object generation (v37.0.0).
 *
 * Expands `@macro` blocks into concrete protocol objects by evaluating
 * the `iterate_over` ALPEL expression and interpolating `${...}` template
 * variables in the `template` block for each iteration item.
 *
 * Spec reference: spec/03-protocol-objects.md §20.
 */

import { evaluate } from './alpel';

export interface MacroDefinition {
  id: string;
  name?: string;
  iterate_over: string;
  as?: string;
  template: Record<string, any>;
}

export interface ExpandedObject {
  _type: string;
  id: string;
  _sourceMarco?: string;
  [key: string]: any;
}

/**
 * Interpolate `${var}` and `${var.prop}` placeholders in a string.
 */
function interpolateString(template: string, varName: string, item: any): string {
  return template.replace(/\$\{([^}]+)\}/g, (_match, expr: string) => {
    const trimmed = expr.trim();
    if (trimmed === varName) {
      return typeof item === 'object' ? JSON.stringify(item) : String(item);
    }
    if (trimmed.startsWith(varName + '.')) {
      const prop = trimmed.slice(varName.length + 1);
      const parts = prop.split('.');
      let val: any = item;
      for (const p of parts) {
        if (val == null) return '';
        val = val[p];
      }
      return val != null ? String(val) : '';
    }
    return _match;
  });
}

/**
 * Recursively interpolate all string values in an object/array.
 */
function interpolateDeep(obj: any, varName: string, item: any): any {
  if (typeof obj === 'string') {
    return interpolateString(obj, varName, item);
  }
  if (Array.isArray(obj)) {
    return obj.map(v => interpolateDeep(v, varName, item));
  }
  if (obj && typeof obj === 'object') {
    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[interpolateString(k, varName, item)] = interpolateDeep(v, varName, item);
    }
    return result;
  }
  return obj;
}

export class MacroEngine {
  /**
   * Expand a single `@macro` definition into concrete objects.
   */
  expand(macro: MacroDefinition, context?: Record<string, any>): ExpandedObject[] {
    if (!macro.iterate_over) {
      throw new Error(`Macro '${macro.id}': missing iterate_over`);
    }
    if (!macro.template) {
      throw new Error(`Macro '${macro.id}': missing template`);
    }

    // Evaluate the iterate_over expression
    let items: any[];
    try {
      const raw = macro.iterate_over.trim();
      // Try JSON array first
      if (raw.startsWith('[')) {
        items = JSON.parse(raw.replace(/'/g, '"'));
      } else {
        // Evaluate as ALPEL expression
        const result = evaluate(raw, context || {});
        items = Array.isArray(result) ? result : [result];
      }
    } catch {
      throw new Error(`Macro '${macro.id}': failed to evaluate iterate_over: ${macro.iterate_over}`);
    }

    if (!Array.isArray(items)) {
      throw new Error(`Macro '${macro.id}': iterate_over must resolve to an array`);
    }

    const varName = macro.as || 'item';
    const expanded: ExpandedObject[] = [];
    const seenIds = new Set<string>();

    for (const item of items) {
      const obj = interpolateDeep(macro.template, varName, item);
      obj._sourceMacro = macro.id;

      if (obj.id && seenIds.has(obj.id)) {
        throw new Error(`Macro '${macro.id}': duplicate generated id '${obj.id}'`);
      }
      if (obj.id) seenIds.add(obj.id);

      expanded.push(obj as ExpandedObject);
    }

    return expanded;
  }

  /**
   * Scan a list of parsed objects, expand all `@macro` entries,
   * and return a flat list with macros replaced by their expansions.
   */
  expandAll(objects: any[]): any[] {
    const result: any[] = [];
    for (const obj of objects) {
      if (obj._type === 'macro' && obj.iterate_over && obj.template) {
        const expanded = this.expand(obj as MacroDefinition);
        result.push(...expanded);
      } else {
        result.push(obj);
      }
    }
    return result;
  }
}
