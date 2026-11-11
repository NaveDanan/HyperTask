import { create } from '@bufbuild/protobuf';
import { describe, expect, it, vi } from 'vitest';
import { CompleteTextTaskPBSchema, ResponseImageFormatPB, type CompleteTextTaskPB } from '@shared/protobuf/flowy-ai/entities_pb';
import { DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import type { HyperGeneratedImageAsset } from '@shared/api';
import { HyperDocumentSession, type HyperDocumentBackend } from '../src/renderer/features/document/HyperDocumentSession';
import { hyperEditCanvasLabel, hyperInsertCanvasElement, hyperReadCanvas } from '../src/renderer/features/whiteboard/HyperWhiteboardModel';
import { createHyperCanvasImageAIStore, hyperCanvasImageAIRequest, hyperParseCanvasGeneratedImage, type HyperCanvasImageAIBackend } from '../src/renderer/features/canvas-ai/HyperCanvasImageAIStore';

const initial = () => create(DocumentDataPBSchema, { pageId: 'document', blocks: { document: { id: 'document', ty: 'page', childrenId: 'root-children', data: '{}' } }, meta: { childrenMap: { 'root-children': { children: [] } } } });
const asset: HyperGeneratedImageAsset = { path: '/workspace/images/generated.png', previewUrl: 'appflowy-file://local/images/generated.png', width: 1200, height: 800, name: 'generated.png', size: 200 };
const response = '![Generated image](file:///workspace/ai_generated_images/generated.png)';
async function fixture() {
  let saved = initial(), active = true, editable = true, selectedIds: string[] = [];
  const owner = { workspaceId: 'workspace', actorId: 'actor', contextKey: 'context', isCurrent: () => active };
  const documentBackend: HyperDocumentBackend = { open: async () => saved, read: async () => saved, apply: vi.fn(async () => { saved = session.store.getState().document!; }), close: async () => {}, history: async () => {}, listen: () => () => {} };
  const session = new HyperDocumentSession('document', documentBackend, owner); await session.flush();
  let listener: (value: unknown) => void = () => {};
  const close = vi.fn(), backend: HyperCanvasImageAIBackend = { complete: vi.fn(async () => create(CompleteTextTaskPBSchema, { taskId: 'image-task' })), stop: vi.fn(async () => {}), openPort: callback => { listener = callback; return { port: 42n, close }; }, importImage: vi.fn(async () => asset) };
  const store = createHyperCanvasImageAIStore({ session, owner, editable: () => editable, selectedIds: () => selectedIds, currentOwner: () => active ? owner : null }, backend); store.start();
  const generate = () => store.generate('Paint a tree', { selectedIds: [], includePage: false, includeSelected: false });
  const finish = (raw = response) => { listener('data:' + raw); listener('finish:'); };
  return { store, session, backend, documentBackend, generate, finish, close, emit: (value: string) => listener(value), deactivate: () => { active = false; }, lock: () => { editable = false; }, select: (ids: string[]) => { selectedIds = ids; } };
}
describe('Hyper Canvas AI image generation', () => {
  it('requests image-only output and leaves text model selection to the configured image provider', () => {
    const request = hyperCanvasImageAIRequest({ documentId: 'real-document', instruction: 'Paint a tree', source: '', port: 42n });
    expect(request.objectId).toBe('real-document'); expect(request.oneOfFormat.value.imageFormat).toBe(ResponseImageFormatPB.ImageOnly); expect(request.ragIds).toEqual([]);
    expect(request).not.toHaveProperty('model'); expect(request.text).toBe('Paint a tree');
  });
  it('parses exactly one core generated file image and rejects arbitrary Markdown or URLs', () => {
    expect(hyperParseCanvasGeneratedImage(response)).toBe('file:///workspace/ai_generated_images/generated.png');
    for (const raw of ['![Generated image](https://example.org/a.png)', '![other](file:///a.png)', response + '\n' + response, 'Text\n' + response, '![Generated image](file://server/a.png)', '![Generated image](file:///a.png?x=1)', '![Generated image](file:///a.png#x)', '![Generated image](file:///a.png) ![Generated image](file:///b.png)', 'x'.repeat(16385)]) expect(() => hyperParseCanvasGeneratedImage(raw)).toThrow();
  });
  it('previews the trusted imported asset without writes and appends once using local geometry', async () => {
    const f = await fixture(); expect(f.backend.complete).not.toHaveBeenCalled(); await f.generate(); f.finish();
    await vi.waitFor(() => expect(f.store.getState().status).toBe('ready')); expect(f.backend.importImage).toHaveBeenCalledExactlyOnceWith('file:///workspace/ai_generated_images/generated.png'); expect(f.documentBackend.apply).not.toHaveBeenCalled();
    f.session.change(doc => hyperInsertCanvasElement(doc, 'rectangle', { x: 0, y: 0, width: 300, height: 80 })); await f.session.flush();
    const applying = f.store.apply(); await expect(f.store.apply()).rejects.toThrow(); await applying;
    expect(hyperReadCanvas(f.session.store.getState().document!).elements.find(item => item.kind === 'image')).toMatchObject({ x: 364, y: 0, width: 640, height: 800 * 640 / 1200, imagePath: asset.path, alt: 'Paint a tree' });
    await expect(f.store.apply()).rejects.toThrow(); f.store.dispose(); await f.session.dispose();
  });
  it.each(['lock', 'owner'] as const)('refuses apply after %s changes', async reason => {
    const f = await fixture(); await f.generate(); f.finish(); await vi.waitFor(() => expect(f.store.getState().status).toBe('ready'));
    reason === 'lock' ? f.lock() : f.deactivate(); await expect(f.store.apply()).rejects.toThrow(); expect(f.documentBackend.apply).not.toHaveBeenCalled(); f.store.dispose(); await f.session.dispose();
  });
  it('rejects changed included labels and never overwrites a concurrent edit', async () => {
    const f = await fixture(), note = f.session.change(doc => hyperInsertCanvasElement(doc, 'note', { x: 0, y: 0, width: 200, height: 80 }, { text: 'Original' }))!;
    await f.session.flush(); f.select([note.focus!.id]); await f.store.generate('Paint', { selectedIds: [note.focus!.id], includePage: false, includeSelected: true }); f.finish(); await vi.waitFor(() => expect(f.store.getState().status).toBe('ready'));
    f.session.change(doc => hyperEditCanvasLabel(doc, note.focus!.id, 'Concurrent edit')); await f.session.flush(); await expect(f.store.apply()).rejects.toThrow('source changed'); expect(hyperReadCanvas(f.session.store.getState().document!).elements).toHaveLength(1); f.store.dispose(); await f.session.dispose();
  });
  it('cancels late task IDs once and ignores late streams after dismissal', async () => {
    const f = await fixture(); let resolve!: (value: CompleteTextTaskPB) => void;
    f.backend.complete = vi.fn(() => new Promise<CompleteTextTaskPB>(done => { resolve = done; })); const generating = f.generate(); await vi.waitFor(() => expect(resolve).toBeDefined()); f.store.dispose(); f.finish(); resolve(create(CompleteTextTaskPBSchema, { taskId: 'late' })); await generating;
    await vi.waitFor(() => expect(f.backend.stop).toHaveBeenCalledExactlyOnceWith('late')); expect(f.backend.importImage).not.toHaveBeenCalled(); expect(f.documentBackend.apply).not.toHaveBeenCalled(); await f.session.dispose();
  });
  it.each(['stop', 'owner', 'lock'] as const)('ignores a trusted import finishing after %s', async reason => {
    const f = await fixture(); let resolve!: (value: HyperGeneratedImageAsset) => void;
    f.backend.importImage = vi.fn(() => new Promise<HyperGeneratedImageAsset>(done => { resolve = done; })); await f.generate(); f.finish(); expect(f.store.getState().status).toBe('importing');
    if (reason === 'stop') f.store.stop(); else if (reason === 'owner') f.deactivate(); else f.lock();
    resolve(asset); await vi.waitFor(() => expect(f.store.getState().status).toBe(reason === 'stop' ? 'cancelled' : 'error'));
    expect(f.store.getState().asset).toBeNull(); await expect(f.store.apply()).rejects.toThrow(); expect(f.documentBackend.apply).not.toHaveBeenCalled(); f.store.dispose(); await f.session.dispose();
  });
  it('rejects a broken or unsafe asset and provider errors without enabling apply', async () => {
    const f = await fixture(); f.backend.importImage = vi.fn(async () => ({ ...asset, previewUrl: 'https://example.org/a.png' })); await f.generate(); f.finish(); await vi.waitFor(() => expect(f.store.getState().status).toBe('error'));
    await expect(f.store.apply()).rejects.toThrow(); await f.generate(); f.emit('error:Provider unavailable'); expect(f.store.getState().error).toBe('Provider unavailable'); expect(f.documentBackend.apply).not.toHaveBeenCalled(); f.store.dispose(); await f.session.dispose();
  });
  it('never reinserts an accepted draft after a failed save', async () => {
    const f = await fixture(); await f.generate(); f.finish(); await vi.waitFor(() => expect(f.store.getState().status).toBe('ready'));
    f.documentBackend.apply = vi.fn(async () => { throw new Error('Save failed'); }); await expect(f.store.apply()).rejects.toThrow('Save failed'); await expect(f.store.apply()).rejects.toThrow('Generate and review'); expect(hyperReadCanvas(f.session.store.getState().document!).elements).toHaveLength(1); f.store.dispose(); await f.session.dispose();
  });
});
