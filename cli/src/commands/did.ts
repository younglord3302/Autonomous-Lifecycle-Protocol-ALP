import { Command } from 'commander';
import { DIDIdentityEngine } from '@alp/parser';

export function registerDIDCommand(program: Command) {
  const did = program
    .command('did')
    .description('Decentralized registry and blockchain DID anchoring (v20.0.0)');

  did
    .command('create')
    .description('Generate a new decentralized agent DID identity')
    .argument('<agentId>', 'Agent identifier name')
    .option('--chain <chainId>', 'Target blockchain network', 'alp-mainnet-1')
    .action((agentId, options) => {
      const engine = new DIDIdentityEngine();
      const doc = engine.createDID(agentId, options.chain);

      console.log('\n🆔 Created Decentralized DID Document (v20.0.0)');
      console.log('================================================');
      console.log(`  ID:         ${doc.id}`);
      console.log(`  DID URI:    ${doc.didUri}`);
      console.log(`  Network:    ${doc.chainId}`);
      console.log(`  Created At: ${doc.createdAt}\n`);
    });

  did
    .command('anchor')
    .description('Anchor an agent DID identity onto the blockchain ledger')
    .argument('<agentId>', 'Agent identifier name')
    .action((agentId) => {
      const engine = new DIDIdentityEngine();
      const doc = engine.createDID(agentId);
      const receipt = engine.anchorToLedger(doc);

      console.log('\n⛓️ DID Blockchain Ledger Anchor Receipt (v20.0.0)');
      console.log('==================================================');
      console.log(`  DID URI:     ${receipt.didUri}`);
      console.log(`  Block Hash:  ${receipt.blockHash}`);
      console.log(`  Tx Hash:     ${receipt.transactionHash}`);
      console.log(`  Status:      ${receipt.status === 'CONFIRMED' ? '✅ CONFIRMED' : '⏳ PENDING'}\n`);
    });
}
