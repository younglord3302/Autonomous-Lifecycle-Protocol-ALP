import { Command } from 'commander';
import { TenantMeshEngine, EnterpriseRole } from '@alp/parser';

export function registerTenantMeshCommand(program: Command) {
  const mesh = program
    .command('tenant-mesh')
    .description('Multi-tenant enterprise mesh & SAML/OIDC sync engine (v27.0.0)');

  mesh
    .command('init')
    .description('Initialize an enterprise tenant mesh with SSO configuration')
    .argument('<tenantId>', 'Tenant identifier')
    .argument('<orgName>', 'Organization name')
    .option('--sso <provider>', 'SSO identity provider', 'SAML-Okta')
    .action((tenantId, orgName, options) => {
      const engine = new TenantMeshEngine();
      const t = engine.createTenantMesh(tenantId, orgName, options.sso);

      console.log('\n🏢 Enterprise Tenant Mesh Initialized (v27.0.0)');
      console.log('================================================');
      console.log(`  Tenant ID:   ${t.tenantId}`);
      console.log(`  Org Name:    ${t.orgName}`);
      console.log(`  SSO Sync:    ${t.ssoProvider}`);
      console.log(`  Max Workspaces: ${t.maxWorkspaces}\n`);
    });

  mesh
    .command('authorize')
    .description('Authorize a user/agent action using RBAC policy matrix')
    .argument('<tenantId>', 'Tenant ID')
    .argument('<userOrAgent>', 'User or Agent identifier')
    .argument('<role>', 'Enterprise role: admin | auditor | developer')
    .argument('<action>', 'Action string (e.g. read:logs, tenant:delete)')
    .action((tenantId, userOrAgent, role, action) => {
      const engine = new TenantMeshEngine();
      engine.createTenantMesh(tenantId, 'Acme Corp');
      engine.assignRole(tenantId, userOrAgent, role as EnterpriseRole);

      const isAllowed = engine.authorizeAction(tenantId, userOrAgent, action);

      console.log('\n🔐 RBAC Authorization Decision (v27.0.0)');
      console.log('=======================================');
      console.log(`  Subject:     ${userOrAgent} (${role})`);
      console.log(`  Action:      ${action}`);
      console.log(`  Result:      ${isAllowed ? '✅ PERMITTED' : '❌ DENIED'}\n`);
    });
}
