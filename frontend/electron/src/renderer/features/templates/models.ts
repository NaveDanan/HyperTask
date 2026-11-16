/** Catalog metadata remains compatible with the bundled Flutter manifest. */
export type HyperTemplateKind = 'document' | 'database';
export interface HyperTemplateCategory {
  id: string; name: string; icon: string; bgColor: string; description: string; categoryType: number; priority: number;
}
export interface HyperTemplatePreview {
  source: 'cover' | 'image' | 'content'; imageUrl: string | null; colorArgb: number | null; highlights: string[]; hasImage: boolean;
}
export interface HyperTemplateEntry {
  viewId: string; name: string; description: string; viewUrl: string; creatorName: string;
  primaryCategoryId: string | null; categoryIds: string[]; categoryNames: string[];
  isFeatured: boolean; isNew: boolean; publishNamespace: string; publishName: string;
  kind: HyperTemplateKind | null; payloadPath: string | null; payloadSha256: string | null;
  blocker: string | null; mediaUrls: string[]; preview: HyperTemplatePreview | null; isAvailable: boolean;
}
export interface HyperTemplateMediaAsset {
  url: string; path: string; sha256: string; bytes: number; contentType: string; kind: string; referencedBy: string[]; isImage: boolean;
}
export interface HyperTemplateInventory {
  catalogCount: number; availableCount: number; unavailableCount: number; documentCount: number; databaseCount: number; mediaCount: number; mediaBytes: number;
}
export type HyperJsonObject = Record<string, unknown>;
export const asMap = (value: unknown): HyperJsonObject => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as HyperJsonObject : {};
export const asList = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export const asString = (value: unknown, fallback = ''): string => value == null || value === '' ? fallback : String(value);
export const stringList = (value: unknown): string[] => asList(value).filter((v): v is string => typeof v === 'string');
export function asInt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && /^[+-]?\d+$/.test(value)) return Number(value);
  return undefined;
}
export function parseHyperTemplatePreview(value: unknown): HyperTemplatePreview {
  const json = asMap(value);
  const source = json.source === 'cover' || json.source === 'image' ? json.source : 'content';
  const imageUrl = typeof json.imageUrl === 'string' ? json.imageUrl : null;
  return { source, imageUrl, hasImage: imageUrl !== null && source !== 'content', highlights: stringList(json.highlights),
    colorArgb: typeof json.color === 'string' && /^#[0-9a-fA-F]{8}$/.test(json.color) ? parseInt(json.color.slice(1), 16) : null };
}
export class HyperTemplateUnavailableError extends Error {
  constructor(entry: HyperTemplateEntry) { super(`${entry.name} has no payload: ${entry.blocker ?? 'unknown blocker'}`); }
}
export class HyperTemplateManifest {
  readonly schemaVersion: number;
  readonly fetchedAt: Date | null;
  readonly inventory: HyperTemplateInventory;
  readonly categories: HyperTemplateCategory[];
  readonly templates: HyperTemplateEntry[];
  readonly media: HyperTemplateMediaAsset[];
  constructor(json: HyperJsonObject) {
    this.schemaVersion = asInt(json.schemaVersion) ?? 0;
    const fetched = new Date(asString(asMap(json.source).fetchedAt));
    this.fetchedAt = Number.isNaN(fetched.getTime()) ? null : fetched;
    const inventory = asMap(json.inventory);
    this.inventory = Object.fromEntries(['catalogCount', 'availableCount', 'unavailableCount', 'documentCount', 'databaseCount', 'mediaCount', 'mediaBytes'].map(key => [key, asInt(inventory[key]) ?? 0])) as unknown as HyperTemplateInventory;
    this.categories = asList(json.categories).map(asMap).map(c => ({ id: asString(c.id), name: asString(c.name), icon: asString(c.icon), bgColor: asString(c.bgColor), description: asString(c.description), categoryType: asInt(c.categoryType) ?? 0, priority: asInt(c.priority) ?? 0 }));
    this.templates = asList(json.templates).map(asMap).map(t => {
      const kind = t.kind === 'document' || t.kind === 'database' ? t.kind : null;
      const payloadPath = typeof t.payload === 'string' ? t.payload : null;
      return { viewId: asString(t.viewId), name: asString(t.name), description: asString(t.description), viewUrl: asString(t.viewUrl), creatorName: asString(asMap(t.creator).name),
        primaryCategoryId: typeof t.primaryCategoryId === 'string' ? t.primaryCategoryId : null, categoryIds: stringList(t.categoryIds), categoryNames: stringList(t.categoryNames),
        isFeatured: t.isFeatured === true, isNew: t.isNew === true, publishNamespace: asString(t.publishNamespace), publishName: asString(t.publishName), kind, payloadPath,
        payloadSha256: typeof t.payloadSha256 === 'string' ? t.payloadSha256 : null, blocker: typeof t.blocker === 'string' ? t.blocker : null,
        mediaUrls: stringList(t.mediaUrls), preview: t.preview ? parseHyperTemplatePreview(t.preview) : null, isAvailable: kind !== null && payloadPath !== null };
    });
    this.media = asList(json.media).map(asMap).map(m => ({ url: asString(m.url), path: asString(m.path), sha256: asString(m.sha256), bytes: asInt(m.bytes) ?? 0,
      contentType: asString(m.contentType), kind: asString(m.kind, 'image'), referencedBy: stringList(m.referencedBy), isImage: asString(m.kind, 'image') === 'image' }));
  }
  mediaForUrl(url: string) { return this.media.find(asset => asset.url === url); }
  categoryById(id: string) { return this.categories.find(category => category.id === id); }
  get availableTemplates() { return this.templates.filter(entry => entry.isAvailable); }
  filter(categoryId: string | null = null, query = '') {
    const needle = query.trim().toLowerCase();
    return this.templates.filter(entry => (categoryId === null || entry.categoryIds.includes(categoryId)) &&
      [entry.name, entry.description, ...entry.categoryNames].some(text => text.toLowerCase().includes(needle)));
  }
}