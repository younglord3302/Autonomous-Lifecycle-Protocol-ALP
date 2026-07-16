import { AlpObject } from './reader';

/**
 * ALP Policy Engine (v4 — The Federation Era)
 *
 * Evaluates proposed autonomous-agent actions against declarative `@policy`
 * objects. Makes it safe to run swarms unattended: an agent can only touch
 * allowed paths, run allowed commands, and act within its budget.
 *
 * Precedence rules:
 *   - `deny_*` always beats `allow_*`.
 *   - If `allow_*` is present and non-empty, the action must match it.
 *   - If `allow_*` is absent, the action is allowed unless denied.
 *   - `enforcement: "warn"` never blocks; it only reports.
 */

export type PolicyActionKind = 'path' | 'command' | 'agent';

export interface PolicyDecision {
  allowed: boolean;
  /** True only for hard blocks from a `strict` policy. */
  blocked: boolean;
  /** Human-readable reasons (violations or warnings). */
  reasons: string[];
  /** The policy ids that produced a violation. */
  policies: string[];
}

export interface PolicyQuery {
  kind: PolicyActionKind;
  /** The path, command, or agent id being evaluated. */
  value: string;
  /** The agent attempting the action (for `applies_to` scoping). */
  agent?: string;
}

interface PolicyObject {
  id: string;
  applies_to?: string | string[];
  allow_paths?: string[];
  deny_paths?: string[];
  allow_commands?: string[];
  deny_commands?: string[];
  enforcement?: 'strict' | 'warn';
}

export class PolicyEngine {
  private policies: PolicyObject[];

  constructor(objects: AlpObject[]) {
    this.policies = objects
      .filter((o) => o._type === 'policy')
      .map((o) => o as unknown as PolicyObject);
  }

  get count(): number {
    return this.policies.length;
  }

  /** Does this policy govern the given agent? */
  private governs(policy: PolicyObject, agent?: string): boolean {
    const target = policy.applies_to;
    if (target === undefined || target === '*' || target === '-> *') return true;
    const list = Array.isArray(target) ? target : [target];
    if (!agent) return false;
    return list.some((t) => normalizeRef(t) === agent || t === '*');
  }

  /**
   * Evaluate a proposed action. Returns an aggregate decision across every
   * governing policy (deny/strict wins).
   */
  evaluate(query: PolicyQuery): PolicyDecision {
    return this.evaluateInternal(query, false);
  }

  /**
   * Like {@link evaluate}, but only considers `deny_*` rules and ignores
   * `allow_*` lists. Used for ALP protocol-coordination files that should be
   * permitted unless explicitly denied.
   */
  evaluateDenyOnly(query: PolicyQuery): PolicyDecision {
    return this.evaluateInternal(query, true);
  }

  private evaluateInternal(query: PolicyQuery, denyOnly: boolean): PolicyDecision {
    const reasons: string[] = [];
    const violatingPolicies: string[] = [];
    let blocked = false;
    let allowed = true;

    for (const policy of this.policies) {
      if (!this.governs(policy, query.agent)) continue;

      const strict = (policy.enforcement ?? 'strict') === 'strict';
      const deny = query.kind === 'path' ? policy.deny_paths : query.kind === 'command' ? policy.deny_commands : undefined;
      const allow = query.kind === 'path' ? policy.allow_paths : query.kind === 'command' ? policy.allow_commands : undefined;

      // 1. Explicit deny always wins.
      if (deny && deny.some((p) => this.matches(query.kind, p, query.value))) {
        reasons.push(`Policy '${policy.id}' denies ${query.kind} '${query.value}'.`);
        violatingPolicies.push(policy.id);
        allowed = false;
        if (strict) blocked = true;
        continue;
      }

      // 2. If an allow-list exists, the action must match it (skipped in deny-only mode).
      if (!denyOnly && allow && allow.length > 0) {
        const ok = allow.some((p) => this.matches(query.kind, p, query.value));
        if (!ok) {
          reasons.push(
            `Policy '${policy.id}' does not allow ${query.kind} '${query.value}' (not in allow-list).`,
          );
          violatingPolicies.push(policy.id);
          allowed = false;
          if (strict) blocked = true;
        }
      }
    }

    return { allowed, blocked, reasons, policies: violatingPolicies };
  }

  private matches(kind: PolicyActionKind, pattern: string, value: string): boolean {
    if (kind === 'command') {
      // Command patterns match as a prefix (e.g. "npm test" matches "npm test -- --watch").
      const p = pattern.trim().toLowerCase();
      const v = value.trim().toLowerCase();
      return v === p || v.startsWith(p + ' ') || v.startsWith(p);
    }
    // Path patterns use glob matching.
    return globToRegExp(pattern).test(normalizePath(value));
  }
}

function normalizeRef(ref: string): string {
  return ref.replace(/^->\s*/, '').trim();
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Convert a glob (`*`, `**`, `?`) into an anchored RegExp.
 *  - `**` matches across path separators
 *  - `*`  matches within a single path segment
 *  - `?`  matches a single non-separator character
 */
export function globToRegExp(glob: string): RegExp {
  const normalized = normalizePath(glob);
  let re = '';
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i];
    if (c === '*') {
      if (normalized[i + 1] === '*') {
        re += '.*';
        i++;
        if (normalized[i + 1] === '/') i++; // consume trailing slash of **/
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$');
}
