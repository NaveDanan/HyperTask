import { createStore } from 'zustand';
import { ViewLayoutPB } from '@shared/protobuf/flowy-folder/view_pb';
import { DatabaseEventGetRowMeta } from '@/backend/events/flowy-database2';
import { unwrap } from '@/backend/dispatch';
import type { HyperBookmarkMetadataReply, HyperGeneratedImageAsset } from '@shared/api';
import type { HyperDocumentSession } from '../document/HyperDocumentSession';
import { hyperDocumentOwnerKey, hyperGetDocumentOwner, type HyperDocumentOwner } from '../document/HyperDocumentOwner';
import { hyperCaptureDuplicateOwner, hyperDocumentDuplicateBackend } from '../document-duplicate/HyperDocumentDuplicateBackend';
import { rowDocumentIdForRow } from '../templates/converter';
import { hyperRequireBookmarkTarget, hyperSaveDocumentBookmark, type HyperBookmarkInsertion, type HyperBookmarkTarget } from './HyperDocumentBookmarkModel';
import { hyperBookmarkUrl, hyperParseBookmarkMetadata, hyperParseBookmarkThumbnailCandidate, type HyperBookmarkFields } from './HyperDocumentBookmarkValue';
import { hyperPrepareBookmarkThumbnail, HyperBookmarkThumbnailPreparedError } from './HyperBookmarkThumbnailService';
import type { HyperBookmarkThumbnail } from './HyperBookmarkThumbnailValue';
export interface HyperBookmarkContext { session: HyperDocumentSession; owner: HyperDocumentOwner; editable(): boolean; rowScope?: { viewId: string; rowId: string } }
export interface HyperBookmarkBackend {
  validate(context: HyperBookmarkContext, check: <T>(operation: () => Promise<T>) => Promise<T>): Promise<void>;
  metadata(url: string, owner: HyperDocumentOwner): Promise<HyperBookmarkMetadataReply>;
  parse(html: string, url: string): Pick<HyperBookmarkFields, 'title' | 'description' | 'site'>;
  candidate?(html: string, url: string): string;
  thumbnail?(url: string, owner: HyperDocumentOwner): Promise<HyperGeneratedImageAsset>;
  prepareThumbnail?(asset: HyperGeneratedImageAsset, context: HyperBookmarkContext): Promise<HyperBookmarkThumbnail>;
}
export const hyperDocumentBookmarkBackend: HyperBookmarkBackend = {
  async validate(context, check) {
    const { owner, session, rowScope } = context, identity = await hyperDocumentDuplicateBackend.identity(check);
    if (identity.workspaceId !== owner.workspaceId || identity.actorId !== owner.actorId) throw Error('The active workspace or account changed.');
    await hyperDocumentDuplicateBackend.writable(rowScope?.viewId ?? session.id, owner, check);
    const view = await check(() => hyperDocumentDuplicateBackend.view(rowScope?.viewId ?? session.id));
    if (view.id !== (rowScope?.viewId ?? session.id) || (rowScope ? ![ViewLayoutPB.Grid, ViewLayoutPB.Board, ViewLayoutPB.Calendar].includes(view.layout) : view.layout !== ViewLayoutPB.Document)) throw Error('The link card page layout changed. Reopen its editor.');
    if (rowScope) {
      const row = unwrap(await check(() => DatabaseEventGetRowMeta(rowScope))), documentId = row.oneOfDocumentId.case === 'documentId' && row.oneOfDocumentId.value ? row.oneOfDocumentId.value : rowDocumentIdForRow(row.id);
      if (row.id !== rowScope.rowId || documentId !== session.id || row.oneOfIsDocumentEmpty.case === 'isDocumentEmpty' && row.oneOfIsDocumentEmpty.value) throw Error('The row document changed or was removed.');
    }
  },
  metadata: (url, owner) => window.appflowy.bookmarks.load(url, { actorId: owner.actorId, workspaceId: owner.workspaceId }),
  parse: hyperParseBookmarkMetadata,
  candidate: hyperParseBookmarkThumbnailCandidate,
  thumbnail: (url, owner) => window.appflowy.bookmarks.loadThumbnail(url, { actorId: owner.actorId, workspaceId: owner.workspaceId }),
  prepareThumbnail: hyperPrepareBookmarkThumbnail,
};
const empty = (): HyperBookmarkFields => ({ url: '', title: '', description: '', site: '', caption: '', mode: 'card' });
const errorText = (error: unknown) => error instanceof Error ? error.message : (error as { msg?: string })?.msg ?? String(error);
export function createHyperDocumentBookmarkStore(context: HyperBookmarkContext, backend = hyperDocumentBookmarkBackend) {
  const owner = hyperCaptureDuplicateOwner(context.owner) ?? context.owner, key = hyperDocumentOwnerKey(owner);
  const store = createStore(() => ({ status: 'idle' as 'idle' | 'loading' | 'editing' | 'saving' | 'partial' | 'error', fields: empty(), metadataLoading: false, thumbnailLoading: false, thumbnailPreparing: false, thumbnailUrl: '', retainedAssets: [] as HyperGeneratedImageAsset[], retainedThumbnails: [] as unknown[], error: '' }));
  let target: HyperBookmarkTarget | HyperBookmarkInsertion | null = null, revision = 0, draftRevision = 0, metadataRevision = 0, disposed = false, lost = false;
  const validOwner = () => !disposed && !lost && owner.isCurrent() && hyperDocumentOwnerKey(hyperGetDocumentOwner()) === key && context.session.belongsTo(owner) && context.session.isCurrentOwner();
  const current = () => {
    if (!validOwner()) { lost = true; throw Error('The link card, workspace or account changed. Reopen the editor.'); }
    const state = context.session.store.getState();
    if (!context.editable() || !state.document || state.historyPending || ['loading', 'error'].includes(state.status)) throw Error('This page is read-only or unavailable.');
    return state.document;
  };
  const check = async <T,>(operation: () => Promise<T>): Promise<T> => { current(); const value = await operation(); current(); return value; };
  const validate = async () => { current(); await backend.validate({ ...context, owner }, check); current(); };
  return Object.assign(store, {
    activate() { disposed = false; },
    fail(error: unknown) { if (validOwner()) store.setState({ status: 'error', error: errorText(error) }); },
    async open(next: HyperBookmarkTarget | HyperBookmarkInsertion) {
      if (store.getState().status === 'saving' || store.getState().thumbnailPreparing) return;
      const run = ++revision; metadataRevision++; target = next; draftRevision++;
      store.setState({ status: 'loading', fields: 'blockId' in next ? { ...next.fields } : empty(), metadataLoading: false, thumbnailLoading: false, thumbnailPreparing: false, thumbnailUrl: '', retainedAssets: [], retainedThumbnails: [], error: '' });
      try { await validate(); hyperRequireBookmarkTarget(current(), next); if (run === revision && validOwner()) store.setState({ status: 'editing' }); }
      catch (error) { if (run === revision && validOwner()) store.setState({ status: 'error', error: errorText(error) }); }
    },
    setField<K extends keyof HyperBookmarkFields>(name: K, value: HyperBookmarkFields[K]) { if (store.getState().status === 'editing') { draftRevision++; store.setState(state => ({ fields: { ...state.fields, [name]: value }, ...(name === 'url' ? { thumbnailUrl: '' } : {}) })); } },
    setThumbnailUrl(value: string) { if (store.getState().status === 'editing') { draftRevision++; store.setState({ thumbnailUrl: value }); } },
    removeThumbnail() { if (store.getState().status === 'editing' && !store.getState().thumbnailLoading) { draftRevision++; store.setState(state => ({ fields: { ...state.fields, thumbnail: null } })); } },
    async loadMetadata() {
      if (store.getState().status !== 'editing' || store.getState().metadataLoading || store.getState().thumbnailLoading) return;
      const run = revision, draft = draftRevision, load = ++metadataRevision, rawUrl = store.getState().fields.url;
      store.setState({ metadataLoading: true, error: '' });
      try {
        const url = hyperBookmarkUrl(rawUrl); await validate(); if (target) hyperRequireBookmarkTarget(current(), target);
        const reply = await check(() => backend.metadata(url, owner));
        if (run !== revision || load !== metadataRevision || !validOwner()) return;
        if (draft !== draftRevision) throw Error('The link card fields changed. Load metadata again to replace them.');
        if (typeof reply.url !== 'string' || hyperBookmarkUrl(reply.url) !== reply.url || typeof reply.html !== 'string') throw Error('The link metadata response does not match this address.');
        if (target) hyperRequireBookmarkTarget(current(), target);
        const metadata = backend.parse(reply.html, reply.url);
        store.setState(state => ({ fields: { ...state.fields, ...metadata }, thumbnailUrl: backend.candidate?.(reply.html, reply.url) ?? '' })); draftRevision++;
      } catch (error) { if (run === revision && load === metadataRevision && validOwner()) store.setState({ error: errorText(error) }); }
      finally { if (run === revision && load === metadataRevision && validOwner()) store.setState({ metadataLoading: false }); }
    },
    async loadThumbnail() {
      if (store.getState().status !== 'editing' || store.getState().thumbnailLoading || store.getState().metadataLoading || !backend.thumbnail || !backend.prepareThumbnail) return;
      const run = revision, draft = draftRevision, url = store.getState().thumbnailUrl; let asset: HyperGeneratedImageAsset | null = null;
      store.setState({ thumbnailLoading: true, error: '' });
      try {
        await validate(); if (target) hyperRequireBookmarkTarget(current(), target);
        asset = await check(() => backend.thumbnail!(hyperBookmarkUrl(url), owner));
        if (run !== revision || !validOwner()) return;
        store.setState(state => ({ retainedAssets: [...state.retainedAssets, asset!] }));
        if (draft !== draftRevision) throw Error('The link card fields changed. Its downloaded thumbnail was kept.');
        await validate(); if (target) hyperRequireBookmarkTarget(current(), target);
        store.setState({ thumbnailPreparing: true });
        const thumbnail = await check(() => backend.prepareThumbnail!(asset!, { ...context, owner, editable: () => run === revision && context.editable() }));
        if (run !== revision || !validOwner()) return;
        store.setState(state => ({ retainedThumbnails: [...state.retainedThumbnails, thumbnail] }));
        if (draft !== draftRevision) throw Error('The link card fields changed. Its prepared thumbnail was kept.');
        if (target) hyperRequireBookmarkTarget(current(), target);
        store.setState(state => ({ fields: { ...state.fields, thumbnail } })); draftRevision++;
      } catch (error) { if (run === revision && validOwner()) store.setState(state => ({ ...(error instanceof HyperBookmarkThumbnailPreparedError ? { status: 'partial' as const, retainedThumbnails: [...state.retainedThumbnails, { asset: error.asset, prepared: error.prepared }] } : {}), error: errorText(error) })); }
      finally { if (run === revision && validOwner()) store.setState({ thumbnailLoading: false, thumbnailPreparing: false }); }
    },
    async save() {
      if (store.getState().status !== 'editing' || store.getState().metadataLoading || store.getState().thumbnailLoading || !target) return;
      const captured = target, fields = { ...store.getState().fields }, run = revision; let accepted = false;
      store.setState({ status: 'saving', error: '' });
      try {
        await validate(); await check(() => context.session.flush()); await check(() => context.session.refresh());
        if (run !== revision) throw Error('The link card editor was closed.');
        hyperSaveDocumentBookmark(current(), captured, fields); await validate();
        const applied = context.session.change(doc => { current(); return hyperSaveDocumentBookmark(doc, captured, fields); });
        if (!applied) throw Error('The link card could not be saved.'); accepted = true;
        await check(() => context.session.flush()); if (run === revision && validOwner()) { store.setState({ status: 'idle' }); target = null; } return applied.focus;
      } catch (error) { if (run === revision && validOwner()) store.setState({ status: accepted ? 'partial' : 'editing', error: `${accepted ? 'The link card save was not confirmed. Copy its source before closing. ' : ''}${errorText(error)}` }); return; }
    },
    details() { if (!validOwner()) return ''; return JSON.stringify({ version: 1, documentId: context.session.id, rowScope: context.rowScope, target, fields: store.getState().fields, retainedAssets: store.getState().retainedAssets, retainedThumbnails: store.getState().retainedThumbnails }, null, 2); },
    close() { if (store.getState().status !== 'saving' && !store.getState().thumbnailPreparing) { revision++; metadataRevision++; target = null; store.setState({ status: 'idle', metadataLoading: false, thumbnailLoading: false }); } },
    dispose() { disposed = true; revision++; metadataRevision++; },
  });
}
export type HyperDocumentBookmarkStore = ReturnType<typeof createHyperDocumentBookmarkStore>;
