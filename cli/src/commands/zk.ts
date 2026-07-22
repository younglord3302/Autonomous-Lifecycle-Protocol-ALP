import { Command } from 'commander';
import { ZKProofEngine } from '@alp/parser';

export function registerZKCommand(program: Command) {
  const zk = program
    .command('zk')
    .description('Zero-Knowledge policy and compliance proof engine (v18.0.0)');

  zk
    .command('generate')
    .description('Generate a zero-knowledge compliance proof for a statement')
    .argument('<statement>', 'Compliance statement to prove (e.g. "vault-key-unsealed")')
    .argument('<secret>', 'Secret value used for commitment')
    .option('--id <id>', 'Proof object ID', 'zk-proof-1')
    .action((statement, secret, options) => {
      const engine = new ZKProofEngine();
      const proof = engine.generateProof(options.id, statement, secret);

      console.log('\n🔒 Generated Zero-Knowledge Proof (v18.0.0)');
      console.log('==========================================');
      console.log(`  ID:          ${proof.id}`);
      console.log(`  Statement:   ${proof.statement}`);
      console.log(`  Commitment:  ${proof.commitment.slice(0, 16)}...`);
      console.log(`  Verified:    ${proof.verified ? '✅ YES' : '❌ NO'}\n`);
    });

  zk
    .command('verify')
    .description('Verify a zero-knowledge compliance proof hash')
    .argument('<statement>', 'Compliance statement')
    .argument('<commitment>', 'Commitment hash')
    .argument('<proofHash>', 'Combined proof hash')
    .action((statement, commitment, proofHash) => {
      const engine = new ZKProofEngine();
      const isValid = engine.verifyProof({
        id: 'zk-check',
        statement,
        commitment,
        proofHash,
        verified: false,
        createdAt: new Date().toISOString(),
      });

      if (isValid) {
        console.log('\n✅ ZK-Proof Verified: Statement is valid without revealing secret!');
      } else {
        console.log('\n❌ ZK-Proof Failed: Invalid proof hash or commitment mismatch.');
      }
    });
}
