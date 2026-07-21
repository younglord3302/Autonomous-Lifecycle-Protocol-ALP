import { AlpObject } from './reader';

export interface VerificationProperty {
  name: string;
  passed: boolean;
  message: string;
}

export interface CounterexampleTrace {
  contractId: string;
  invariant: string;
  input: Record<string, unknown>;
  trace: string[];
}

export interface VerificationProof {
  policyId: string;
  passed: boolean;
  checkedAt: string;
  properties: VerificationProperty[];
  counterexample?: CounterexampleTrace;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

function normalizePathLike(p: string): string {
  return p.trim().toLowerCase();
}

function isSatisfiable(expr: string): boolean {
  const trimmed = expr.trim();
  if (!trimmed) return true;
  if (trimmed.includes('==') && trimmed.includes('!=')) {
    const parts = trimmed.split('==');
    if (parts.length === 2) {
      const after = parts[1].trim();
      const neqMatch = after.match(/!=\s*(.+)$/);
      if (neqMatch && parts[0].trim() === neqMatch[1].trim()) return false;
    }
  }
  return true;
}

function parseInlineObject(literal: string): Record<string, any> {
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

export class PolicyModelChecker {
  constructor(private objects: AlpObject[]) {}

  verify(policyId: string): VerificationProof {
    const policy = this.objects.find((o) => o._type === 'policy' && o.id === policyId);
    if (!policy) {
      return {
        policyId,
        passed: false,
        checkedAt: new Date().toISOString(),
        properties: [],
        counterexample: {
          contractId: policyId,
          invariant: 'policy_exists',
          input: {},
          trace: [`Policy '${policyId}' not found in workspace.`],
        },
      };
    }

    const properties: VerificationProperty[] = [];
    const appliesTo = policy.applies_to ?? '*';
    const allowPaths = Array.isArray(policy.allow_paths) ? policy.allow_paths : [];
    const denyPaths = Array.isArray(policy.deny_paths) ? policy.deny_paths : [];
    const allowCommands = Array.isArray(policy.allow_commands) ? policy.allow_commands : [];
    const denyCommands = Array.isArray(policy.deny_commands) ? policy.deny_commands : [];
    const allowDuring = Array.isArray(policy.allow_during) ? policy.allow_during : [];
    const enforcement = policy.enforcement ?? 'strict';

    const validEnforcement = enforcement === 'strict' || enforcement === 'warn';
    properties.push({
      name: 'valid_enforcement',
      passed: validEnforcement,
      message: validEnforcement
        ? `enforcement='${enforcement}' is valid.`
        : `enforcement='${enforcement}' is invalid; expected 'strict' or 'warn'.`,
    });

    let contradiction = false;
    for (const deny of denyPaths) {
      if (allowPaths.some((allow) => normalizePath(allow) === normalizePath(deny))) {
        contradiction = true;
        break;
      }
    }
    properties.push({
      name: 'no_path_contradiction',
      passed: !contradiction,
      message: contradiction
        ? 'Policy allows and denies the same path.'
        : 'No allow/deny path contradictions.',
    });

    let cmdContradiction = false;
    for (const deny of denyCommands) {
      if (allowCommands.some((allow) => allow.trim().toLowerCase() === deny.trim().toLowerCase())) {
        cmdContradiction = true;
        break;
      }
    }
    properties.push({
      name: 'no_command_contradiction',
      passed: !cmdContradiction,
      message: cmdContradiction
        ? 'Policy allows and denies the same command.'
        : 'No allow/deny command contradictions.',
    });

    let badWindow = false;
    const windowTrace: string[] = [];
    for (const window of allowDuring) {
      const w = typeof window === 'string' ? parseInlineObject(window) : window;
      if (!w || typeof w !== 'object') continue;
      const days = w.days;
      if (!Array.isArray(days) || days.length === 0) {
        badWindow = true;
        windowTrace.push(`Window missing days: ${JSON.stringify(w)}`);
      }
      if (w.start && w.end && w.start >= w.end) {
        badWindow = true;
        windowTrace.push(`Window start >= end: ${w.start} >= ${w.end}`);
      }
    }
    properties.push({
      name: 'valid_time_windows',
      passed: !badWindow,
      message: badWindow
        ? `Invalid time window(s): ${windowTrace.join('; ')}`
        : 'All time windows are valid.',
    });

    const validScope =
      appliesTo === '*' ||
      appliesTo === '-> *' ||
      (Array.isArray(appliesTo) && appliesTo.length > 0) ||
      (typeof appliesTo === 'string' && appliesTo.startsWith('->'));
    properties.push({
      name: 'valid_scope',
      passed: validScope,
      message: validScope
        ? `Scope '${appliesTo}' is valid.`
        : `Scope '${appliesTo}' is invalid.`,
    });

    const passed = properties.every((p) => p.passed);
    const proof: VerificationProof = {
      policyId,
      passed,
      checkedAt: new Date().toISOString(),
      properties,
    };

    if (!passed) {
      const failed = properties.filter((p) => !p.passed);
      proof.counterexample = {
        contractId: policyId,
        invariant: failed.map((f) => f.name).join(', '),
        input: {
          policy: {
            id: policyId,
            enforcement,
            allow_paths: allowPaths,
            deny_paths: denyPaths,
          },
        },
        trace: failed.map((f) => f.message),
      };
    }

    return proof;
  }
}

export class ContractInvariant {
  constructor(private objects: AlpObject[]) {}

  verifyContract(contractId: string): VerificationProof {
    const contract = this.objects.find((o) => o._type === 'contract' && o.id === contractId);
    if (!contract) {
      return {
        policyId: contractId,
        passed: false,
        checkedAt: new Date().toISOString(),
        properties: [],
        counterexample: {
          contractId,
          invariant: 'contract_exists',
          input: {},
          trace: [`Contract '${contractId}' not found in workspace.`],
        },
      };
    }

    const properties: VerificationProperty[] = [];
    const requires = Array.isArray(contract.requires) ? contract.requires : [];
    const allows = Array.isArray(contract.allows) ? contract.allows : [];
    const denies = Array.isArray(contract.denies) ? contract.denies : [];
    const type = (contract as any).type ?? 'api';
    const onViolation = (contract as any).on_violation ?? 'deny';

    const validOnViolation = onViolation === 'deny' || onViolation === 'warn' || onViolation === 'log';
    properties.push({
      name: 'valid_on_violation',
      passed: validOnViolation,
      message: validOnViolation
        ? `on_violation='${onViolation}' is valid.`
        : `on_violation='${onViolation}' is invalid.`,
    });

    const validType = ['api', 'data', 'tool', 'repo'].includes(type);
    properties.push({
      name: 'valid_type',
      passed: validType,
      message: validType
        ? `type='${type}' is valid.`
        : `type='${type}' is invalid.`,
    });

    let unsatisfiable = false;
    const reqTrace: string[] = [];
    for (const req of requires) {
      if (!isSatisfiable(req)) {
        unsatisfiable = true;
        reqTrace.push(`Requires condition '${req}' appears unsatisfiable.`);
      }
    }
    properties.push({
      name: 'satisfiable_requires',
      passed: !unsatisfiable,
      message: unsatisfiable
        ? `Unsatisfiable requires: ${reqTrace.join('; ')}`
        : 'All requires conditions are satisfiable.',
    });

    const overlap = allows.filter((a) => denies.some((d) => normalizePathLike(d) === normalizePathLike(a)));
    const totalOverlap = overlap.length > 0 && overlap.length === allows.length && allows.length > 0;
    properties.push({
      name: 'no_full_allow_deny_overlap',
      passed: !totalOverlap,
      message: totalOverlap
        ? `All allowed operations are also denied.`
        : 'Allows and denies are not fully contradictory.',
    });

    const passed = properties.every((p) => p.passed);
    const proof: VerificationProof = {
      policyId: contractId,
      passed,
      checkedAt: new Date().toISOString(),
      properties,
    };

    if (!passed) {
      const failed = properties.filter((p) => !p.passed);
      proof.counterexample = {
        contractId,
        invariant: failed.map((f) => f.name).join(', '),
        input: {
          contract: {
            id: contractId,
            type,
            requires,
            allows,
            denies,
            on_violation: onViolation,
          },
        },
        trace: failed.map((f) => f.message),
      };
    }

    return proof;
  }
}

export interface ZKPolicyProofData {
  policy_id: string;
  action: string;
  witness_hash: string;
  expected: string;
  generated_at: string;
}

export class ZKPolicyProof {
  policyId: string;
  action: string;
  proofData: ZKPolicyProofData;
  verified: boolean;
  verifiedAt?: string;

  constructor(policyId: string, action: string, proofData?: ZKPolicyProofData, verified = false) {
    this.policyId = policyId;
    this.action = action;
    this.proofData = proofData ?? ({} as ZKPolicyProofData);
    this.verified = verified;
  }

  generate(witness: Record<string, any>): ZKPolicyProofData {
    const witnessHash = sha256(witness);
    const proofPayload = {
      policy_id: this.policyId,
      action: this.action,
      witness_hash: witnessHash,
    };
    const expected = sha256(proofPayload);
    this.proofData = {
      policy_id: this.policyId,
      action: this.action,
      witness_hash: witnessHash,
      expected,
      generated_at: new Date().toISOString(),
    };
    return this.proofData;
  }

  verify(trustRoot?: Record<string, any>): boolean {
    if (!this.proofData?.expected) return false;
    const proofPayload = {
      policy_id: this.proofData.policy_id,
      action: this.proofData.action,
      witness_hash: this.proofData.witness_hash,
    };
    const expected = sha256(proofPayload);
    let ok = this.proofData.expected === expected;
    if (trustRoot) {
      ok = ok && (trustRoot.namespace === this.proofData.policy_id || trustRoot.namespace === '*');
    }
    this.verified = ok;
    this.verifiedAt = new Date().toISOString();
    return ok;
  }

  toJSON(): Record<string, any> {
    return {
      policy_id: this.policyId,
      action: this.action,
      proof_data: this.proofData,
      verified: this.verified,
      verified_at: this.verifiedAt,
    };
  }
}

function sha256(obj: Record<string, any>): string {
  const crypto = require('crypto');
  const payload = JSON.stringify(obj, Object.keys(obj).sort());
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export interface ComplianceBundle {
  run_id: string;
  profile: string;
  passed: boolean;
  results: Record<string, any>[];
  issued_at: string;
  issuer?: string;
  signature?: string;
}

export class ComplianceCertifier {
  constructor(private trustRoot?: Record<string, any>) {}

  certify(runId: string, profile: string, results: Record<string, any>[]): ComplianceBundle {
    const passed = results.every((r) => r.passed);
    const bundle: ComplianceBundle = {
      run_id: runId,
      profile,
      passed,
      results,
      issued_at: new Date().toISOString(),
    };
    if (this.trustRoot) {
      bundle.issuer = this.trustRoot.namespace || 'unknown';
      bundle.signature = sha256(bundle);
    }
    return bundle;
  }

  verifyBundle(bundle: ComplianceBundle): boolean {
    if (!bundle.signature) return false;
    const { signature, ...payload } = bundle;
    return signature === sha256(payload);
  }
}
