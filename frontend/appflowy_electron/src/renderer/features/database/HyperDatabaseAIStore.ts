import { createStore, type StoreApi } from 'zustand';
import { FieldType } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { createHyperDocumentAIStore, type HyperDocumentAIBackend, type HyperDocumentAIStore } from '../document-ai/HyperDocumentAIStore';

export interface HyperDatabaseAIContext { viewId: string; rowId: string; fieldId: string; fieldType: FieldType; workspaceId: string; actorId: string }
export interface HyperDatabaseAISource { id: string; name: string; text: string; stamp: string }
export interface HyperDatabaseAISnapshot {
  context: HyperDatabaseAIContext;
  target: { text: string; stamp: string; language: string };
  sources: HyperDatabaseAISource[];
}
export interface HyperDatabaseAIBackend {
  ai: HyperDocumentAIBackend;
  read(context: HyperDatabaseAIContext): Promise<HyperDatabaseAISnapshot>;
  write(context: HyperDatabaseAIContext, text: string): Promise<void>;
}
interface HyperDatabaseAIState {
  snapshot: HyperDatabaseAISnapshot | null;
  selectedIds: string[];
  preparing: boolean;
  applying: boolean;
  applied: boolean;
  canApply: boolean;
  error: string | null;
}
export interface HyperDatabaseAIStore extends StoreApi<HyperDatabaseAIState> {
  completion: HyperDocumentAIStore;
  start(): () => void;
  refresh(): Promise<void>;
  select(ids: string[]): void;
  invalidate(): void;
  generate(language?: string): Promise<void>;
  apply(): Promise<void>;
  dispose(): void;
}
const message = (error: unknown) => error instanceof Error ? error.message : (error as { msg?: string })?.msg ?? String(error);
const contextKey = (value: HyperDatabaseAIContext) => JSON.stringify([value.viewId, value.rowId, value.fieldId, value.fieldType, value.workspaceId, value.actorId]);
function selectedSource(snapshot: HyperDatabaseAISnapshot, ids: string[]) {
  const chosen = snapshot.sources.filter(source => ids.includes(source.id));
  if (!chosen.length || chosen.length !== ids.length) throw new Error('Choose saved row properties or the row document as source.');
  const text = chosen.map(source => `${source.name}:\n${source.text}`).join('\n\n');
  if (!chosen.some(source => source.text.trim())) throw new Error('The selected sources are empty.');
  if (text.length > 100_000) throw new Error('The selected sources are too large. Choose fewer properties.');
  return { text, stamp: JSON.stringify([snapshot.target.stamp, chosen.map(source => [source.id, source.name, source.stamp])]) };
}

/** Generation is a preview. Only apply() writes, after checking the captured row again. */
export function createHyperDatabaseAIStore(inputContext: HyperDatabaseAIContext, backend: HyperDatabaseAIBackend, isCurrent: () => boolean): HyperDatabaseAIStore {
  const context = { ...inputContext };
  const store = createStore<HyperDatabaseAIState>(() => ({ snapshot: null, selectedIds: [], preparing: false, applying: false, applied: false, canApply: false, error: null }));
  const completion = createHyperDocumentAIStore(context.viewId, backend.ai);
  let disposed = false, version = 0, captured: { ids: string[]; stamp: string } | null = null;
  const set = (values: Partial<HyperDatabaseAIState>) => { if (!disposed) store.setState(values); };
  const requireCurrent = () => { if (disposed || !isCurrent()) throw new Error('The row, workspace or edit permission changed. Reopen this cell.'); };
  const validate = (snapshot: HyperDatabaseAISnapshot) => {
    if (contextKey(snapshot.context) !== contextKey(context)) throw new Error('The row, workspace or account changed. Reopen this cell.');
    if (![FieldType.Summary, FieldType.Translate].includes(snapshot.context.fieldType)) throw new Error('This property is no longer an AI field.');
  };
  const busy = () => store.getState().preparing || store.getState().applying || ['generating', 'stopping'].includes(completion.getState().status);
  const invalidate = () => { version++; captured = null; set({ canApply: false, applied: false }); };
  return Object.assign(store, {
    completion,
    start() { disposed = false; set({ preparing: false, applying: false, canApply: false, applied: false }); completion.start(); void this.refresh(); return () => this.dispose(); },
    async refresh() {
      if (disposed || busy()) return;
      invalidate(); const current = version;
      set({ preparing: true, error: null });
      try {
        requireCurrent(); const snapshot = await backend.read(context); requireCurrent(); validate(snapshot);
        if (current === version) set({ snapshot, selectedIds: store.getState().selectedIds.filter(id => snapshot.sources.some(source => source.id === id)) });
      } catch (error) { if (current === version) set({ error: message(error), snapshot: null }); }
      finally { if (current === version) set({ preparing: false }); }
    },
    select(ids: string[]) {
      if (disposed || busy()) return;
      invalidate(); set({ selectedIds: [...new Set(ids)], error: null });
    },
    invalidate,
    async generate(language?: string) {
      if (disposed || busy()) return;
      invalidate(); const current = version, ids = [...store.getState().selectedIds];
      set({ preparing: true, error: null });
      try {
        requireCurrent(); const snapshot = await backend.read(context); requireCurrent(); validate(snapshot);
        if (current !== version) return;
        const source = selectedSource(snapshot, ids);
        captured = { ids, stamp: source.stamp }; set({ snapshot });
        await completion.run(context.fieldType === FieldType.Translate ? 'translate' : 'summarize', { sourceText: source.text, selectionKey: source.stamp, usedSelection: true }, language);
        if (current === version) set({ canApply: true });
      } catch (error) { if (current === version) { captured = null; set({ error: message(error), canApply: false }); } }
      finally { if (current === version) set({ preparing: false }); }
    },
    async apply() {
      const result = completion.getState();
      if (disposed || busy() || !captured || !store.getState().canApply || store.getState().applied || result.status !== 'ready' || !result.result.trim()) throw new Error('Generate and review a completed result first.');
      const current = version, expected = captured;
      set({ applying: true, error: null });
      try {
        requireCurrent(); const latest = await backend.read(context); requireCurrent(); validate(latest);
        if (current !== version || selectedSource(latest, expected.ids).stamp !== expected.stamp) throw new Error('The source or saved cell changed. Generate a fresh result before replacing it.');
        await backend.write(context, result.result);
        if (current === version) set({ snapshot: latest, applied: true, canApply: false });
      } catch (error) { if (current === version) set({ error: message(error) }); throw error; }
      finally { if (current === version) set({ applying: false }); }
    },
    dispose() { if (disposed) return; disposed = true; version++; captured = null; completion.dispose(); },
  });
}
