import { describe, it, expect } from 'vitest';
import { AssetContextEngine } from '../src/asset-context';

describe('AssetContextEngine (v24.0.0)', () => {
  it('bundles asset into multi-modal bundle with SHA-256 digest', () => {
    const engine = new AssetContextEngine();
    const bundle = engine.bundleAsset('ui-mockup', 'wireframe', 'image/png', 'sample-ui-wireframe-bytes');

    expect(bundle.id).toBe('ui-mockup');
    expect(bundle.assetType).toBe('wireframe');
    expect(bundle.mimeType).toBe('image/png');
    expect(bundle.digest).toBeDefined();
    expect(bundle.dataBase64).toBeDefined();
  });

  it('encodes asset bundle into multi-modal prompt injection context', () => {
    const engine = new AssetContextEngine();
    const bundle = engine.bundleAsset('arch-diagram', 'image', 'image/svg+xml', '<svg>Diagram</svg>');
    const prompt = engine.encodeContextPrompt(bundle);

    expect(prompt).toContain('[ALP Multi-Modal Asset Context: @arch-diagram]');
    expect(prompt).toContain('Type: image');
    expect(prompt).toContain('MIME: image/svg+xml');
  });

  it('verifies valid asset digest and rejects tampered data', () => {
    const engine = new AssetContextEngine();
    const bundle = engine.bundleAsset('demo-video', 'video', 'video/mp4', 'video-frame-data');

    expect(engine.verifyAssetIntegrity(bundle)).toBe(true);

    const tampered = { ...bundle, dataBase64: Buffer.from('corrupted-data').toString('base64') };
    expect(engine.verifyAssetIntegrity(tampered)).toBe(false);
  });
});
