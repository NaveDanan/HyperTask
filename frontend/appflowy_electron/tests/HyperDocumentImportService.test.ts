import { create } from '@bufbuild/protobuf';
import { describe, expect, it, vi } from 'vitest';
import { DocumentDataPBSchema } from '@shared/protobuf/flowy-document/entities_pb';
import { ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import { HyperDocumentHtmlImporter, type HyperHtmlImportBackend } from '../src/renderer/features/document-import/HyperDocumentHtmlImporter';
import type { HyperHtmlImportResult } from '../src/renderer/features/document-import/HyperDocumentHtmlParser';

const page = (): HyperHtmlImportResult => ({ title: 'Imported page', document: create(DocumentDataPBSchema, { pageId: 'root', blocks: { root: { id: 'root', ty: 'page', data: '{}' } }, meta: {} }), issues: [], issueCount: 0, blockCount: 1, textLength: 0 });
function setup() {
  const identity = { workspaceId: 'workspace', userId: 'user' }; let current = identity;
  const parent = create(ViewPBSchema, { id: 'parent', name: 'Parent' });
  const api: HyperHtmlImportBackend = { identity: vi.fn(async () => current), view: vi.fn(async () => parent), importPage: vi.fn(async () => create(ViewPBSchema, { id: 'imported', name: 'Imported page', parentViewId: 'parent' })) };
  return { identity, parent, api, importer: new HyperDocumentHtmlImporter(api), changeIdentity: () => { current = { ...current, userId: 'another-user' }; } };
}
describe('Hyper HTML import service', () => {
  it('imports a prepared page after validating actor and destination', async () => {
    const { identity, api, importer } = setup(), prepared = page();
    expect((await importer.importPage('parent', prepared, identity)).id).toBe('imported');
    expect(api.importPage).toHaveBeenCalledWith('parent', prepared); expect(api.view).toHaveBeenCalledWith('parent');
  });
  it('does not write to locked, read-only or mismatched destinations', async () => {
    const locked = setup(); locked.parent.oneOfIsLocked = { case: 'isLocked', value: true };
    await expect(locked.importer.importPage('parent', page(), locked.identity)).rejects.toThrow('locked'); expect(locked.api.importPage).not.toHaveBeenCalled();
    const readonly = setup(); await expect(readonly.importer.importPage('parent', page(), readonly.identity, () => false)).rejects.toThrow('read-only'); expect(readonly.api.importPage).not.toHaveBeenCalled();
    const moved = setup(); moved.parent.id = 'another-parent'; await expect(moved.importer.importPage('parent', page(), moved.identity)).rejects.toThrow('unavailable'); expect(moved.api.importPage).not.toHaveBeenCalled();
  });
  it('rejects an actor change while the destination is being read', async () => {
    const { identity, api, importer, parent, changeIdentity } = setup();
    vi.mocked(api.view).mockImplementation(async () => { changeIdentity(); return parent; });
    await expect(importer.importPage('parent', page(), identity)).rejects.toThrow('signed-in user changed'); expect(api.importPage).not.toHaveBeenCalled();
  });
  it('does not retry a failed native import or pretend the core rolled back its changes', async () => {
    const { identity, api, importer } = setup(); vi.mocked(api.importPage).mockRejectedValue(new Error('Native import failed'));
    await expect(importer.importPage('parent', page(), identity)).rejects.toThrow('Native import failed'); expect(api.importPage).toHaveBeenCalledTimes(1);
  });
});
