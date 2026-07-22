import { Command } from 'commander';
import { AssetContextEngine, AssetType } from '@alp/parser';

export function registerAssetCommand(program: Command) {
  const asset = program
    .command('asset')
    .description('Multi-modal agent context bundling and verification (v24.0.0)');

  asset
    .command('bundle')
    .description('Bundle a multi-modal asset (wireframe/image/video/audio) into context payload')
    .argument('<id>', 'Asset ID')
    .argument('<type>', 'Asset type: image | video | audio | wireframe')
    .argument('<mimeType>', 'MIME type (e.g. image/png)')
    .argument('<content>', 'Raw text or string representation')
    .action((id, type, mimeType, content) => {
      const engine = new AssetContextEngine();
      const bundle = engine.bundleAsset(id, type as AssetType, mimeType, content);
      const prompt = engine.encodeContextPrompt(bundle);

      console.log('\n🎨 Multi-Modal Asset Bundle Created (v24.0.0)');
      console.log('============================================');
      console.log(`  Asset ID:   ${bundle.id}`);
      console.log(`  Type:       ${bundle.assetType}`);
      console.log(`  Digest:     sha256:${bundle.digest.slice(0, 16)}...`);
      console.log(`  Size:       ${bundle.sizeBytes} bytes`);
      console.log(`\n  Encoded Prompt Injection:\n${prompt}\n`);
    });

  asset
    .command('verify')
    .description('Verify integrity digest of an AssetBundle base64 payload')
    .argument('<id>', 'Asset ID')
    .argument('<digest>', 'SHA-256 digest string')
    .argument('<dataBase64>', 'Base64 encoded payload')
    .action((id, digest, dataBase64) => {
      const engine = new AssetContextEngine();
      const isValid = engine.verifyAssetIntegrity({
        id,
        assetType: 'image',
        mimeType: 'image/png',
        digest,
        sizeBytes: Buffer.from(dataBase64, 'base64').length,
        dataBase64,
        createdAt: new Date().toISOString(),
      });

      if (isValid) {
        console.log('\n✅ Asset Integrity Verified: SHA-256 digest matches payload!');
      } else {
        console.log('\n❌ Asset Integrity Check Failed: SHA-256 digest mismatch.');
      }
    });
}
