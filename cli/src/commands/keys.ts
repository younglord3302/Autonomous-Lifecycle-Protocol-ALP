import * as fs from 'fs';
import * as path from 'path';
import { generateKeypair, writeKeypair, fingerprint } from '../signing';

/**
 * `alp keys` — Manage registry package-signing keypairs (v4.1 registry trust).
 *
 *   alp keys generate            # write registry.key (600) + registry.pub here
 *   alp keys fingerprint <file>  # print the trust fingerprint of a public key
 */
export function keysCommand(sub: string | undefined, target?: string) {
  const cwd = process.cwd();
  switch (sub) {
    case 'generate': {
      const { privateKey, publicKey } = generateKeypair();
      const { priv, pub } = writeKeypair(cwd, privateKey, publicKey);
      console.log(`🔑 Generated Ed25519 signing keypair`);
      console.log(`   private: ${priv}  (perms 600 — keep secret)`);
      console.log(`   public:  ${pub}`);
      console.log(`   fingerprint: ${fingerprint(publicKey)}`);
      console.log(`   Add the fingerprint to consumers' .alprc trustedKeys to enforce signed installs.`);
      return;
    }
    case 'fingerprint': {
      if (!target) { console.error('Usage: alp keys fingerprint <registry.pub>'); process.exit(1); }
      const pub = fs.readFileSync(path.resolve(cwd, target), 'utf-8');
      console.log(fingerprint(pub));
      return;
    }
    default:
      console.error('Usage: alp keys <generate|fingerprint>');
      process.exit(1);
  }
}
