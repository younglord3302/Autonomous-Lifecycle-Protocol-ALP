import { AlpObject } from './reader';

export interface ContractViolation {
  contractId: string;
  rule: string;
  reason: string;
  context: Record<string, unknown>;
}

export interface ContractResult {
  ok: boolean;
  violation?: ContractViolation;
}

export interface ContractObject {
  id: string;
  name?: string;
  from: string;
  to: string;
  type: 'api' | 'data' | 'tool' | 'repo';
  requires: string[];
  allows: string[];
  denies: string[];
  on_violation: 'deny' | 'warn' | 'log';
}

export class ContractEngine {
  private contracts: Map<string, ContractObject>;

  constructor(objects: AlpObject[]) {
    this.contracts = new Map();
    for (const obj of objects) {
      if (obj._type === 'contract') {
        this.contracts.set(obj.id as string, normalize(obj));
      }
    }
  }

  get count(): number {
    return this.contracts.size;
  }

  /**
   * Check whether `context` satisfies the contract with the given id.
   *
   * @param contractId The `@contract` id to evaluate.
   * @param context    Must include `operation: string`. May include arbitrary
   *                   fields referenced by `requires` expressions.
   */
  check(contractId: string, context: Record<string, unknown>): ContractResult {
    const contract = this.contracts.get(contractId);
    if (!contract) {
      return {
        ok: false,
        violation: { contractId, rule: '', reason: `contract '${contractId}' not found`, context },
      };
    }

    for (const req of contract.requires) {
      if (!evaluateRequire(req, context)) {
        return this.violation(contract, req, 'required condition not met', context);
      }
    }

    const operation = String(context.operation ?? '');

    if (contract.denies.some((d) => matchesGlob(operation, d))) {
      return this.violation(contract, operation, 'denied', context);
    }

    if (contract.allows.length > 0 && !contract.allows.includes(operation)) {
      return this.violation(contract, operation, 'not in allow-list', context);
    }

    return { ok: true };
  }

  /** List all contracts. */
  list(): ContractObject[] {
    return Array.from(this.contracts.values());
  }

  private violation(contract: ContractObject, rule: string, reason: string, context: Record<string, unknown>): ContractResult {
    const v: ContractViolation = { contractId: contract.id, rule, reason, context };
    if (contract.on_violation === 'log') {
      console.log(`[contract] violation: ${contract.id} — ${rule}: ${reason}`);
    }
    if (contract.on_violation === 'warn') {
      console.warn(`[contract] violation (warn): ${contract.id} — ${rule}: ${reason}`);
      return { ok: true };
    }
    return { ok: false, violation: v };
  }
}

function normalize(obj: AlpObject): ContractObject {
  return {
    id: obj.id as string,
    name: obj.name as string | undefined,
    from: obj.from as string,
    to: obj.to as string,
    type: (obj.type as ContractObject['type']) ?? 'api',
    requires: Array.isArray(obj.requires) ? obj.requires.map(String) : [],
    allows: Array.isArray(obj.allows) ? obj.allows.map(String) : [],
    denies: Array.isArray(obj.denies) ? obj.denies.map(String) : [],
    on_violation: (obj.on_violation as ContractObject['on_violation']) ?? 'deny',
  };
}

function evaluateRequire(expr: string, context: Record<string, unknown>): boolean {
  const trimmed = expr.trim();
  for (const op of ['<=', '>=', '!=', '==', '<', '>']) {
    if (trimmed.includes(op)) {
      const idx = trimmed.indexOf(op);
      const key = trimmed.slice(0, idx).trim();
      const rawValue = trimmed.slice(idx + op.length).trim();
      const actual = getNested(context, key);
      const expected = parseValue(rawValue);
      if (actual == null) return false;
      switch (op) {
        case '<':  return Number(actual) < Number(expected);
        case '>':  return Number(actual) > Number(expected);
        case '<=': return Number(actual) <= Number(expected);
        case '>=': return Number(actual) >= Number(expected);
        case '==': return actual === expected;
        case '!=': return actual !== expected;
      }
    }
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length === 2) {
    const actual = getNested(context, parts[0]);
    const expected = parseValue(parts[1]);
    return actual === expected;
  }
  return getNested(context, trimmed) != null && getNested(context, trimmed) !== false;
}

function getNested(context: Record<string, unknown>, key: string): unknown {
  const parts = key.split('.');
  let cur: unknown = context;
  for (const part of parts) {
    if (typeof cur === 'object' && cur !== null && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return cur;
}

function parseValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const n = Number(raw);
  if (!isNaN(n)) return n;
  return raw;
}

function matchesGlob(value: string, pattern: string): boolean {
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2);
    return value.startsWith(prefix);
  }
  return value === pattern;
}
