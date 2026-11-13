import { createStore } from 'zustand';
import { ViewLayoutPB } from '@shared/protobuf/flowy-folder/view_pb';
import { DatabaseEventGetRowMeta } from '@/backend/events/flowy-database2';
import { unwrap } from '@/backend/dispatch';
import type { HyperDocumentSession } from '../document/HyperDocumentSession';
import { hyperDocumentOwnerKey, hyperGetDocumentOwner, type HyperDocumentOwner } from '../document/HyperDocumentOwner';
import { hyperCaptureDuplicateOwner, hyperDocumentDuplicateBackend } from '../document-duplicate/HyperDocumentDuplicateBackend';
import { rowDocumentIdForRow } from '../templates/converter';
import { hyperCodeLanguage, type HyperCodeLanguage } from './HyperDocumentCodeValue';
import { hyperCaptureDocumentCode, hyperRequireCodeTarget, hyperSaveCodeLanguage, type HyperCodeTarget } from './HyperDocumentCodeModel';
export interface HyperCodeContext { session: HyperDocumentSession; owner: HyperDocumentOwner; editable(): boolean; rowScope?: { viewId: string; rowId: string } }
export interface HyperCodeBackend { validate(context: HyperCodeContext, check: <T>(operation: () => Promise<T>) => Promise<T>): Promise<void> }
export const hyperDocumentCodeBackend: HyperCodeBackend = {
  async validate(context, check) {
    const { owner, session, rowScope } = context, identity = await hyperDocumentDuplicateBackend.identity(check);
    if (identity.workspaceId !== owner.workspaceId || identity.actorId !== owner.actorId) throw Error('The active workspace or account changed.');
    await hyperDocumentDuplicateBackend.writable(rowScope?.viewId ?? session.id, owner, check);
    const view = await check(() => hyperDocumentDuplicateBackend.view(rowScope?.viewId ?? session.id));
    if (view.id !== (rowScope?.viewId ?? session.id) || (rowScope ? ![ViewLayoutPB.Grid, ViewLayoutPB.Board, ViewLayoutPB.Calendar].includes(view.layout) : view.layout !== ViewLayoutPB.Document)) throw Error('The code page layout changed. Reopen its language picker.');
    if (rowScope) {
      const row = unwrap(await check(() => DatabaseEventGetRowMeta(rowScope))), documentId = row.oneOfDocumentId.case === 'documentId' && row.oneOfDocumentId.value ? row.oneOfDocumentId.value : rowDocumentIdForRow(row.id);
      if (row.id !== rowScope.rowId || documentId !== session.id || row.oneOfIsDocumentEmpty.case === 'isDocumentEmpty' && row.oneOfIsDocumentEmpty.value) throw Error('The row document changed or was removed.');
    }
  },
};
const errorText = (error: unknown) => error instanceof Error ? error.message : (error as { msg?: string })?.msg ?? String(error);
export function createHyperDocumentCodeStore(context: HyperCodeContext, backend = hyperDocumentCodeBackend) {
  const owner = hyperCaptureDuplicateOwner(context.owner) ?? context.owner, key = hyperDocumentOwnerKey(owner), store = createStore(() => ({ status: 'idle' as 'idle' | 'loading' | 'editing' | 'saving' | 'partial' | 'error', language: null as HyperCodeLanguage, dirty: false, error: '' }));
  let target: HyperCodeTarget | null = null, revision = 0, disposed = false, lost = false;
  const validOwner = () => !disposed && !lost && owner.isCurrent() && hyperDocumentOwnerKey(hyperGetDocumentOwner()) === key && context.session.belongsTo(owner) && context.session.isCurrentOwner();
  const current = () => {
    if (!validOwner()) { lost = true; throw Error('The code block, workspace or account changed. Reopen the language picker.'); }
    const state = context.session.store.getState();
    if (!context.editable() || !state.document || state.historyPending || ['loading', 'error'].includes(state.status)) throw Error('This page is read-only or unavailable.');
    return state.document;
  };
  const check = async <T,>(operation: () => Promise<T>): Promise<T> => { current(); const result = await operation(); current(); return result; };
  const validate = async () => { current(); await backend.validate({ ...context, owner }, check); current(); };
  const inactive = () => { target = null; store.setState({ status: 'idle', language: null, dirty: false, error: '' }); };
  return Object.assign(store, {
    activate() { disposed = false; },
    async open(blockId: string) {
      if (store.getState().status === 'saving') return;
      const run = ++revision;
      try {
        const doc = current(); target = hyperCaptureDocumentCode(doc, blockId); const language = hyperCodeLanguage(doc.blocks[blockId]).value;
        store.setState({ status: 'loading', language, dirty: false, error: '' }); await validate();
        if (run === revision) { hyperRequireCodeTarget(current(), target); store.setState({ status: 'editing' }); }
      } catch (error) { if (run === revision) { if (validOwner()) store.setState({ status: 'error', error: errorText(error) }); else inactive(); } }
    },
    setLanguage(language: HyperCodeLanguage) { if (store.getState().status === 'editing') store.setState({ language, dirty: !target?.language.present || target.language.value !== language, error: '' }); },
    async save() {
      if (store.getState().status !== 'editing' || !store.getState().dirty || !target) return false;
      const captured = target, language = store.getState().language, run = revision; let accepted = false;
      store.setState({ status: 'saving', error: '' });
      try {
        await validate(); await check(() => context.session.flush()); await check(() => context.session.refresh());
        if (run !== revision) throw Error('The code language picker was closed.');
        hyperSaveCodeLanguage(current(), captured, language); await validate();
        const applied = context.session.change(doc => { current(); return hyperSaveCodeLanguage(doc, captured, language); });
        if (!applied) throw Error('The code language could not be saved.'); accepted = true;
        await check(() => context.session.flush()); if (run === revision) inactive(); return true;
      } catch (error) { if (run === revision) { if (validOwner()) store.setState({ status: accepted ? 'partial' : 'editing', error: `${accepted ? 'The language save was not confirmed. Copy its source before closing. ' : ''}${errorText(error)}` }); else inactive(); } return false; }
    },
    details() { return validOwner() ? JSON.stringify({ version: 1, documentId: context.session.id, rowScope: context.rowScope, target, language: store.getState().language }, null, 2) : ''; },
    close() { if (store.getState().status !== 'saving') { revision++; inactive(); } },
    dispose() { disposed = true; revision++; },
  });
}
export type HyperDocumentCodeStore = ReturnType<typeof createHyperDocumentCodeStore>;
