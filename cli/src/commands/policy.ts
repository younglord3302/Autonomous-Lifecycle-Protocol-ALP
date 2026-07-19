import * as fs from 'fs';
import * as path from 'path';
import { AlpParser, AlpObject, PolicyEngine, PolicyActionKind } from '@alp/parser';

interface PolicyOptions {
  path?: string;
  command?: string;
  agent?: string;
  /** v8.1.0: verify a signed `proposal` by id. */
  proposal?: string;
  /** v8.1.0: PEM/ fingerprint trust root for proposal verification. */
  trust?: string;
}

/**
 * `alp policy` — Policy & Permission Governance (v4 Pillar 4; v2 in v8.1.0).
 *
 * With no action flags, lists the policies in the workspace. With
 * `--path`, `--command`, or `--agent`, evaluates whether that action is
 * permitted and exits non-zero if a strict policy blocks it (making it
 * usable as a pre-flight gate in CI or agent wrappers).
 *
 * v8.1.0 adds `alp policy --proposal <id> [--trust <pem>]` to
 * verify a signed, auditable action proposal against a trust root.
 */
export function policyCommand(options?: PolicyOptions) {
  const cwd = process.cwd();
  const alpDir = path.resolve(cwd, '.alp');
  if (!fs.existsSync(alpDir)) {
    console.error('Error: .alp directory not found. Run `alp init` first.');
    process.exit(1);
  }

  const parser = new AlpParser();
  const objects: AlpObject[] = [];
  loadDir(alpDir, parser, objects);

  const engine = new PolicyEngine(objects);

  // ── List mode ──────────────────────────────────────────────────────────
  const hasQuery = options?.path || options?.command || options?.agent;
  if (!hasQuery) {
    const policies = objects.filter((o) => o._type === 'policy');
    if (policies.length === 0) {
      console.log('No @policy objects defined in this workspace.');
      console.log('Add one to govern which paths/commands agents may touch.');
      return;
    }
    console.log(`\n🛡️  ALP Policies (${policies.length})\n`);
    for (const p of policies) {
      const applies = (p as any).applies_to ?? '*';
      console.log(`  • ${p.id}  (applies_to: ${JSON.stringify(applies)}, enforcement: ${(p as any).enforcement ?? 'strict'})`);
      for (const key of ['allow_paths', 'deny_paths', 'allow_commands', 'deny_commands']) {
        const v = (p as any)[key];
        if (Array.isArray(v) && v.length) console.log(`      ${key}: ${v.join(', ')}`);
      }
    }
    console.log('');
    return;
  }

  // ── v8.1.0: Proposal verification mode ───────────────────────
  if (options?.proposal) {
    const trust: Record<string, string> | undefined = options.trust
      ? { [options.trust.split(':')[0]]: options.trust.split(':').slice(1).join(':') }
      : undefined;
    const decision = engine.evaluateProposal(options.proposal, trust);
    console.log(
      `\n🛡️  Proposal check: "${options.proposal}"` +
        `${options.agent ? ` (agent: ${options.agent})` : ''}\n`
    );
    if (decision.allowed) {
      console.log(`   ✅ Proposal allowed${options.trust ? ' (signature verified).' : '.'}`);
      if (decision.audit) {
        console.log(`   📝 audit: ${JSON.stringify(decision.audit)}`);
      }
      return;
    }
    for (const reason of decision.reasons) console.log(`   ⛔ ${reason}`);
    console.log('\n   ⛔ Proposal DENIED.\n');
    process.exit(1);
  }

  // ── Evaluate mode ──────────────────────────────────────────────────────
  let kind: PolicyActionKind;
  let value: string;
  if (options?.path) {
    kind = 'path';
    value = options.path;
  } else if (options?.command) {
    kind = 'command';
    value = options.command;
  } else {
    kind = 'agent';
    value = options!.agent as string;
  }

  const decision = engine.evaluate({ kind, value, agent: options?.agent });

  console.log(`\n🛡️  Policy check: ${kind} "${value}"${options?.agent ? ` (agent: ${options.agent})` : ''}\n`);

  if (decision.allowed) {
    console.log('   ✅ Allowed.');
    return;
  }

  for (const reason of decision.reasons) {
    console.log(`   ${decision.blocked ? '⛔' : '⚠️ '} ${reason}`);
  }

  if (decision.blocked) {
    console.log('\n   ❌ Action BLOCKED by a strict policy.\n');
    process.exit(1);
  } else {
    console.log('\n   ⚠️  Action allowed with warnings (no strict policy blocked it).\n');
  }
}

function loadDir(dir: string, parser: AlpParser, out: AlpObject[]) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.runtime' || entry.name === '.cache') continue;
      loadDir(full, parser, out);
    } else if (entry.name.endsWith('.alp')) {
      try {
        out.push(...parser.parse(fs.readFileSync(full, 'utf-8')));
      } catch {
        /* skip unparseable files */
      }
    }
  }
}
