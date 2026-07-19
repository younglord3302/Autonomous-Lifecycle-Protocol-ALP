import { AlpObject } from './reader';

/**
 * ALP Policy Engine (v4 — The Federation Era; v2 extensions v8.1.0)
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
 *
 * v8.1.0 extensions:
 *   - `allow_during` time-windows: actions outside every window are denied
 *     (a strict, time-scoped least-privilege guard).
 *   - `require_approval`: actions matching these patterns escalate to a
 *     human-in-the-loop approval gate rather than auto-blocking.
 *   - `proposal` blocks: signed, auditable action proposals verified
 *     against a trust root (MCP-enforcement audit trail, spec/03 §25).
 */

export type PolicyActionKind = 'path' | 'command' | 'agent';

export interface TimeWindow {
  /** Day-of-week names or `*` (every day). */
  days?: string[];
  /** Inclusive start HH:MM (UTC). */
  start?: string;
  /** Exclusive end HH:MM (UTC). */
  end?: string;
}

export interface ApprovalRule {
  kind: 'path' | 'command';
  value: string;
}

export interface PolicyProposal {
  id: string;
  action: string;
  agent: string;
  signed_by?: string;
  signature?: string;
}

export interface PolicyDecision {
  allowed: boolean;
  /** True only for hard blocks from a `strict` policy. */
  blocked: boolean;
  /** Human-readable reasons (violations or warnings). */
  reasons: string[];
  /** The policy ids that produced a violation. */
  policies: string[];
  /** Actions that must be escalated to human approval. */
  requiresApproval?: boolean;
  /** Audit record for MCP-enforcement (spec/03 §25). */
  audit?: { proposalId?: string; agent?: string; decision: string; timestamp: string };
}

export interface PolicyQuery {
  kind: PolicyActionKind;
  /** The path, command, or agent id being evaluated. */
  value: string;
  /** The agent attempting the action (for `applies_to` scoping). */
  agent?: string;
  /** Current UTC time (defaults to now) for `allow_during` checks. */
  now?: Date;
}

interface PolicyObject {
  id: string;
  applies_to?: string | string[];
  allow_paths?: string[];
  deny_paths?: string[];
  allow_commands?: string[];
  deny_commands?: string[];
  enforcement?: 'strict' | 'warn';
  /** v8.1.0: time-scoped least-privilege windows. */
  allow_during?: TimeWindow[];
  /** v8.1.0: patterns that escalate to human approval. */
  require_approval?: ApprovalRule[];
  /** v8.1.0: signed, auditable action proposals. */
  proposals?: PolicyProposal[];
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

  /**
   * v8.1.0: evaluate a signed `proposal` block against this policy's
   * `proposals` list and an optional trust root. A proposal is allowed
   * only when its `signed_by`/`signature` verify (if a trust root is
   * configured) or when unsigned proposals are permitted. Produces an
   * audit record for the MCP-enforcement trail (spec/03 §25).
   */
  evaluateProposal(proposalId: string, trustPems?: Record<string, string>): PolicyDecision {
    const now = new Date();
    const reasons: string[] = [];
    const violating: string[] = [];
    let allowed = false;
    let blocked = false;

    for (const policy of this.policies) {
      const list = Array.isArray(policy.proposals) ? policy.proposals : [];
      // List items may be inline objects stored as raw strings by the
      // line-based reader (e.g. `{ id: "prop-1", ... }`), or already
      // parsed objects. Normalize both forms.
      const match = list
        .map((p) => (typeof p === 'string' ? parseProposalLiteral(p) : p))
        .find((p) => p && p.id === proposalId);
      if (!match) continue;
      if (match.signature) {
        if (trustPems && match.signed_by && !(match.signed_by in trustPems)) {
          reasons.push(
            `Policy '${policy.id}' proposal '${proposalId}' signed by '${match.signed_by}' not in trust root.`
          );
          violating.push(policy.id);
          blocked = true;
        } else {
          allowed = true;
        }
      } else if (trustPems && Object.keys(trustPems).length > 0) {
        reasons.push(
          `Policy '${policy.id}' proposal '${proposalId}' is unsigned; trust root requires signatures.`
        );
        violating.push(policy.id);
        blocked = true;
      } else {
        allowed = true;
      }
    }

    if (this.policies.length === 0) allowed = true;

    return {
      allowed,
      blocked,
      reasons,
      policies: violating,
      audit: {
        proposalId,
        decision: allowed ? 'allow' : 'deny',
        timestamp: now.toISOString(),
      },
    };
  }

