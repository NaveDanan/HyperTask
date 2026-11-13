import { createStore } from 'zustand';
import { ViewLayoutPB } from '@shared/protobuf/flowy-folder/view_pb';
import { DatabaseEventGetRowMeta } from '@/backend/events/flowy-database2';
import { unwrap } from '@/backend/dispatch';
import type { HyperDocumentSession } from '../document/HyperDocumentSession';
import { hyperDocumentOwnerKey, hyperGetDocumentOwner, type HyperDocumentOwner } from '../document/HyperDocumentOwner';
import { hyperCaptureDuplicateOwner, hyperDocumentDuplicateBackend } from '../document-duplicate/HyperDocumentDuplicateBackend';
import { rowDocumentIdForRow } from '../templates/converter';
import { hyperSaveDocumentEquation, type HyperEquationInsertion, type HyperEquationTarget } from './HyperDocumentEquationModel';

export interface HyperEquationContext { session: HyperDocumentSession; owner: HyperDocumentOwner; editable(): boolean; rowScope?: { viewId: string; rowId: string } }
export interface HyperEquationBackend {
  validate(context: HyperEquationContext, check: <T>(operation: () => Promise<T>) => Promise<T>): Promise<void>;
}
export const hyperDocumentEquationBackend: HyperEquationBackend = {
  async validate(context, check) {
    const { owner, session, rowScope } = context, identity = await hyperDocumentDuplicateBackend.identity(check);
    if (identity.workspaceId !== owner.workspaceId || identity.actorId !== owner.actorId) throw new Error('The active workspace or account changed.');
    await hyperDocumentDuplicateBackend.writable(rowScope?.viewId ?? session.id, owner, check);
    const view = await check(() => hyperDocumentDuplicateBackend.view(rowScope?.viewId ?? session.id));
    if (view.id !== (rowScope?.viewId ?? session.id) || (rowScope ? ![ViewLayoutPB.Grid, ViewLayoutPB.Board, ViewLayoutPB.Calendar].includes(view.layout) : view.layout !== ViewLayoutPB.Document)) throw new Error('The equation page layout changed. Reopen its editor.');
    if (rowScope) {
      const row = unwrap(await check(() => DatabaseEventGetRowMeta(rowScope))), documentId = row.oneOfDocumentId.case === 'documentId' && row.oneOfDocumentId.value ? row.oneOfDocumentId.value : rowDocumentIdForRow(row.id);
      if (row.id !== rowScope.rowId || documentId !== session.id || row.oneOfIsDocumentEmpty.case === 'isDocumentEmpty' && row.oneOfIsDocumentEmpty.value) throw new Error('The row document changed or was removed.');
    }
  },
};
const errorText = (error: unknown) => error instanceof Error ? error.message : (error as { msg?: string })?.msg ?? String(error);
export function createHyperDocumentEquationStore(context: HyperEquationContext, backend = hyperDocumentEquationBackend) {
  const owner = hyperCaptureDuplicateOwner(context.owner) ?? context.owner, key = hyperDocumentOwnerKey(owner), store = createStore(() => ({ status: 'idle' as 'idle' | 'loading' | 'editing' | 'saving' | 'partial' | 'error', formula: '', error: '' }));
  let target: HyperEquationTarget | HyperEquationInsertion | null = null, revision = 0, disposed = false, lost = false;
  const current = () => {
    const state = context.session.store.getState();
    if (disposed || lost || !owner.isCurrent() || hyperDocumentOwnerKey(hyperGetDocumentOwner()) !== key || !context.session.belongsTo(owner) || !context.session.isCurrentOwner()) { lost = true; throw new Error('The equation, workspace or account changed. Reopen the editor.'); }
    if (!context.editable() || !state.document || state.historyPending || ['loading', 'error'].includes(state.status)) throw new Error('This page is read-only or unavailable.');
    return state.document;
  };
  const check = async <T,>(operation: () => Promise<T>): Promise<T> => { current(); const result = await operation(); current(); return result; };
  const validate = async () => { current(); await backend.validate({ ...context, owner }, check); current(); };
  return Object.assign(store, {
    activate() { disposed = false; },
    fail(error: unknown) { store.setState({ status: 'error', error: errorText(error) }); },
    async open(next: HyperEquationTarget | HyperEquationInsertion) {
      if (store.getState().status === 'saving') return;
      const run = ++revision; target = next; store.setState({ status: 'loading', formula: 'formula' in next ? next.formula : '', error: '' });
      try { await validate(); if (run === revision) store.setState({ status: 'editing' }); }
      catch (error) { if (run === revision) store.setState({ status: 'error', error: errorText(error) }); }
    },
    setFormula(formula: string) { if (store.getState().status === 'editing') store.setState({ formula }); },
    async save() {
      if (store.getState().status !== 'editing' || !target) return undefined;
      const captured = target, formula = store.getState().formula, run = revision; let accepted = false;
      store.setState({ status: 'saving', error: '' });
      try {
        await validate(); await check(() => context.session.flush()); await check(() => context.session.refresh());
        if (run !== revision) throw new Error('The equation editor was closed.');
        hyperSaveDocumentEquation(current(), captured, formula);
        await validate();
        const result = context.session.change(doc => { current(); return hyperSaveDocumentEquation(doc, captured, formula); });
        if (!result) throw new Error('The equation could not be saved.'); accepted = true;
        await check(() => context.session.flush()); store.setState({ status: 'idle' }); target = null; return result.focus;
      } catch (error) { store.setState({ status: accepted ? 'partial' : 'editing', error: `${accepted ? 'The equation save was not confirmed. Copy its source before closing. ' : ''}${errorText(error)}` }); return undefined; }
    },
    close() { if (store.getState().status !== 'saving') { revision++; target = null; store.setState({ status: 'idle' }); } },
    dispose() { disposed = true; revision++; },
  });
}
export type HyperDocumentEquationStore = ReturnType<typeof createHyperDocumentEquationStore>;
