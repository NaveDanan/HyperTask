import { createStore } from 'zustand';
import type { HyperDocumentSession } from '../document/HyperDocumentSession';
import { hyperDocumentOwnerKey, hyperGetDocumentOwner, type HyperDocumentOwner } from '../document/HyperDocumentOwner';
import { hyperCaptureDuplicateOwner } from '../document-duplicate/HyperDocumentDuplicateBackend';
import { hyperDocumentEquationBackend, type HyperEquationBackend } from '../document-equation/HyperDocumentEquationStore';
import { hyperCaptureInlineMath, hyperCaptureInlineMathInsertion, hyperSaveInlineMath, hyperUnwrapInlineMath, type HyperInlineMathAnchor } from './HyperInlineMathModel';
import { hyperInlineMathWithinAtomLimit } from './HyperInlineMathValue';

export interface HyperInlineMathContext {
  session: HyperDocumentSession; owner: HyperDocumentOwner; editable(): boolean;
  currentOwner?(): HyperDocumentOwner | null; rowScope?: { viewId: string; rowId: string };
}
export interface HyperInlineMathState {
  status: 'idle' | 'loading' | 'editing' | 'inspecting' | 'saving' | 'partial' | 'error';
  formula: string; existing: boolean; changed: boolean; supported: boolean;
  source: string; recovery: string; error: string;
}
const message = (error: unknown) => error instanceof Error ? error.message : (error as { msg?: string })?.msg ?? String(error);
export function createHyperInlineMathStore(context: HyperInlineMathContext, backend: HyperEquationBackend = hyperDocumentEquationBackend) {
  const owner = hyperCaptureDuplicateOwner(context.owner) ?? context.owner, key = hyperDocumentOwnerKey(owner);
  const store = createStore<HyperInlineMathState>(() => ({ status: 'idle', formula: '', existing: false, changed: false, supported: false, source: '', recovery: '', error: '' }));
  let target: HyperInlineMathAnchor | null = null, revision = 0, disposed = false, lost = false, initial = '';
  const owned = () => !disposed && !lost && owner.isCurrent() && hyperDocumentOwnerKey((context.currentOwner ?? hyperGetDocumentOwner)()) === key && context.session.belongsTo(owner) && context.session.isCurrentOwner();
  const set = (patch: Partial<HyperInlineMathState>) => { if (owned()) store.setState(patch); };
  const current = (write = false) => {
    if (!owned()) { lost = true; throw Error('ownerChanged'); }
    const state = context.session.store.getState();
    if (!state.document || state.historyPending || ['loading', 'error'].includes(state.status)) throw Error('notReady');
    if (write && !context.editable()) throw Error('readOnly');
    return state.document;
  };
  const check = async <T,>(operation: () => Promise<T>): Promise<T> => { current(true); const result = await operation(); current(true); return result; };
  const validate = async () => { current(true); await backend.validate({ ...context, owner }, check); current(true); };
  const assertTarget = (captured: HyperInlineMathAnchor) => {
    const doc = current(), fresh = captured.kind === 'existing' ? hyperCaptureInlineMath(doc, captured.blockId, captured.start) : hyperCaptureInlineMathInsertion(doc, { id: captured.blockId, selection: { start: captured.start, end: captured.end } });
    if (fresh.pageId !== captured.pageId || fresh.source !== captured.source || fresh.path !== captured.path) throw Error('changed');
    return doc;
  };
  const mutate = async (unwrap: boolean) => {
    const state = store.getState(); if (state.status !== 'editing' || !target) return undefined;
    const captured = target, formula = state.formula, run = revision; let accepted = false;
    const build = (doc: ReturnType<typeof current>) => unwrap && captured.kind === 'existing' ? hyperUnwrapInlineMath(doc, captured) : unwrap ? (() => { throw Error('unsupported'); })() : hyperSaveInlineMath(doc, captured, formula);
    set({ status: 'saving', error: '' });
    try {
      // Preflight before any asynchronous work, then again against the fresh core snapshot.
      build(current(true)); await validate(); await check(() => context.session.flush()); await check(() => context.session.refresh());
      if (run !== revision) throw Error('changed');
      build(current(true)); await validate();
      if (run !== revision) throw Error('changed');
      set({ recovery: JSON.stringify({ operation: unwrap ? 'unwrap-inline-equation' : 'save-inline-equation', documentId: context.session.id, workspaceId: owner.workspaceId, actorId: owner.actorId, blockId: captured.blockId, start: captured.start, end: captured.end, formula, originalRuns: JSON.parse(captured.source) }, null, 2) });
      const result = context.session.change(doc => { current(true); return build(doc); });
      if (!result) throw Error('notReady');
      accepted = result.actions.length > 0;
      await check(() => context.session.flush()); set({ status: 'idle' }); target = null; return result.focus;
    } catch (error) { set({ status: accepted ? 'partial' : 'editing', error: message(error) }); return undefined; }
  };
  return Object.assign(store, {
    isCurrent: owned,
    activate() { disposed = false; },
    fail(error: unknown) { set({ status: 'error', formula: '', source: '', recovery: '', existing: false, supported: false, changed: false, error: message(error) }); },
    async open(next: HyperInlineMathAnchor) {
      if (['saving', 'partial'].includes(store.getState().status)) return;
      const run = ++revision; target = structuredClone(next);
      try {
        assertTarget(target);
        const formula = target.kind === 'insert' ? target.formula : target.read.formula ?? '', supported = target.kind === 'insert' || target.editable;
        initial = formula;
        const source = target.kind === 'existing' && !target.editable ? target.source : formula;
        set({ status: supported && context.editable() ? 'loading' : 'inspecting', formula, existing: target.kind === 'existing', changed: false, supported, source, recovery: '', error: supported ? '' : hyperInlineMathWithinAtomLimit(JSON.parse(target.source)) ? 'unsupported' : 'overflow' });
        if (!supported || !context.editable()) return;
        await validate(); if (run === revision) { assertTarget(target); set({ status: 'editing' }); }
      } catch (error) { if (run === revision) set({ status: target?.kind === 'existing' ? 'inspecting' : 'error', error: message(error) }); }
    },
    setFormula(formula: string) { if (store.getState().status === 'editing') set({ formula, changed: formula !== initial, source: formula, error: '' }); },
    save: () => mutate(false), unwrap: () => mutate(true),
    close() {
      if (store.getState().status === 'saving') return undefined;
      let selection: { id: string; start: number; end: number } | undefined;
      try { if (target) { assertTarget(target); selection = { id: target.blockId, start: target.start, end: target.end }; } } catch { /* Never restore selection in a changed or foreign document. */ }
      revision++; target = null; set({ status: 'idle' }); return selection;
    },
    dispose() { disposed = true; revision++; target = null; },
  });
}
export type HyperInlineMathStore = ReturnType<typeof createHyperInlineMathStore>;