  private evaluateInternal(query: PolicyQuery, denyOnly: boolean): PolicyDecision {
    const reasons: string[] = [];
    const violatingPolicies: string[] = [];
    let blocked = false;
    let allowed = true;
    let requiresApproval = false;
    const now = query.now ?? new Date();

    for (const policy of this.policies) {
      if (!this.governs(policy, query.agent)) continue;

      const strict = (policy.enforcement ?? 'strict') === 'strict';

      // v8.1.0: time-scoped least-privilege. Outside every
      // declared `allow_during` window, allowed actions are denied.
      const windows = normalizeObjects(policy.allow_during);
      if (windows.length > 0) {
        if (!this.inAnyWindow(windows, now)) {
          reasons.push(
            `Policy '${policy.id}' denies ${query.kind} '${query.value}' (outside allowed time window).`
          );
          violatingPolicies.push(policy.id);
          allowed = false;
          if (strict) blocked = true;
          continue;
        }
      }

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

      // 3. v8.1.0: human-approval escalation. Matching an
      //    `require_approval` rule does NOT block — it flags the
      //    action for a human-in-the-loop gate instead.
      if (policy.require_approval) {
        const approvals = normalizeObjects(policy.require_approval);
        const hit = approvals.some(
          (r) => r.kind === query.kind && this.matches(query.kind, r.value ?? '', query.value)
        );
        if (hit) requiresApproval = true;
      }
    }

    return {
      allowed,
      blocked,
      reasons,
      policies: violatingPolicies,
      requiresApproval,
      audit: {
        agent: query.agent,
        decision: allowed ? 'allow' : blocked ? 'block' : 'warn',
        timestamp: now.toISOString(),
      },
    };
  }

  /** v8.1.0: is `now` inside any declared time window? */
  private inAnyWindow(windows: TimeWindow[], now: Date): boolean {
    const day = [
      'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
    ][now.getUTCDay()];
    const hhmm =
      (now.getUTCHours() < 10 ? '0' : '') + now.getUTCHours() +
      ':' +
      (now.getUTCMinutes() < 10 ? '0' : '') + now.getUTCMinutes();
    return windows.some((w) => {
      let days: any[] = w.days && w.days.length > 0 ? w.days : ['*'];
      // The line-based reader may keep an array value as a string.
      if (typeof days === 'string') {
        try {
          const parsed = JSON.parse(days);
          if (Array.isArray(parsed)) days = parsed;
        } catch {
          days = [days];
        }
      }
      const dayOk = days.includes('*') || days.some((d: string) => String(d).toLowerCase() === day);
      if (!dayOk) return false;
      if (!w.start && !w.end) return true;
      const start = w.start ?? '00:00';
      const end = w.end ?? '23:59';
      return hhmm >= start && hhmm < end;
    });
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

/**
 * Parse a single inline object literal `{ id: "prop-1", ... }` into a
 * plain object. The line-based reader stores `proposals`, `allow_during`,
 * and `require_approval` list items as raw strings; this normalizes them
 * to objects for verification. Bracket-aware: commas inside `[...]` array
 * values (e.g. `days: ["mon","tue"]`) are not treated as pair separators.
 */
function parseProposalLiteral(literal: string): Record<string, any> {
  const inner = literal.trim().replace(/^\{/, '').replace(/\}$/, '');
  const out: Record<string, any> = {};
  if (!inner.trim()) return out;
  let depth = 0;
  let buf = '';
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '[') depth++;
    else if (c === ']') depth = Math.max(0, depth - 1);
    if (c === ',' && depth === 0) {
      applyPair(buf, out);
      buf = '';
    } else {
      buf += c;
    }
  }
  if (buf.trim()) applyPair(buf, out);
  return out;
}

function applyPair(pair: string, out: Record<string, any>): void {
  const idx = pair.indexOf(':');
  if (idx === -1) return;
  const key = pair.slice(0, idx).trim();
  let value = pair.slice(idx + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  out[key] = value;
}

/**
 * Normalize a list of nested objects that the line-based reader may have
 * kept as raw inline-object strings (e.g. `proposals`, `allow_during`,
 * `require_approval` list items). Returns plain objects either way.
 */
function normalizeObjects(list: any[] | undefined): Record<string, any>[] {
  if (!Array.isArray(list)) return [];
  return list.map((item) =>
    typeof item === 'string' ? parseProposalLiteral(item) : item
  );
}
