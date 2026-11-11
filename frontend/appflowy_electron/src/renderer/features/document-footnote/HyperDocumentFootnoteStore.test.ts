import { create } from '@bufbuild/protobuf';
import { createStore } from 'zustand';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentDataPBSchema, type DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { ViewLayoutPB, ViewPBSchema, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { RowMetaPBSchema } from '@shared/protobuf/flowy-database2/row_entities_pb';
import * as databaseEvents from '@/backend/events/flowy-database2';
import { UserProfilePBSchema, UserWorkspacePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { hyperBlockText, hyperEditText, type HyperDocumentChange } from '../document/HyperDocumentModel';
import { hyperCaptureMentionSelection } from '../document/HyperDocumentMentions';
import type { HyperDocumentSession } from '../document/HyperDocumentSession';
import { hyperGetDocumentOwner } from '../document/HyperDocumentOwner';
import { useAppStore } from '@/startup/app-store';
import { useWorkspaceStore } from '../sidebar/stores/workspace-store';
import { hyperCaptureDocumentFootnote, hyperCaptureFootnoteInsertion } from './HyperDocumentFootnoteModel';
import { createHyperDocumentFootnoteStore, hyperDocumentFootnoteBackend, type HyperFootnoteBackend } from './HyperDocumentFootnoteStore';
import { hyperDocumentDuplicateBackend } from '../document-duplicate/HyperDocumentDuplicateBackend';
const originalApp = useAppStore.getState(), originalWorkspace = useWorkspaceStore.getState();
beforeEach(() => { useAppStore.setState({ dataDirectory: '/disposable-footnotes' }); useWorkspaceStore.setState({ userProfile: create(UserProfilePBSchema, { id: 1n }), currentWorkspace: create(UserWorkspacePBSchema, { workspaceId: 'workspace' }), actionResult: null }); });
afterEach(() => { vi.restoreAllMocks(); useAppStore.setState(originalApp, true); useWorkspaceStore.setState(originalWorkspace, true); });
function fixture(citation = false) {
  const attributes = { future: { kept: true }, ...(citation ? { footnote: { label: '1', reference: { type: 'url', url: 'https://example.invalid/source', title: 'Stored title' } } } : { hyper_footnote: { version: 1, id: 'note-id', label: '1', text: 'Stored note' } }) };
  const document = create(DocumentDataPBSchema, { pageId: 'page', blocks: { page: { id: 'page', ty: 'page', childrenId: 'children', data: '{}' }, p: { id: 'p', parentId: 'page', ty: 'paragraph', childrenId: 'p-children', data: '{}', oneOfExternalId: { case: 'externalId', value: 'text' }, oneOfExternalType: { case: 'externalType', value: 'text' } } }, meta: { childrenMap: { children: { children: ['p'] }, 'p-children': { children: [] } }, textMap: { text: JSON.stringify([{ insert: ' ', attributes }]) } } });
  const state = createStore(() => ({ document, status: 'ready', historyPending: false, error: null })), session = { id: 'document', store: state, belongsTo: () => true, isCurrentOwner: () => true, flush: vi.fn(async () => {}), refresh: vi.fn(async () => {}), change: vi.fn((build: (doc: DocumentDataPB) => HyperDocumentChange) => { const result = build(state.getState().document); state.setState({ document: result.document }); return result; }) };
  let editable = true;
  const backend: HyperFootnoteBackend = { validate: vi.fn(async () => {}), pages: vi.fn(async () => []), page: vi.fn(async id => create(ViewPBSchema, { id, name: 'Source', layout: ViewLayoutPB.Document })), openPage: vi.fn(async () => {}), openUrl: vi.fn(async () => {}) };
  const store = createHyperDocumentFootnoteStore({ session: session as unknown as HyperDocumentSession, owner: hyperGetDocumentOwner()!, editable: () => editable }, backend);
  return { store, state, session, backend, document, readOnly: () => { editable = false; }, open: () => store.open(hyperCaptureDocumentFootnote(state.getState().document, 'p', 0)) };
}
describe('guarded footnote inspection and saves', () => {
  it('makes no backend calls, preview requests, refreshes or writes when inspecting a citation read-only', async () => {
    const f = fixture(true), before = JSON.stringify(f.document); f.readOnly(); f.open();
    expect(f.store.getState()).toMatchObject({ status: 'inspecting', draft: { url: 'https://example.invalid/source', title: 'Stored title' } });
    expect(await f.store.save()).toBeUndefined(); expect(await f.store.remove()).toBeUndefined();
    for (const method of Object.values(f.backend)) expect(method).not.toHaveBeenCalled(); expect(f.session.flush).not.toHaveBeenCalled(); expect(f.session.refresh).not.toHaveBeenCalled(); expect(f.session.change).not.toHaveBeenCalled(); expect(JSON.stringify(f.document)).toBe(before);
  });
  it('keeps a no-op save byte-exact without native calls', async () => {
    const f = fixture(), before = f.document.meta!.textMap.text; f.open(); expect(await f.store.save()).toEqual({ id: 'p', offset: 1 }); expect(f.backend.validate).not.toHaveBeenCalled(); expect(f.session.change).not.toHaveBeenCalled(); expect(f.state.getState().document.meta!.textMap.text).toBe(before);
  });
  it('saves one guarded definition and retains unrelated attributes', async () => {
    const f = fixture(); f.open(); f.store.setDraft({ text: 'Updated note' }); expect(await f.store.save()).toEqual({ id: 'p', offset: 1 }); expect(f.backend.validate).toHaveBeenCalledTimes(2); expect(f.session.flush).toHaveBeenCalledTimes(2); expect(f.session.change).toHaveBeenCalledTimes(1);
    expect(hyperBlockText(f.state.getState().document, f.document.blocks.p)[0]).toMatchObject({ insert: ' ', attributes: { future: { kept: true }, hyper_footnote: { version: 1, id: 'note-id', label: '1', text: 'Updated note' } } });
  });
  it.each(['owner', 'readOnly', 'text', 'history'] as const)('rejects observed %s changes before mutation', async mode => {
    const f = fixture(); f.open(); f.store.setDraft({ text: 'Do not replay' });
    if (mode === 'owner') { useAppStore.setState({ dataDirectory: '/different-realm' }); useAppStore.setState({ dataDirectory: '/disposable-footnotes' }); }
    if (mode === 'readOnly') f.readOnly(); if (mode === 'text') f.state.setState({ document: hyperEditText(f.document, 'p', [{ insert: 'Changed remotely' }]).document }); if (mode === 'history') f.state.setState({ historyPending: true });
    expect(await f.store.save()).toBeUndefined(); expect(f.session.change).not.toHaveBeenCalled();
  });
  it('rechecks source after refresh and permission loss during an await', async () => {
    const f = fixture(); f.open(); f.store.setDraft({ text: 'New' }); f.session.refresh.mockImplementationOnce(async () => { f.state.setState({ document: hyperEditText(f.document, 'p', [{ insert: 'Remote' }]).document }); });
    expect(await f.store.save()).toBeUndefined(); expect(f.store.getState().error).toBe('changed'); expect(f.session.change).not.toHaveBeenCalled();
    const second = fixture(); second.open(); second.store.setDraft({ text: 'New' }); second.backend.validate = vi.fn(async () => { second.readOnly(); }); expect(await second.store.save()).toBeUndefined(); expect(second.session.change).not.toHaveBeenCalled();
  });
  it('keeps uncertain saves and deletes copyable and does not automatically replay them', async () => {
    for (const remove of [false, true]) {
      const f = fixture(); f.open(); f.store.setDraft({ text: 'Requested' }); f.session.flush.mockResolvedValueOnce().mockRejectedValueOnce(Error('Connection lost after dispatch'));
      expect(await (remove ? f.store.remove() : f.store.save())).toBeUndefined(); expect(f.store.getState().status).toBe('partial');
      const source = JSON.parse(f.store.getState().source); expect(source.attributes.hyper_footnote.id).toBe('note-id'); expect(source.attributes.hyper_footnote.text).toBe(remove ? 'Stored note' : 'Requested'); expect(await f.store.save()).toBeUndefined(); expect(f.session.change).toHaveBeenCalledTimes(1);
    }
  });
  it('freezes newly inserted IDs in the recovery source after an unconfirmed write', async () => {
    const f = fixture(), selection = hyperCaptureMentionSelection(f.document, { id: 'p', selection: { start: 1, end: 1 } })!; f.store.open(hyperCaptureFootnoteInsertion(f.document, selection)); f.store.setDraft({ text: 'New definition' }); f.session.flush.mockResolvedValueOnce().mockRejectedValueOnce(Error('No acknowledgement'));
    await f.store.save(); const source = JSON.parse(f.store.getState().source), runs = hyperBlockText(f.state.getState().document, f.document.blocks.p), inserted = runs.at(-1)!.attributes!.hyper_footnote as { id: string };
    expect(inserted.id).toBe(source.attributes.hyper_footnote.id); expect(f.store.getState().status).toBe('partial');
  });
  it('only opens a URL on explicit action and blocks an owner switch while resolving a page', async () => {
    const f = fixture(true); f.readOnly(); f.open(); await f.store.openReference(); expect(f.backend.openUrl).toHaveBeenCalledWith('https://example.invalid/source'); expect(f.session.change).not.toHaveBeenCalled();
    const second = fixture(true), current = second.state.getState().document; current.meta!.textMap.text = JSON.stringify([{ insert: ' ', attributes: { footnote: { label: '1', reference: { type: 'doc', docId: 'source' } } } }]); second.open(); second.backend.page = vi.fn(async () => { useAppStore.setState({ dataDirectory: '/other' }); return create(ViewPBSchema, { id: 'source' }); });
    await second.store.openReference(); expect(second.backend.openPage).not.toHaveBeenCalled(); expect(second.store.getState().error).toBe('ownerChanged');
  });
  it('does not apply stale page-list results after the inspector closes', async () => {
    const f = fixture(); f.open(); let release!: (value: ViewPB[]) => void; f.backend.pages = vi.fn(() => new Promise<ViewPB[]>(resolve => { release = resolve; })); const pending = f.store.loadPages(); f.store.close(); release([]); await pending; expect(f.store.getState()).toMatchObject({ status: 'idle', pages: [] });
  });
  it('checks actual page layout and current row-document mapping through the shared native write guard', async () => {
    const f = fixture(), owner = hyperGetDocumentOwner()!, context = { session: f.session as unknown as HyperDocumentSession, owner, editable: () => true, rowScope: { viewId: 'database', rowId: 'row' } }, check = async <T,>(operation: () => Promise<T>) => operation();
    vi.spyOn(hyperDocumentDuplicateBackend, 'identity').mockResolvedValue({ workspaceId: owner.workspaceId, actorId: owner.actorId }); const writable = vi.spyOn(hyperDocumentDuplicateBackend, 'writable').mockResolvedValue();
    const view = vi.spyOn(hyperDocumentDuplicateBackend, 'view').mockResolvedValue(create(ViewPBSchema, { id: 'database', layout: ViewLayoutPB.Grid }));
    const row = vi.spyOn(databaseEvents, 'DatabaseEventGetRowMeta').mockResolvedValue({ ok: true, value: create(RowMetaPBSchema, { id: 'row', oneOfDocumentId: { case: 'documentId', value: 'document' } }) });
    await expect(hyperDocumentFootnoteBackend.validate(context, check)).resolves.toBeUndefined(); expect(writable).toHaveBeenCalledWith('database', owner, check);
    row.mockResolvedValue({ ok: true, value: create(RowMetaPBSchema, { id: 'row', oneOfDocumentId: { case: 'documentId', value: 'replacement' } }) }); await expect(hyperDocumentFootnoteBackend.validate(context, check)).rejects.toThrow('changed');
    view.mockResolvedValue(create(ViewPBSchema, { id: 'database', layout: ViewLayoutPB.Document })); await expect(hyperDocumentFootnoteBackend.validate(context, check)).rejects.toThrow('changed'); expect(f.session.change).not.toHaveBeenCalled();
  });
});
