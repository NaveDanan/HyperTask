import { describe, expect, it, vi } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import type { HyperTemplateImporter } from './import-service';
import { createHyperTemplateStore } from './store';
import { HyperTemplateRepository } from './repository';
import { entryNamed, failure, fileRepository, fileSource, manifest } from './test-support';

function setup() {
  const importer = { importTemplate: vi.fn<HyperTemplateImporter['importTemplate']>(async () => ({ ok: true, value: create(ViewPBSchema, { id: 'created' }) })) };
  const resolveParentViewId = vi.fn(async () => 'workspace-1'), onImported = vi.fn();
  const store = createHyperTemplateStore({ repository: fileRepository(), importer, resolveParentViewId, onImported, userId: 'user-1' });
  return { importer, resolveParentViewId, onImported, store };
}
describe('template store', () => {
  it('loads every catalog entry and filters category and query', async () => {
    const { store } = setup(); expect(store.getState().status).toBe('loading'); await store.getState().load();
    expect(store.getState().status).toBe('ready'); expect(store.getState().manifest!.templates).toHaveLength(52);
    store.getState().selectCategory('31042f6f-9e91-4c3b-a50c-8a735127598f'); store.getState().search('tracker');
    const state = store.getState(), visible = state.manifest!.filter(state.selectedCategoryId, state.query);
    expect(visible.length).toBeGreaterThan(0); expect(visible.every(t => t.categoryNames.includes('Project Management'))).toBe(true);
    store.getState().selectCategory(null); store.getState().search(''); expect(store.getState().manifest!.filter()).toHaveLength(52);
  });
  it('marks imports in flight, honors workspace switches and opens the created view after success', async () => {
    const { store, importer, resolveParentViewId, onImported } = setup(); const entry = entryNamed('Weekly-To-Do-List');
    const importing = store.getState().importTemplate(entry); expect(store.getState().importingViewIds.has(entry.viewId)).toBe(true);
    await importing; expect(store.getState()).toMatchObject({ lastImportedName: 'Weekly To-Do List', message: null }); expect(store.getState().importingViewIds.size).toBe(0);
    expect(importer.importTemplate).toHaveBeenLastCalledWith(entry, 'workspace-1'); expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ id: 'created' }), entry.name);
    resolveParentViewId.mockResolvedValue('workspace-2'); await store.getState().importTemplate(entry);
    expect(importer.importTemplate).toHaveBeenLastCalledWith(entry, 'workspace-2');
    store.getState().clearMessage(); expect(store.getState()).toMatchObject({ message: null, lastImportedName: null });
  });
  it('ignores unavailable entries and repeated clicks during an import', async () => {
    const { store, importer } = setup(); await store.getState().importTemplate(manifest.templates.find(t => !t.isAvailable)!);
    expect(importer.importTemplate).not.toHaveBeenCalled();
    const entry = entryNamed('Weekly-To-Do-List'), pending = store.getState().importTemplate(entry);
    await store.getState().importTemplate(entry); await pending; expect(importer.importTemplate).toHaveBeenCalledTimes(1);
  });
  it('keeps concurrent imports independently marked until each completes', async () => {
    const { store, importer } = setup(); let complete: (() => void) | undefined;
    importer.importTemplate.mockImplementationOnce(() => new Promise(resolve => { complete = () => resolve({ ok: true, value: null }); }));
    const first = store.getState().importTemplate(entryNamed('Weekly-To-Do-List')); await Promise.resolve();
    await store.getState().importTemplate(entryNamed('Bug-Tracker-13a84186'));
    expect(store.getState().importingViewIds.size).toBe(1); complete!(); await first; expect(store.getState().importingViewIds.size).toBe(0);
  });
  it('reports backend failure and clears the importing flag', async () => {
    const { store, importer, onImported } = setup(); importer.importTemplate.mockResolvedValue(failure('backend down'));
    await store.getState().importTemplate(entryNamed('Weekly-To-Do-List'));
    expect(store.getState()).toMatchObject({ lastImportedName: null, message: 'Could not import "Weekly To-Do List".' });
    expect(store.getState().importingViewIds.size).toBe(0); expect(onImported).not.toHaveBeenCalled();
  });
  it('reports workspace-resolution failure without sending backend data', async () => {
    const { store, importer, resolveParentViewId } = setup(); resolveParentViewId.mockRejectedValue(new Error('no workspace'));
    await store.getState().importTemplate(entryNamed('Weekly-To-Do-List'));
    expect(store.getState().message).toBe('Could not import "Weekly To-Do List".'); expect(store.getState().importingViewIds.size).toBe(0); expect(importer.importTemplate).not.toHaveBeenCalled();
  });
  it('reports a bundled manifest load failure', async () => {
    const source = fileSource(); source.readManifest.mockRejectedValue(new Error('unreadable'));
    const store = createHyperTemplateStore({ repository: new HyperTemplateRepository(source), importer: setup().importer });
    await store.getState().load(); expect(store.getState()).toMatchObject({ status: 'failure', message: 'Could not read the bundled template store.' });
  });
});