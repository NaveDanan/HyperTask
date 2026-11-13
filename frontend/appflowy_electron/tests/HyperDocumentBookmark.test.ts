import { create, clone } from '@bufbuild/protobuf';
import { createStore } from 'zustand';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentDataPBSchema, type DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { UserProfilePBSchema, UserWorkspacePBSchema } from '@shared/protobuf/flowy-user/user_profile_pb';
import { hyperBlockData, hyperBlockText, hyperChildren, hyperEditText, hyperInsertBlock, hyperUpdateBlock } from '../src/renderer/features/document/HyperDocumentModel';
import { hyperCaptureDocumentSlash } from '../src/renderer/features/document-slash/HyperDocumentSlashModel';
import { hyperCaptureBookmarkInsertion, hyperCaptureDocumentBookmark, hyperReadDocumentBookmark, hyperSaveDocumentBookmark } from '../src/renderer/features/document-bookmark/HyperDocumentBookmarkModel';
import { hyperBookmarkHtmlMarker, hyperBookmarkUrl, hyperBookmarkYoutubeId, hyperParseBookmarkHtmlMarker, type HyperBookmarkFields } from '../src/renderer/features/document-bookmark/HyperDocumentBookmarkValue';
import { createHyperDocumentBookmarkStore } from '../src/renderer/features/document-bookmark/HyperDocumentBookmarkStore';
import { hyperExportDocument } from '../src/renderer/features/document/HyperDocumentExport';
import { hyperGetDocumentOwner } from '../src/renderer/features/document/HyperDocumentOwner';
import type { HyperDocumentSession } from '../src/renderer/features/document/HyperDocumentSession';
import { useWorkspaceStore } from '../src/renderer/features/sidebar/stores/workspace-store';
import { useAppStore } from '../src/renderer/startup/app-store';
const fields: HyperBookmarkFields = { url: 'https://example.com/reference?a=1&b=2', title: 'A title <script>', description: 'A long description\nSecond line', site: 'Example', caption: 'A caption', mode: 'card' };
function document() { return create(DocumentDataPBSchema, { pageId: 'page', blocks: { page: { id: 'page', ty: 'page', childrenId: 'children', data: '{}' }, p: { id: 'p', parentId: 'page', ty: 'paragraph', childrenId: 'pchildren', data: '{"delta":[{"insert":"Original text"}]}' }, card: { id: 'card', parentId: 'page', ty: 'link_preview', childrenId: 'cardchildren', data: JSON.stringify({ url: fields.url, preview_type: 'embed', unknown: { keep: true } }) } }, meta: { childrenMap: { children: { children: ['p', 'card'] }, pchildren: {}, cardchildren: {} } } }); }
describe('Hyper compatible link cards', () => {
  it('reads legacy cards without mutating data or treating upstream embed previews as players', () => {
    const doc = document(), before = doc.blocks.card.data;
    expect(hyperReadDocumentBookmark(doc, 'card').fields).toMatchObject({ url: fields.url, mode: 'card', title: '' }); expect(doc.blocks.card.data).toBe(before);
    doc.blocks.card.data = JSON.stringify({ url: fields.url, preview_type: null }); expect(hyperReadDocumentBookmark(doc, 'card').fields.mode).toBe('card'); expect(hyperBlockData(hyperSaveDocumentBookmark(doc, hyperCaptureDocumentBookmark(doc, 'card'), fields).document.blocks.card).preview_type).toBeNull();
    for (const ty of ['link_preview', 'link_embed', 'video']) { doc.blocks.card.ty = ty; expect(hyperReadDocumentBookmark(doc, 'card').fields.mode).toBe('card'); }
  });
  it('preserves alias types, unknown nested data and unrelated edits; refuses stale source or structure', () => {
    const doc = document(); doc.blocks.card.ty = 'video'; const target = hyperCaptureDocumentBookmark(doc, 'card');
    const updated = hyperEditText(doc, 'p', [{ insert: 'Unrelated edit retained' }]).document;
    updated.blocks.card.data = JSON.stringify({ url: fields.url, preview_type: 'embed', unknown: { changed: 'retained' }, hyper_bookmark: { version: 1, future: { retain: 4 } } });
    const saved = hyperSaveDocumentBookmark(updated, target, fields), data = hyperBlockData(saved.document.blocks.card);
    expect(saved.document.blocks.card.ty).toBe('video'); expect(data).toMatchObject({ preview_type: 'embed', unknown: { changed: 'retained' }, hyper_bookmark: { future: { retain: 4 }, title: fields.title, mode: fields.mode } });
    expect(hyperBlockText(saved.document, saved.document.blocks.p)[0].insert).toBe('Unrelated edit retained');
    expect(() => hyperSaveDocumentBookmark(hyperUpdateBlock(doc, 'card', { url: 'https://changed.example' }).document, target, fields)).toThrow('changed');
    const moved = clone(DocumentDataPBSchema, doc); moved.blocks.card.parentId = 'p'; expect(() => hyperSaveDocumentBookmark(moved, target, fields)).toThrow();
  });
  it('inserts leaf cards and removes only a captured slash query while retaining child content', () => {
    const doc = document(), inserted = hyperSaveDocumentBookmark(doc, hyperCaptureBookmarkInsertion(doc, 'p'), fields), id = inserted.focus!.id;
    expect(inserted.document.blocks[id].ty).toBe('link_preview'); expect(hyperChildren(inserted.document, inserted.document.blocks[id])).toEqual([]);
    expect(hyperReadDocumentBookmark(inserted.document, id).fields).toEqual(fields);
    const query = hyperEditText(doc, 'p', [{ insert: '/bookmark' }]).document, target = hyperCaptureBookmarkInsertion(query, 'p', hyperCaptureDocumentSlash(query, 'p')!);
    expect(hyperSaveDocumentBookmark(query, target, fields).document.blocks.p).toBeUndefined();
    expect(() => hyperSaveDocumentBookmark(hyperEditText(query, 'p', [{ insert: '/bookmark changed' }]).document, target, fields)).toThrow('slash');
    const child = hyperInsertBlock(query, 'p', '', 'paragraph'), withChild = hyperCaptureBookmarkInsertion(child.document, 'p', hyperCaptureDocumentSlash(child.document, 'p')!);
    const result = hyperSaveDocumentBookmark(child.document, withChild, fields); expect(hyperChildren(result.document, result.document.blocks.p)).toEqual([child.focus!.id]); expect(hyperBlockText(result.document, result.document.blocks.p)).toEqual([]);
  });
  it.each([{ hyper_bookmark: { version: 2 } }, { hyper_bookmark: { version: 1, title: 4 } }, { preview_type: 'future' }])('keeps unsupported data read-only: %j', data => {
    const doc = document(); doc.blocks.card.data = JSON.stringify({ url: fields.url, ...data }); const original = doc.blocks.card.data; expect(() => hyperCaptureDocumentBookmark(doc, 'card')).toThrow('unsupported'); expect(doc.blocks.card.data).toBe(original);
  });
  it.each(['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,test', 'https://u:p@example.com', 'https://example.com\nsecret'])('refuses unsafe addresses: %s', value => expect(() => hyperBookmarkUrl(value)).toThrow());
  it.each(['https://youtu.be/AbCdEf_12-3', 'https://www.youtube.com/watch?v=AbCdEf_12-3&list=anything', 'https://m.youtube.com/shorts/AbCdEf_12-3', 'https://youtube.com/live/AbCdEf_12-3', 'https://www.youtube-nocookie.com/embed/AbCdEf_12-3'])('accepts an exact video ID from %s', value => expect(hyperBookmarkYoutubeId(value)).toBe('AbCdEf_12-3'));
  it.each(['https://youtube.com.evil.example/watch?v=AbCdEf_12-3', 'https://www.youtube.com/watch?v=AbCdEf_12-3&v=other', 'https://youtu.be/AbCdEf_12-3/extra', 'https://youtube.com/watch?v=short', 'https://user@youtube.com/watch?v=AbCdEf_12-3', 'https://youtube.com:444/embed/AbCdEf_12-3'])('rejects ambiguous/provider-like addresses: %s', value => expect(hyperBookmarkYoutubeId(value)).toBeNull());
  it('exports readable offline cards and inert versioned metadata, never frames, scripts or remote images', () => {
    const doc = document(), saved = hyperSaveDocumentBookmark(doc, hyperCaptureDocumentBookmark(doc, 'card'), { ...fields, url: 'https://youtu.be/AbCdEf_12-3', mode: 'youtube' }).document;
    const html = hyperExportDocument(saved, 'html'); expect(html).toContain('data-hyper-bookmark='); expect(html).toContain('&lt;script&gt;'); expect(html).not.toMatch(/<(?:iframe|script|img)\b/u); expect(hyperExportDocument(saved, 'markdown')).toContain('[A title');
    expect(hyperParseBookmarkHtmlMarker(hyperBookmarkHtmlMarker(saved.blocks.card))).toEqual({ type: 'link_preview', data: hyperBlockData(saved.blocks.card) });
    expect(hyperParseBookmarkHtmlMarker('{"version":2}')).toBeNull(); expect(hyperParseBookmarkHtmlMarker(JSON.stringify({ version: 1, type: 'link_preview', data: { url: 'javascript:x' } }))).toBeNull();
    const invalid = hyperUpdateBlock(saved, 'card', { hyper_bookmark: { version: 8 } }).document; expect(() => hyperExportDocument(invalid, 'html')).toThrow('unsupported');
  });
});
const previousApp = useAppStore.getState(), previousWorkspace = useWorkspaceStore.getState();
beforeEach(() => { useAppStore.setState({ dataDirectory: '/bookmark-tests' }); useWorkspaceStore.setState({ userProfile: create(UserProfilePBSchema, { id: 1n }), currentWorkspace: create(UserWorkspacePBSchema, { workspaceId: 'workspace' }), actionResult: null }); });
afterEach(() => { useAppStore.setState(previousApp, true); useWorkspaceStore.setState(previousWorkspace, true); });
function fixture() {
  const state = createStore(() => ({ document: document(), status: 'ready', historyPending: false, error: null }));
  const session = { id: 'document', store: state, belongsTo: () => true, isCurrentOwner: () => true, flush: vi.fn(async () => {}), refresh: vi.fn(async () => {}), change: vi.fn((build: (doc: DocumentDataPB) => { document: DocumentDataPB; focus?: { id: string; offset: number } }) => { const result = build(state.getState().document); state.setState({ document: result.document }); return result; }) };
  let editable = true; const backend = { validate: vi.fn(async () => {}), metadata: vi.fn(async (url: string) => ({ url, html: '<title>Metadata</title>' })), parse: vi.fn(() => ({ title: 'Metadata', description: 'Description', site: 'Example' })) };
  const store = createHyperDocumentBookmarkStore({ session: session as unknown as HyperDocumentSession, owner: hyperGetDocumentOwner()!, editable: () => editable }, backend);
  return { state, session, backend, store, readOnly: () => { editable = false; } };
}
describe('Hyper guarded card editing', () => {
  it('does not request metadata on inspection and validates before save', async () => {
    const f = fixture(); await f.store.open(hyperCaptureDocumentBookmark(f.state.getState().document, 'card')); expect(f.backend.metadata).not.toHaveBeenCalled(); f.store.setField('title', 'Manual'); expect(await f.store.save()).toMatchObject({ id: 'card' }); expect(f.backend.validate).toHaveBeenCalledTimes(3); expect(hyperBlockData(f.state.getState().document.blocks.card).unknown).toEqual({ keep: true });
  });
  it('only loads explicit URL metadata and refuses late fields, cancellation and owner ABA replies', async () => {
    for (const mode of ['fields', 'cancel', 'owner', 'source'] as const) {
      const f = fixture(); await f.store.open(hyperCaptureDocumentBookmark(f.state.getState().document, 'card')); let release!: (reply: { url: string; html: string }) => void;
      f.backend.metadata.mockImplementation(() => new Promise(resolve => { release = resolve; })); const request = f.store.loadMetadata(); await vi.waitFor(() => expect(release).toBeTypeOf('function'));
      if (mode === 'fields') f.store.setField('title', 'Manual edit'); if (mode === 'source') f.state.setState({ document: hyperUpdateBlock(f.state.getState().document, 'card', { url: 'https://changed.example' }).document }); if (mode === 'cancel') f.store.close(); if (mode === 'owner') { useAppStore.setState({ dataDirectory: '/other' }); useAppStore.setState({ dataDirectory: '/bookmark-tests' }); }
      release({ url: fields.url, html: '<title>Metadata</title>' }); await request; expect(f.backend.parse).not.toHaveBeenCalled(); expect(f.session.change).not.toHaveBeenCalled(); if (mode === 'fields') expect(f.store.getState().fields.title).toBe('Manual edit');
    }
  });
  it('blocks history, stale source, owner and permission loss before any native write', async () => {
    for (const mode of ['history', 'stale', 'owner', 'permission']) {
      const f = fixture(); await f.store.open(hyperCaptureDocumentBookmark(f.state.getState().document, 'card')); f.store.setField('title', 'Changed');
      if (mode === 'history') f.state.setState({ historyPending: true }); if (mode === 'stale') f.state.setState({ document: hyperUpdateBlock(f.state.getState().document, 'card', { url: 'https://changed.example' }).document }); if (mode === 'owner') { useAppStore.setState({ launchId: 7 }); useAppStore.setState({ launchId: previousApp.launchId }); } if (mode === 'permission') f.readOnly();
      expect(await f.store.save()).toBeUndefined(); expect(f.session.change).not.toHaveBeenCalled();
    }
  });
  it('retains uncertain accepted writes for explicit copy without enabling replay', async () => {
    const f = fixture(); await f.store.open(hyperCaptureDocumentBookmark(f.state.getState().document, 'card')); f.store.setField('title', 'Draft kept'); f.session.flush.mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error('Native write acknowledgement lost'));
    expect(await f.store.save()).toBeUndefined(); expect(f.store.getState().status).toBe('partial'); expect(f.store.details()).toContain('Draft kept'); const count = f.session.change.mock.calls.length; await f.store.save(); expect(f.session.change).toHaveBeenCalledTimes(count); f.store.close(); expect(f.store.getState().status).toBe('idle');
  });
});
