import { create } from '@bufbuild/protobuf';
import { describe, expect, it, vi } from 'vitest';
import { ViewLayoutPB, ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import { ImportTypePB } from '@shared/protobuf/flowy-folder/import_pb';
import { HyperDocumentFileImporter, type HyperDocumentFileImportBackend } from '../src/renderer/features/document-import/HyperDocumentFileImporter';
function setup() {
  let identity = { workspaceId: 'workspace', userId: 'user' };
  const parent = create(ViewPBSchema, { id: 'parent', name: 'Parent' });
  const api: HyperDocumentFileImportBackend = {
    identity: vi.fn(async () => identity), view: vi.fn(async () => parent), readText: vi.fn(async () => 'text'),
    convert: vi.fn(async () => new Uint8Array([1])),
    importItem: vi.fn(async (_, item) => [create(ViewPBSchema, { id: item.name, name: item.name, parentViewId: 'parent', layout: item.viewLayout })]),
  };
  return { api, parent, importer: new HyperDocumentFileImporter(api), switchActor: () => { identity = { ...identity, userId: 'other' }; } };
}
describe('Hyper Markdown/text/CSV import failures', () => {
  it('preserves literal POSIX filename backslashes and supports Windows picker paths', async () => {
    const { importer } = setup();
    const result = await importer.importFiles(await importer.capture('parent'), 'markdownOrText', ['/tmp/a\\b.md', 'C:\\Users\\reader\\notes.md']);
    expect(result.imported.map(view => view.name)).toEqual(['a\\b', 'notes']);
    expect(result.failures).toEqual([]);
  });
  it('captures destination before picking and reports no success for an empty selection', async () => {
    const { api, importer } = setup(), target = await importer.capture('parent');
    expect(target).toEqual({ parentId: 'parent', workspaceId: 'workspace', userId: 'user' }); expect(api.view).toHaveBeenCalledWith('parent');
    expect(await importer.importFiles(target, 'csv', [])).toEqual({ imported: [], failures: [], cancelled: false });
    expect(api.readText).not.toHaveBeenCalled(); expect(api.importItem).not.toHaveBeenCalled();
  });
  it('reports unreadable and conversion failures while retaining independently imported pages', async () => {
    const { api, importer } = setup();
    vi.mocked(api.readText).mockImplementation(async path => path === 'unreadable.md' ? null : path);
    vi.mocked(api.convert).mockImplementation(async text => { if (text === 'broken.md') throw new Error('Conversion failed'); return new Uint8Array([1]); });
    const result = await importer.importFiles(await importer.capture('parent'), 'markdownOrText', ['unreadable.md', 'broken.md', 'good.md']);
    expect(result.imported.map(view => view.name)).toEqual(['good']); expect(result.failures.map(failure => [failure.path, failure.uncertain])).toEqual([['unreadable.md', false], ['broken.md', false]]);
    expect(api.importItem).toHaveBeenCalledTimes(1);
  });
  it('keeps confirmed pages and stops after a native failure without retrying uncertain mutations', async () => {
    const { api, importer } = setup();
    vi.mocked(api.importItem).mockImplementation(async (_, item) => { if (item.name === 'bad') throw new Error('Native failure'); return [create(ViewPBSchema, { id: item.name })]; });
    const result = await importer.importFiles(await importer.capture('parent'), 'csv', ['good.csv', 'bad.csv', 'remaining.csv']);
    expect(result.imported.map(view => view.id)).toEqual(['good']); expect(result.failures).toEqual([{ path: 'bad.csv', message: 'Native failure', uncertain: true }]);
    expect(api.importItem).toHaveBeenCalledTimes(2); expect(api.readText).not.toHaveBeenCalledWith('remaining.csv');
    const item = vi.mocked(api.importItem).mock.calls[0][1]; expect(item.importType).toBe(ImportTypePB.CSV); expect(item.viewLayout).toBe(ViewLayoutPB.Grid);
  });
  it('blocks an actor switch after the picker and a destination lock during conversion', async () => {
    const changed = setup(), target = await changed.importer.capture('parent'); changed.switchActor();
    const blocked = await changed.importer.importFiles(target, 'markdownOrText', ['page.md']);
    expect(blocked.failures[0].message).toContain('signed-in user changed'); expect(changed.api.readText).not.toHaveBeenCalled(); expect(changed.api.importItem).not.toHaveBeenCalled();
    const locked = setup(); vi.mocked(locked.api.convert).mockImplementation(async () => { locked.parent.oneOfIsLocked = { case: 'isLocked', value: true }; return new Uint8Array([1]); });
    const result = await locked.importer.importFiles(await locked.importer.capture('parent'), 'markdownOrText', ['page.md']);
    expect(result.failures[0].message).toContain('locked'); expect(locked.api.importItem).not.toHaveBeenCalled();
  });
  it('cancels before writes while preserving a page confirmed just before cancellation', async () => {
    const cancelled = setup(), target = await cancelled.importer.capture('parent'), controller = new AbortController();
    vi.mocked(cancelled.api.readText).mockImplementation(async () => { controller.abort(); return 'text'; });
    expect(await cancelled.importer.importFiles(target, 'csv', ['page.csv'], controller.signal)).toEqual({ imported: [], failures: [], cancelled: true }); expect(cancelled.api.importItem).not.toHaveBeenCalled();
    const committed = setup(), afterWrite = new AbortController(); vi.mocked(committed.api.importItem).mockImplementation(async () => { afterWrite.abort(); return [create(ViewPBSchema, { id: 'kept' })]; });
    const result = await committed.importer.importFiles(await committed.importer.capture('parent'), 'csv', ['page.csv', 'later.csv'], afterWrite.signal);
    expect(result.cancelled).toBe(true); expect(result.imported.map(view => view.id)).toEqual(['kept']); expect(committed.api.importItem).toHaveBeenCalledTimes(1);
  });
  it('does not treat an empty native reply as confirmed success', async () => {
    const { api, importer } = setup(); vi.mocked(api.importItem).mockResolvedValue([]);
    const result = await importer.importFiles(await importer.capture('parent'), 'csv', ['page.csv']);
    expect(result.imported).toEqual([]); expect(result.failures[0].uncertain).toBe(true); expect(api.importItem).toHaveBeenCalledTimes(1);
  });
});
