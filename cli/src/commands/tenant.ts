import * as fs from 'fs';
import * as path from 'path';
import { TenantManager, TenantVault, TenantIsolationError, create_tenant_key } from '@alp/parser';

export function tenantCommand(subcommand: string, ...args: string[]) {
  const cwd = process.cwd();
  const alpDir = path.join(cwd, '.alp');
  if (!fs.existsSync(alpDir)) {
    console.error('Error: .alp directory not found. Run `alp init` first.');
    process.exit(1);
  }

  const manager = new TenantManager(alpDir);

  switch (subcommand) {
    case 'create': {
      const name = args[0] || args[1] || 'default';
      const key = create_tenant_key();
      manager.create_tenant(name, name, key.public_key);
      console.log(`Tenant '${name}' created with public key: ${key.public_key}`);
      break;
    }
    case 'list': {
      const tenants = manager.list_tenants();
      if (tenants.length === 0) {
        console.log('No tenants registered.');
        return;
      }
      for (const t of tenants) {
        console.log(`- ${t.tenant_id} (${t.name}) key_hash=${t.key_hash.slice(0, 16)}...`);
      }
      break;
    }
    case 'vault': {
      const tenantId = args[0];
      if (!tenantId) {
        console.error('Error: tenant id required');
        process.exit(1);
      }
      const vault = manager.tenant_vault(tenantId);
      const action = args[1];
      if (action === 'list') {
        const secrets = vault.list_secrets();
        for (const s of secrets) {
          console.log(`- ${s.secret_id} (${s.created_at})`);
        }
      } else if (action === 'seal' && args[2]) {
        const sealed = vault.seal_secret(args[2], args[3] || '');
        console.log(`Sealed secret '${args[2]}': nonce=${sealed.nonce}`);
      } else if (action === 'unseal' && args[2]) {
        const ctx = manager.get_tenant(tenantId);
        if (!ctx) {
          console.error(`Error: tenant '${tenantId}' not found`);
          process.exit(1);
        }
        try {
          const entry = vault.unseal_secret(args[2], ctx.key_hash);
          console.log(`Unsealed secret '${args[2]}': ciphertext=${entry.ciphertext.slice(0, 16)}...`);
        } catch (err) {
          console.error(`Error: ${(err as Error).message}`);
          process.exit(1);
        }
      } else {
        console.error('Usage: alp tenant vault <id> list|seal <secret> [value]|unseal <secret>');
        process.exit(1);
      }
      break;
    }
    case 'delete': {
      const tenantId = args[0];
      if (!tenantId) {
        console.error('Error: tenant id required');
        process.exit(1);
      }
      if (manager.delete_tenant(tenantId)) {
        console.log(`Tenant '${tenantId}' deleted.`);
      } else {
        console.error(`Error: tenant '${tenantId}' not found`);
        process.exit(1);
      }
      break;
    }
    default:
      console.error(`Unknown tenant subcommand: ${subcommand}`);
      process.exit(1);
  }
}
