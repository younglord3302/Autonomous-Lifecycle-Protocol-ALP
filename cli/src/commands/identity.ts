import * as fs from 'fs';
import * as path from 'path';
import {
  AgentIdentity,
  TrustRegistry,
  VerifiablePresentation,
  AgentKeyStore,
  generateKeypair,
  createDid,
} from '@alp/parser';

export function identityCommand(subcommand: string, ...args: string[]) {
  const cwd = process.cwd();
  const alpDir = path.join(cwd, '.alp');
  if (!fs.existsSync(alpDir)) {
    console.error('Error: .alp directory not found. Run `alp init` first.');
    process.exit(1);
  }

  const keyStore = new AgentKeyStore(alpDir);
  const registry = new TrustRegistry(alpDir);

  switch (subcommand) {
    case 'create': {
      const agentId = args[0];
      if (!agentId) {
        console.error('Usage: alp identity create <agent-id>');
        process.exit(1);
      }
      const keys = generateKeypair();
      const did = createDid(agentId, keys.public_key);
      keyStore.storeKey(did, keys.public_key, keys.private_key);
      console.log(`DID: ${did}`);
      console.log(`Public key: ${keys.public_key}`);
      console.log(`Private key: ${keys.private_key}`);
      break;
    }
    case 'register': {
      const did = args[0];
      const scopesIndex = args.indexOf('--scopes');
      const trustLevelIndex = args.indexOf('--trust-level');
      if (!did || scopesIndex === -1) {
        console.error('Usage: alp identity register <did> --scopes <scope1,scope2> [--trust-level <level>]');
        process.exit(1);
      }
      const scopes = args[scopesIndex + 1]?.split(',').map(s => s.trim()).filter(Boolean) || [];
      const trustLevel = trustLevelIndex !== -1 ? args[trustLevelIndex + 1] || 'standard' : 'standard';
      const entry = registry.register(did, did, scopes, trustLevel);
      console.log(`Registered ${did} with scopes=${entry.scopes.join(',')} trust_level=${entry.trust_level}`);
      break;
    }
    case 'verify': {
      const file = args[0];
      const publicKeyIndex = args.indexOf('--public-key');
      if (!file || publicKeyIndex === -1) {
        console.error('Usage: alp identity verify <presentation-file> --public-key <key>');
        process.exit(1);
      }
      const publicKey = args[publicKeyIndex + 1];
      const content = fs.readFileSync(file, 'utf-8');
      const data = JSON.parse(content);
      const presentation = new VerifiablePresentation(data.did, data.agent_id, data.claims, data.signature, data.issued_at);
      const result = { valid: presentation.verify(publicKey) };
      if (result.valid) {
        console.log('Presentation is valid.');
      } else {
        console.error('Presentation verification failed.');
        process.exit(1);
      }
      break;
    }
    case 'list': {
      const dids = registry.listDids();
      if (dids.length === 0) {
        console.log('No registered DIDs.');
        return;
      }
      for (const did of dids) {
        const entry = registry.resolve(did);
        if (entry) {
          console.log(`- ${did} (${entry.trust_level}) scopes=${entry.scopes.join(',')}`);
        }
      }
      break;
    }
    case 'revoke': {
      const did = args[0];
      if (!did) {
        console.error('Usage: alp identity revoke <did>');
        process.exit(1);
      }
      if (registry.revoke(did)) {
        console.log(`Revoked ${did}`);
      } else {
        console.error(`DID '${did}' not found.`);
        process.exit(1);
      }
      break;
    }
    default:
      console.error(`Unknown identity subcommand: ${subcommand}`);
      process.exit(1);
  }
}
