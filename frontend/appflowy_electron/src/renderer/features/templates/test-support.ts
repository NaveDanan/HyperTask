import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { create } from '@bufbuild/protobuf';
import { FlowyErrorSchema } from '@shared/protobuf/flowy-error/errors_pb';
import { RepeatedViewPBSchema, ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import { vi } from 'vitest';
import { HyperTemplateRepository, type HyperTemplateSource } from './repository';
import { HyperTemplateManifest, type HyperJsonObject } from './models';
import type { HyperTemplateImportBackend } from './import-service';

export const root = resolve('resources/assets/local_templates');
export const readPayload = (name: string): HyperJsonObject => JSON.parse(readFileSync(resolve(root, `payloads/${name}.json`), 'utf8'));
export const manifest = new HyperTemplateManifest(JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8')));
export const entryNamed = (name: string) => { const entry = manifest.templates.find(t => t.publishName === name); if (!entry) throw new Error(name); return entry; };
export function fileSource() {
  return {
    readManifest: vi.fn(async () => readFileSync(resolve(root, 'manifest.json'), 'utf8')),
    readPayload: vi.fn(async (path: string) => readFileSync(resolve(root, path), 'utf8')),
    readMedia: vi.fn(async (path: string) => new Uint8Array(readFileSync(resolve(root, path)))),
  } satisfies HyperTemplateSource;
}
export const fileRepository = () => new HyperTemplateRepository(fileSource());
export function fakeBackend() {
  return {
    importPages: vi.fn<HyperTemplateImportBackend['importPages']>(async () => ({ ok: true, value: create(RepeatedViewPBSchema, { items: [{ id: 'document-view' }] }) })),
    createDatabase: vi.fn<HyperTemplateImportBackend['createDatabase']>(async () => ({ ok: true, value: create(ViewPBSchema, { id: 'database-view' }) })),
    createDocument: vi.fn<HyperTemplateImportBackend['createDocument']>(async () => ({ ok: true, value: undefined })),
    markRowHasDocument: vi.fn<HyperTemplateImportBackend['markRowHasDocument']>(async () => ({ ok: true, value: undefined })),
  };
}
export const failure = (msg: string) => ({ ok: false as const, error: create(FlowyErrorSchema, { msg }) });
export const localUrls = (payload: HyperJsonObject, urls: Set<string>) => { void payload; return Object.fromEntries([...urls].map((url, index) => [url, `/user/media/${index}.bin`])); };