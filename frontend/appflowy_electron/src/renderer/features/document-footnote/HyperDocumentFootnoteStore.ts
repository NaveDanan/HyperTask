import { createStore } from 'zustand';
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { ViewLayoutPB } from '@shared/protobuf/flowy-folder/view_pb';
import { DatabaseEventGetRowMeta } from '@/backend/events/flowy-database2';
import { unwrap } from '@/backend/dispatch';
import { hyperCaptureDuplicateOwner, hyperDocumentDuplicateBackend } from '../document-duplicate/HyperDocumentDuplicateBackend';
import { hyperDocumentOwnerKey, hyperGetDocumentOwner, type HyperDocumentOwner } from '../document/HyperDocumentOwner';
import type { HyperDocumentSession } from '../document/HyperDocumentSession';
import { tabsActions } from '../tabs/tabs-store';
import { rowDocumentIdForRow } from '../templates/converter';
import { HyperDocumentLinkService } from '../document-links/HyperDocumentLinkService';
import { hyperApplyDocumentFootnoteValue, hyperAssertFootnoteAnchor, hyperBuildDocumentFootnote, hyperRemoveDocumentFootnote, type HyperFootnoteAnchor, type HyperFootnoteGroup } from './HyperDocumentFootnoteModel';
import { hyperDocumentFootnoteAttribute, hyperDocumentFootnoteDraft, hyperDocumentFootnoteSignature, hyperDocumentFootnoteUrl, hyperReadDocumentFootnote, type HyperDocumentFootnoteDraft, type HyperDocumentFootnoteRead, type HyperDocumentFootnoteValue } from './HyperDocumentFootnoteValue';

