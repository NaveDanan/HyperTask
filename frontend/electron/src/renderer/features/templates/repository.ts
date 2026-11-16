import { HyperTemplateManifest, HyperTemplateUnavailableError, type HyperJsonObject, type HyperTemplateEntry, type HyperTemplateMediaAsset } from './models';

export interface HyperTemplateSource {
  readManifest(): Promise<unknown>;
  readPayload(path: string): Promise<unknown>;
  readMedia(path: string): Promise<Uint8Array>;
}
function objectJson(value: unknown, label: string): HyperJsonObject {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${label} must be an object`);
  return parsed as HyperJsonObject;
}
export function matchesHyperMediaType(bytes: Uint8Array, contentType: string): boolean {
  const starts = (signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  switch (contentType) {
    case 'image/jpeg': return starts([0xff, 0xd8, 0xff]);
    case 'image/png': return starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/gif': return starts([0x47, 0x49, 0x46, 0x38]);
    case 'image/webp': return starts([0x52, 0x49, 0x46, 0x46]) && bytes.length >= 12 && startsAt(bytes, [0x57, 0x45, 0x42, 0x50], 8);
    case 'application/pdf': return starts([0x25, 0x50, 0x44, 0x46]);
    default: return false;
  }
}
const startsAt = (bytes: Uint8Array, signature: number[], offset: number) => signature.every((byte, index) => bytes[index + offset] === byte);

export class HyperTemplateRepository {
  private manifest?: Promise<HyperTemplateManifest>;
  private readonly previews = new Map<string, Promise<Uint8Array | null>>();
  constructor(readonly source: HyperTemplateSource) {}
  loadManifest(): Promise<HyperTemplateManifest> {
    if (!this.manifest) {
      this.manifest = this.source.readManifest().then(value => new HyperTemplateManifest(objectJson(value, 'Local template manifest'))).catch(error => { this.manifest = undefined; throw error; });
    }
    return this.manifest;
  }
  async loadPayload(entry: HyperTemplateEntry): Promise<HyperJsonObject> {
    if (!entry.isAvailable || entry.payloadPath === null) throw new HyperTemplateUnavailableError(entry);
    return objectJson(await this.source.readPayload(entry.payloadPath), `Payload ${entry.publishName}`);
  }
  async loadMedia(asset: HyperTemplateMediaAsset): Promise<Uint8Array> {
    const bytes = await this.source.readMedia(asset.path);
    if (asset.bytes !== 0 && bytes.length !== asset.bytes) throw new Error(`Media ${asset.path} is ${bytes.length} bytes; manifest says ${asset.bytes}`);
    if (!matchesHyperMediaType(bytes, asset.contentType)) throw new Error(`Media ${asset.path} is not a valid ${asset.contentType} file`);
    return bytes;
  }
  loadPreviewImage(url: string): Promise<Uint8Array | null> {
    let promise = this.previews.get(url);
    if (!promise) {
      promise = this.loadManifest().then(manifest => {
        const asset = manifest.mediaForUrl(url);
        return asset?.isImage && asset.contentType.startsWith('image/') ? this.loadMedia(asset) : null;
      });
      this.previews.set(url, promise);
    }
    return promise;
  }
}