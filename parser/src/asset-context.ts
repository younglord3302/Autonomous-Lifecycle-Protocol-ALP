import * as crypto from 'node:crypto';

export type AssetType = 'image' | 'video' | 'audio' | 'wireframe';

export interface AssetBundle {
  id: string;
  assetType: AssetType;
  mimeType: string;
  digest: string;
  sizeBytes: number;
  dataBase64: string;
  createdAt: string;
}

export class AssetContextEngine {
  /**
   * Package raw data or string into a multi-modal AssetBundle with SHA-256 integrity digest.
   */
  public bundleAsset(id: string, assetType: AssetType, mimeType: string, content: string | Buffer): AssetBundle {
    const buffer = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;
    const digest = crypto.createHash('sha256').update(buffer).digest('hex');
    const dataBase64 = buffer.toString('base64');

    return {
      id,
      assetType,
      mimeType,
      digest,
      sizeBytes: buffer.length,
      dataBase64,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Format an AssetBundle into standard multi-modal prompt injection context syntax.
   */
  public encodeContextPrompt(bundle: AssetBundle): string {
    return `[ALP Multi-Modal Asset Context: @${bundle.id}]
Type: ${bundle.assetType}
MIME: ${bundle.mimeType}
Digest: sha256:${bundle.digest.slice(0, 16)}...
Data: data:${bundle.mimeType};base64,${bundle.dataBase64.slice(0, 32)}...
[End Asset Context]`;
  }

  /**
   * Verify SHA-256 integrity of an AssetBundle.
   */
  public verifyAssetIntegrity(bundle: AssetBundle): boolean {
    if (!bundle || !bundle.dataBase64 || !bundle.digest) return false;
    const buffer = Buffer.from(bundle.dataBase64, 'base64');
    const computedDigest = crypto.createHash('sha256').update(buffer).digest('hex');
    return computedDigest === bundle.digest;
  }
}
