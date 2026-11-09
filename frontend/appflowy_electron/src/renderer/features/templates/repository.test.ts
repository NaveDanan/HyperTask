import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { HyperTemplateRepository } from './repository';
import { HyperTemplateUnavailableError, parseHyperTemplatePreview } from './models';
import { remoteAssetUrlsIn } from './converter';
import { entryNamed, fileSource, manifest, readPayload, root } from './test-support';

describe('bundled catalog and repository', () => {
  it('matches the catalog inventory and provenance', () => {
    expect(manifest.schemaVersion).toBe(3); expect(manifest.fetchedAt).not.toBeNull();
    expect(manifest.templates).toHaveLength(52); expect(manifest.availableTemplates).toHaveLength(50);
    expect(manifest.inventory).toMatchObject({ catalogCount: 52, availableCount: 50, unavailableCount: 2, documentCount: 25, databaseCount: 25 });
    expect(manifest.categories).toHaveLength(15);
    expect(manifest.categoryById('31042f6f-9e91-4c3b-a50c-8a735127598f')).toMatchObject({ name: 'Project Management', categoryType: 0 });
    expect(manifest.categories.find(c => c.name === 'AI-powered')!.categoryType).toBe(1);
    for (const entry of manifest.templates) {
      expect(entry.viewId).toBeTruthy(); expect(entry.publishName).toBeTruthy(); expect(entry.viewUrl).toMatch(/^https:\/\/appflowy.com\//);
      expect(entry.categoryIds.length).toBeGreaterThan(0); expect(entry.categoryIds).toHaveLength(entry.categoryNames.length);
      if (entry.isAvailable) {
        expect(entry.blocker).toBeNull(); expect(createHash('sha256').update(readFileSync(resolve(root, entry.payloadPath!))).digest('hex')).toBe(entry.payloadSha256);
      } else { expect(entry.payloadPath).toBeNull(); expect(entry.kind).toBeNull(); expect(entry.blocker).toBeTruthy(); }
    }
  });
  it('filters name, description and category names with case and whitespace normalization', () => {
    expect(manifest.filter(null, '  WEEKLY ').map(t => t.name)).toContain('Weekly To-Do List');
    expect(manifest.filter(null, 'kanban').some(t => t.categoryNames.includes('Kanban'))).toBe(true);
    const projects = manifest.filter('31042f6f-9e91-4c3b-a50c-8a735127598f', 'tracker');
    expect(projects.length).toBeGreaterThan(0); expect(projects.every(t => t.categoryNames.includes('Project Management'))).toBe(true);
    expect(manifest.filter(null, 'no-such-template-xyz')).toEqual([]);
  });
  it('caches the manifest including concurrent reads, and loads payloads only on demand', async () => {
    const source = fileSource(), repository = new HyperTemplateRepository(source);
    const first = repository.loadManifest(), second = repository.loadManifest();
    expect(first).toBe(second); expect(await first).toBe(await second); expect(source.readManifest).toHaveBeenCalledTimes(1);
    expect(source.readPayload).not.toHaveBeenCalled();
    const entry = entryNamed('Weekly-To-Do-List'), payload = await repository.loadPayload(entry);
    expect(source.readPayload).toHaveBeenCalledExactlyOnceWith(entry.payloadPath);
    expect(payload.data).toMatchObject({ kind: 'document', publishName: 'Weekly-To-Do-List' });
  });
  it('rejects unavailable payloads before reading them', async () => {
    const source = fileSource(), repository = new HyperTemplateRepository(source);
    await expect(repository.loadPayload(manifest.templates.find(t => !t.isAvailable)!)).rejects.toBeInstanceOf(HyperTemplateUnavailableError);
    expect(source.readPayload).not.toHaveBeenCalled();
  });
  it('rejects non-object manifests and payloads and allows retry after manifest failure', async () => {
    const source = fileSource(); source.readManifest.mockResolvedValueOnce('[]'); source.readPayload.mockResolvedValueOnce('null');
    const repository = new HyperTemplateRepository(source);
    await expect(repository.loadManifest()).rejects.toThrow('must be an object'); expect((await repository.loadManifest()).templates).toHaveLength(52);
    await expect(repository.loadPayload(entryNamed('Weekly-To-Do-List'))).rejects.toThrow('must be an object');
  });
});
describe('bundled media', () => {
  it('has the recorded sizes, signatures, SHA-256 names and checksums', async () => {
    const repository = new HyperTemplateRepository(fileSource());
    expect(manifest.media).toHaveLength(20); expect(manifest.inventory.mediaCount).toBe(20);
    expect(manifest.media.reduce((n, asset) => n + asset.bytes, 0)).toBe(manifest.inventory.mediaBytes);
    for (const asset of manifest.media) {
      const bytes = await repository.loadMedia(asset);
      expect(bytes.length).toBe(asset.bytes); expect(asset.path).toMatch(/^media\/[0-9a-f]{64}\.[a-z0-9]+$/);
      expect(asset.path).toContain(asset.sha256); expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
      expect(asset.url).toMatch(/^https:\/\//); expect(asset.referencedBy.length).toBeGreaterThan(0);
      expect(asset.kind).toBe(asset.contentType === 'application/pdf' ? 'file' : 'image'); expect(asset.isImage).toBe(asset.kind === 'image');
    }
    expect(readdirSync(resolve(root, 'media'))).toHaveLength(20);
  });
  it('rejects HTML advertised as an image', async () => {
    const source = fileSource(); source.readMedia.mockResolvedValue(new TextEncoder().encode('<html>web app shell</html>'));
    await expect(new HyperTemplateRepository(source).loadMedia({ ...manifest.media[0], bytes: 0, contentType: 'image/webp' })).rejects.toThrow('not a valid');
  });
  it('rejects media whose size differs from the manifest', async () => {
    const source = fileSource(); source.readMedia.mockResolvedValue(new Uint8Array(manifest.media[0].bytes + 1));
    await expect(new HyperTemplateRepository(source).loadMedia(manifest.media[0])).rejects.toThrow('manifest says');
  });
  it('attributes every payload reference and has no orphaned media', () => {
    const referenced = new Set<string>();
    for (const entry of manifest.availableTemplates) {
      const urls = remoteAssetUrlsIn(readPayload(entry.publishName)); expect([...urls].sort()).toEqual([...entry.mediaUrls].sort());
      for (const url of urls) { referenced.add(url); expect(manifest.mediaForUrl(url)?.referencedBy).toContain(entry.publishName); }
    }
    expect([...referenced].sort()).toEqual(manifest.media.map(m => m.url).sort());
  });
});
describe('previews', () => {
  it('uses only each template’s own image or content summary', () => {
    for (const entry of manifest.templates) {
      if (!entry.isAvailable) { expect(entry.preview).toBeNull(); continue; }
      expect(entry.preview).not.toBeNull();
      const preview = entry.preview!;
      if (preview.hasImage) {
        expect(entry.mediaUrls).toContain(preview.imageUrl); expect(manifest.mediaForUrl(preview.imageUrl!)?.isImage).toBe(true);
        expect(manifest.mediaForUrl(preview.imageUrl!)?.contentType).toMatch(/^image\//);
      } else if (entry.kind === 'database') expect(preview.highlights.length).toBeGreaterThan(0);
      for (const text of preview.highlights) { expect(text.length).toBeLessThanOrEqual(60); expect(text.trim()).toBe(text); }
    }
  });
  it('parses cover and content previews, ignores invalid colors and defaults unknown sources', () => {
    expect(parseHyperTemplatePreview({ source: 'cover', imageUrl: 'https://example.test/cover.png', color: '#ffe8e0ff' })).toMatchObject({ source: 'cover', hasImage: true, colorArgb: 0xffe8e0ff, highlights: [] });
    expect(parseHyperTemplatePreview({ source: 'content', color: '#fffff5f5', highlights: ['Project', 'Status'] })).toMatchObject({ hasImage: false, highlights: ['Project', 'Status'] });
    expect(parseHyperTemplatePreview({ source: 'screenshot', imageUrl: 'x', color: '0xffe8e0ff' })).toMatchObject({ source: 'content', hasImage: false, colorArgb: null });
  });
  it('reads image bytes once per URL, and returns null for missing images and PDFs', async () => {
    const source = fileSource(), repository = new HyperTemplateRepository(source), url = entryNamed('Business-Overview-One-Pager').preview!.imageUrl!;
    const first = repository.loadPreviewImage(url), second = repository.loadPreviewImage(url);
    expect(first).toBe(second); expect((await first)?.length).toBe(manifest.mediaForUrl(url)!.bytes); expect(source.readMedia).toHaveBeenCalledTimes(1);
    expect(await repository.loadPreviewImage('https://example.test/not-bundled.png')).toBeNull();
    expect(await repository.loadPreviewImage(manifest.media.find(m => m.kind === 'file')!.url)).toBeNull();
  });
});