export interface HyperFootnoteContext { session: HyperDocumentSession; owner: HyperDocumentOwner; editable(): boolean; currentOwner?(): HyperDocumentOwner | null; rowScope?: { viewId: string; rowId: string } }
export type HyperFootnoteCheck = <T>(operation: () => Promise<T>) => Promise<T>;
export interface HyperFootnoteBackend {
  validate(context: HyperFootnoteContext, check: HyperFootnoteCheck): Promise<void>;
  pages(context: HyperFootnoteContext, check: HyperFootnoteCheck): Promise<ViewPB[]>;
  page(id: string, check: HyperFootnoteCheck): Promise<ViewPB>;
  openPage(view: ViewPB): void | Promise<void>;
  openUrl(url: string): void | Promise<void>;
}
export const hyperDocumentFootnoteBackend: HyperFootnoteBackend = {
  async validate(context, check) {
    const { session, owner, rowScope } = context, identity = await hyperDocumentDuplicateBackend.identity(check);
    if (identity.workspaceId !== owner.workspaceId || identity.actorId !== owner.actorId) throw Error('ownerChanged');
    try { await hyperDocumentDuplicateBackend.writable(rowScope?.viewId ?? session.id, owner, check); }
    catch (error) { if (/copied page|destination/u.test(message(error))) throw Error('readOnly'); throw error; }
    const view = await check(() => hyperDocumentDuplicateBackend.view(rowScope?.viewId ?? session.id));
    if (view.id !== (rowScope?.viewId ?? session.id) || (rowScope ? ![ViewLayoutPB.Grid, ViewLayoutPB.Board, ViewLayoutPB.Calendar].includes(view.layout) : view.layout !== ViewLayoutPB.Document)) throw Error('changed');
    if (rowScope) { const row = unwrap(await check(() => DatabaseEventGetRowMeta(rowScope))), documentId = row.oneOfDocumentId.case === 'documentId' && row.oneOfDocumentId.value ? row.oneOfDocumentId.value : rowDocumentIdForRow(row.id); if (row.id !== rowScope.rowId || documentId !== session.id || row.oneOfIsDocumentEmpty.case === 'isDocumentEmpty' && row.oneOfIsDocumentEmpty.value) throw Error('changed'); }
  },
  async pages(context, check) {
    const result = await check(() => new HyperDocumentLinkService().pages());
    if (result.identity.workspaceId !== context.owner.workspaceId || result.identity.userId !== context.owner.actorId) throw Error('ownerChanged');
    return result.views;
  },
  page: async (id, check) => { const view = await check(() => hyperDocumentDuplicateBackend.view(id)); if (view.id !== id) throw Error('pageUnavailable'); return view; },
  openPage: view => tabsActions.openView(view),
  openUrl: url => window.appflowy.shell.openExternal(url),
};
export interface HyperFootnoteChoice { label: string; value: HyperDocumentFootnoteValue; signature: string }
export interface HyperFootnoteState {
  status: 'idle' | 'editing' | 'inspecting' | 'saving' | 'partial' | 'error';
  draft: HyperDocumentFootnoteDraft; read: HyperDocumentFootnoteRead | null; label: string; references: number; existing: boolean; changed: boolean;
  choices: HyperFootnoteChoice[]; pages: ViewPB[]; pagesLoading: boolean; error: string; source: string;
}
const message = (error: unknown) => error instanceof Error ? error.message : (error as { msg?: string })?.msg ?? String(error);
const choice = (group: HyperFootnoteGroup): HyperFootnoteChoice[] => { const first = group.entries[0]?.read; return !group.conflict && first?.supported && first.value ? [{ label: group.label, value: structuredClone(first.value), signature: group.signature }] : []; };
export function createHyperDocumentFootnoteStore(context: HyperFootnoteContext, backend = hyperDocumentFootnoteBackend) {
  const owner = hyperCaptureDuplicateOwner(context.owner) ?? { ...context.owner }, key = hyperDocumentOwnerKey(owner);
  const store = createStore<HyperFootnoteState>(() => ({ status: 'idle', draft: hyperDocumentFootnoteDraft(), read: null, label: '', references: 0, existing: false, changed: false, choices: [], pages: [], pagesLoading: false, error: '', source: '' }));
  let target: HyperFootnoteAnchor | null = null, initialDraft = '', revision = 0, pageRevision = 0, disposed = false, lost = false;
  const set = (patch: Partial<HyperFootnoteState>) => { if (!disposed) store.setState(patch); };
  const current = (write = false) => {
    if (disposed || lost || !owner.isCurrent() || hyperDocumentOwnerKey((context.currentOwner ?? hyperGetDocumentOwner)()) !== key || !context.session.belongsTo(owner) || !context.session.isCurrentOwner()) { lost = true; throw Error('ownerChanged'); }
    const state = context.session.store.getState();
    if (!state.document || state.historyPending || ['loading', 'error'].includes(state.status)) throw Error('notReady');
    if (write && !context.editable()) throw Error('readOnly');
    return state.document;
  };
  const check = (write: boolean): HyperFootnoteCheck => async operation => { current(write); const result = await operation(); current(write); return result; };
  const validate = async () => { current(true); await backend.validate({ ...context, owner }, check(true)); current(true); };
  const assertTarget = () => { const doc = current(); if (!target) throw Error('changed'); return hyperAssertFootnoteAnchor(doc, target); };
  const runMutation = async (remove: boolean) => {
    const state = store.getState(); if (state.status !== 'editing' || !target) return undefined;
    const captured = target, draft = { ...state.draft }, run = revision; let accepted = false;
    try {
      const before = current(true), index = hyperAssertFootnoteAnchor(before, captured);
      if (remove && captured.kind !== 'existing') throw Error('unsupported');
      if (captured.kind === 'existing' && !captured.editable) throw Error('unsupported');
      const original = captured.kind === 'existing' ? captured.read.value ?? undefined : undefined;
      const candidate = remove ? null : hyperBuildDocumentFootnote(index, draft, original);
      if (candidate && captured.kind === 'existing' && hyperDocumentFootnoteSignature(hyperReadDocumentFootnote({ insert: ' ', attributes: hyperDocumentFootnoteAttribute(candidate) })!) === captured.signature) { set({ status: 'idle' }); target = null; return { id: captured.blockId, offset: captured.offset + 1 }; }
      set({ status: 'saving', error: '' });
      await validate(); await check(true)(() => context.session.flush()); await check(true)(() => context.session.refresh());
      if (revision !== run) throw Error('closed');
      const fresh = current(true), refreshed = hyperAssertFootnoteAnchor(fresh, captured), value = remove ? null : hyperBuildDocumentFootnote(refreshed, draft, original);
      if (draft.kind === 'existing' && value) { const known = state.choices.find(choice => choice.label === draft.existingLabel); if (!known || known.signature !== refreshed.groups.get(draft.existingLabel)?.signature) throw Error('changed'); }
      if (value?.kind === 'citation' && value.data.reference.type === 'doc') await backend.page(value.data.reference.docId!, check(true));
      await validate(); if (revision !== run) throw Error('closed');
      set({ source: JSON.stringify({ operation: remove ? 'remove-reference' : 'save', documentId: context.session.id, workspaceId: owner.workspaceId, actorId: owner.actorId, insert: ' ', attributes: { ...(captured.kind === 'existing' ? captured.attributes : {}), ...(value ? hyperDocumentFootnoteAttribute(value) : {}) }, target: { kind: captured.kind, ...(captured.kind === 'existing' ? { blockId: captured.blockId, offset: captured.offset } : {}) } }, null, 2) });
      const result = context.session.change(doc => { current(true); return remove && captured.kind === 'existing' ? hyperRemoveDocumentFootnote(doc, captured) : value ? hyperApplyDocumentFootnoteValue(doc, captured, value, draft.kind === 'existing') : (() => { throw Error('changed'); })(); });
      if (!result) throw Error('notReady'); accepted = result.actions.length > 0;
      await check(true)(() => context.session.flush()); set({ status: 'idle' }); target = null; return result.focus;
    } catch (error) { set({ status: lost ? 'error' : accepted ? 'partial' : 'editing', error: message(error) }); return undefined; }
  };
  return Object.assign(store, {
    activate() { disposed = false; },
    fail(error: unknown) { set({ status: 'error', error: message(error), read: null, draft: hyperDocumentFootnoteDraft(), source: '', label: '', choices: [], pages: [], pagesLoading: false, references: 0, existing: false, changed: false }); },
    open(next: HyperFootnoteAnchor) {
      if (store.getState().status === 'saving') return;
      revision++; pageRevision++; target = structuredClone(next);
      try {
        const doc = current(), index = hyperAssertFootnoteAnchor(doc, target), read = target.kind === 'existing' ? target.read : null, draft = hyperDocumentFootnoteDraft(read?.value ?? null);
        initialDraft = JSON.stringify(draft);
        set({ status: context.editable() && (target.kind === 'insert' || target.editable) ? 'editing' : 'inspecting', draft, read, existing: target.kind === 'existing', label: read?.label ?? '', references: read?.label ? index.groups.get(read.label)?.entries.length ?? 0 : 0, changed: false, choices: [...index.groups.values()].flatMap(choice), pages: [], pagesLoading: false, error: index.conflict ? 'conflict' : '', source: target.kind === 'existing' ? JSON.stringify({ insert: target.insert, attributes: target.attributes }, null, 2) : '' });
      } catch (error) { set({ status: 'error', error: message(error), read: null, draft: hyperDocumentFootnoteDraft(), source: '', label: '', choices: [], pages: [], pagesLoading: false, references: 0, existing: false, changed: false }); }
    },
    setDraft(patch: Partial<HyperDocumentFootnoteDraft>) { if (store.getState().status !== 'editing') return; const draft = { ...store.getState().draft, ...patch }; set({ draft, changed: JSON.stringify(draft) !== initialDraft, error: '' }); },
    async loadPages() {
      const run = ++pageRevision, opened = revision;
      try { current(); if (store.getState().status !== 'editing') return; set({ pagesLoading: true, error: '' }); const pages = await backend.pages({ ...context, owner }, check(false)); if (run === pageRevision && opened === revision) set({ pages, pagesLoading: false }); }
      catch (error) { if (run === pageRevision && opened === revision) set({ pagesLoading: false, error: message(error) }); }
    },
    async openReference() {
      try {
        const index = assertTarget(), state = store.getState(), reference = state.read?.value?.kind === 'citation' ? state.read.value.data.reference : null;
        if (!reference || state.changed || target?.kind !== 'existing' || index.groups.get(target.label)?.signature !== target.signature) throw Error('changed');
        if (reference.type === 'doc' && reference.docId) { const view = await backend.page(reference.docId, check(false)); current(); await check(false)(() => Promise.resolve(backend.openPage(view))); }
        else if (reference.type === 'url' && reference.url && hyperDocumentFootnoteUrl(reference.url)) await check(false)(() => Promise.resolve(backend.openUrl(reference.url!)));
        else throw Error('pageUnavailable');
      } catch (error) { set({ error: message(error) }); }
    },
    save: () => runMutation(false),
    remove: () => runMutation(true),
    close() {
      if (store.getState().status === 'saving') return undefined;
      let focus: { id: string; offset: number } | undefined;
      try { if (target) { hyperAssertFootnoteAnchor(current(), target); focus = target.kind === 'existing' ? { id: target.blockId, offset: target.offset + 1 } : target.selection ? { id: target.selection.id, offset: target.selection.selection.end } : undefined; } } catch { /* Closing must not focus a stale or foreign document. */ }
      revision++; pageRevision++; target = null; set({ status: 'idle', pages: [], pagesLoading: false }); return focus;
    },
    dispose() { disposed = true; revision++; pageRevision++; target = null; },
  });
}
export type HyperDocumentFootnoteStore = ReturnType<typeof createHyperDocumentFootnoteStore>;
