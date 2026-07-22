import * as fs from 'fs';
import * as path from 'path';
import { DomainTrustAnchor, DomainTrustManager, create_domain_keypair } from '@alp/parser';

export function domainTrustCommand(subcommand: string, ...args: string[]) {
  const cwd = process.cwd();
  const alpDir = path.join(cwd, '.alp');
  if (!fs.existsSync(alpDir)) {
    console.error('Error: .alp directory not found. Run `alp init` first.');
    process.exit(1);
  }

  switch (subcommand) {
    case 'create-domain': {
      const domainId = args[0] || 'local';
      const private_key = args[1];
      if (!private_key) {
        console.error('Usage: alp domain-trust create-domain <domain-id> <private-key>');
        process.exit(1);
      }
      const anchor = new DomainTrustAnchor(alpDir, domainId, private_key);
      const root = anchor.create_domain();
      console.log(`Domain '${domainId}' created with trust root.`);
      console.log(`  Public key: ${root.public_key.slice(0, 32)}...`);
      break;
    }
    case 'link': {
      const localDomain = args[0] || 'local';
      const remoteDomain = args[1];
      if (!remoteDomain) {
        console.error('Usage: alp domain-trust link <local-domain> <remote-domain>');
        process.exit(1);
      }
      const manager = new DomainTrustManager(alpDir, localDomain);
      const link = manager.link_domain(remoteDomain);
      console.log(`Link created: ${link.link_id} (${link.local_domain} <-> ${link.remote_domain})`);
      break;
    }
    case 'accept': {
      const localDomain = args[0] || 'local';
      const linkId = args[1];
      if (!linkId) {
        console.error('Usage: alp domain-trust accept <local-domain> <link-id>');
        process.exit(1);
      }
      const manager = new DomainTrustManager(alpDir, localDomain);
      const link = manager.accept_link(linkId);
      if (!link) {
        console.error(`Error: link '${linkId}' not found`);
        process.exit(1);
      }
      console.log(`Link ${linkId} accepted (${link.local_domain} <-> ${link.remote_domain})`);
      break;
    }
    case 'list': {
      const localDomain = args[0] || 'local';
      const manager = new DomainTrustManager(alpDir, localDomain);
      const links = manager.list_links();
      for (const l of links) {
        console.log(`- ${l.link_id}: ${l.local_domain} <-> ${l.remote_domain} [${l.status}]`);
      }
      break;
    }
    case 'revoke': {
      const localDomain = args[0] || 'local';
      const linkId = args[1];
      if (!linkId) {
        console.error('Usage: alp domain-trust revoke <local-domain> <link-id>');
        process.exit(1);
      }
      const manager = new DomainTrustManager(alpDir, localDomain);
      if (manager.revoke_link(linkId)) {
        console.log(`Link ${linkId} revoked.`);
      } else {
        console.error(`Error: link '${linkId}' not found`);
        process.exit(1);
      }
      break;
    }
    default:
      console.error(`Unknown domain-trust subcommand: ${subcommand}`);
      process.exit(1);
  }
}
