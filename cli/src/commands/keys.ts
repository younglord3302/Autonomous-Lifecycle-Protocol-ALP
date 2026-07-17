import * as fs from 'fs';
import * as path from 'path';
import os from 'os';
import { generateKeypair, writeKeypair, fingerprint, resolvePublicKey } from '../signing';

/**
 * `alp keys` — Manage registry package-signing keypairs (v4.2 registry trust).
 *
 *   alp keys generate            # write registry.key (600) + registry.pub here
 *   alp keys fingerprint <file>  # print the trust fingerprint of a public key
 *   alp keys trust add <ns|*> <fingerprint|file>  # pin a trust root in .alprc
 *   alp keys trust list                          # show configured .alprc trust roots
 *
 * Note: commander drops a leading `@`, so pass the namespace WITHOUT it
 * (e.g. `alp keys trust add demo <fp>`); it is normalized to `@demo`.
 */

const ALPRC_CANDIDATES = ['.alprc', '.alprc.json'];

function findAlprc(cwd: string = process.cwd()): string {
  for (const name of ALPRC_CANDIDATES) {
    const p = path.join(cwd, name);
    if (fs.existsSync(p)) return p;
  }
  return path.join(cwd, '.alprc');
}

function readAlprc(p: string): Record<string, any> {
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return {}; }
}

export function keysCommand(sub: string | undefined, rest: string[] = []) {
  const cwd = process.cwd();
  const target = rest[0];
  const extra = rest[1];
  switch (sub) {
    case 'generate': {
      const { privateKey, publicKey } = generateKeypair();
      const { priv, pub } = writeKeypair(cwd, privateKey, publicKey);
      console.log(`🔑 Generated Ed25519 signing keypair`);
      console.log(`   private: ${priv}  (perms 600 — keep secret)`);
      console.log(`   public:  ${pub}`);
      console.log(`   fingerprint: ${fingerprint(publicKey)}`);
      console.log(`   Pin it as a trust root with: alp keys trust add <namespace|*> ${fingerprint(publicKey)}`);
      return;
    }
    case 'fingerprint': {
      if (!target) { console.error('Usage: alp keys fingerprint <registry.pub>'); process.exit(1); }
      const pub = fs.readFileSync(path.resolve(cwd, target), 'utf-8');
      console.log(fingerprint(pub));
      return;
    }
    case 'trust': {
      return keysTrustCommand(rest);
    }
    default:
      console.error('Usage: alp keys <generate|fingerprint|trust>');
      process.exit(1);
  }
}

function keysTrustCommand(rest: string[]) {
  const action = rest[0];
  const value = rest.slice(1).join(' ').trim();
  const cwd = process.cwd();
  const rcPath = findAlprc(cwd);
  const rc = readAlprc(rcPath);
  rc.trustedKeys = rc.trustedKeys || {};

  if (action === 'add') {
    // value = "<namespace|*> <fingerprint|file>"
    if (!value) { console.error('Usage: alp keys trust add <namespace|*> <fingerprint|file>'); process.exit(1); }
    const space = value.indexOf(' ');
    const ns = (space > 0 ? value.slice(0, space) : value).trim();
    const raw = (space > 0 ? value.slice(space + 1) : '').trim();
    if (!ns || !raw) { console.error('Usage: alp keys trust add <namespace|*> <fingerprint|file>'); process.exit(1); }
    const normalizedNs = ns === '*' ? '*' : ns.startsWith('@') ? ns : '@' + ns;
    // Accept either an inline fingerprint (alp1...) or a public-key file path.
    const trust = raw.startsWith('alp1') ? raw : fingerprint(resolvePublicKey(raw));
    rc.trustedKeys[normalizedNs] = trust;
    fs.writeFileSync(rcPath, JSON.stringify(rc, null, 2));
    console.log(`🔒 Trusted ${normalizedNs} -> ${trust}`);
    console.log(`   written to ${rcPath}`);
    return;
  }
  if (action === 'list' || !action) {
    const entries = Object.entries(rc.trustedKeys || {});
    if (!entries.length) { console.log('No trust roots configured. Add one with: alp keys trust add <namespace|*> <fingerprint>'); return; }
    console.log(`${entries.length} trust root(s) in ${rcPath}:`);
    for (const [ns, fp] of entries) console.log(`  • ${ns}  ->  ${fp}`);
    return;
  }
  console.error('Usage: alp keys trust <add|list>');
  process.exit(1);
}
