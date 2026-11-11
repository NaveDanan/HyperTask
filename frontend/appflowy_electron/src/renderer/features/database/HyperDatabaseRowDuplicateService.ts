import { createStore } from 'zustand';
import type { RowMetaPB } from '@shared/protobuf/flowy-database2/row_entities_pb';
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { ViewLayoutPB } from '@shared/protobuf/flowy-folder/view_pb';
import type { HyperDocumentOwner } from '../document/HyperDocumentOwner';
import { hyperDocumentOwnerKey } from '../document/HyperDocumentOwner';
import { hyperRowDuplicateBinding, hyperRowDuplicateDocument, hyperRowDuplicateKey, type HyperRowDuplicateRequest } from './HyperDatabaseRowDuplicateModel';

type Check = <T>(operation: () => Promise<T>) => Promise<T>;
export interface HyperDatabaseRowDuplicateBackend {
  owner(): HyperDocumentOwner | null;
  capture(owner: HyperDocumentOwner): HyperDocumentOwner | null;
  writable(viewId: string, owner: HyperDocumentOwner, check: Check): Promise<ViewPB>;
  database(viewId: string): Promise<{ id: string; rows: { id: string }[] }>;
  row(viewId: string, rowId: string): Promise<RowMetaPB>;
  flush(documentId: string, owner: HyperDocumentOwner): Promise<void>;
  pending(owner: HyperDocumentOwner, databaseId: string): boolean;
  duplicate?: (request: HyperRowDuplicateRequest) => Promise<RowMetaPB>;
}
export interface HyperRowDuplicatePlan {
  key: string; owner: HyperDocumentOwner; databaseId: string; request: HyperRowDuplicateRequest;
  status: 'preparing' | 'copying' | 'uncertain' | 'blocked'; error: string; dismissed: boolean; needsReview: boolean;
}
export interface HyperRowDuplicateOptions { owner: HyperDocumentOwner; databaseId: string; viewId: string; rowId: string; groupId?: string; editable(): boolean; hasPending?(): boolean }
const message = (error: unknown) => (error as { msg?: string; message?: string })?.msg ?? (error as Error)?.message ?? String(error);
const changed = () => new Error('The row copy workspace, account or app session changed. Return to its original workspace to review it.');
/** Pending operations own immutable native arguments, never a component retry callback. */
export class HyperDatabaseRowDuplicateService {
  readonly store = createStore(() => ({ plans: [] as HyperRowDuplicatePlan[] }));
  private active = new Map<string, Promise<RowMetaPB>>();
  constructor(readonly backend: HyperDatabaseRowDuplicateBackend) {}
  private owner(owner: HyperDocumentOwner) {
    const current = this.backend.owner();
    if (!current || !owner.isCurrent() || hyperDocumentOwnerKey(current) !== hyperDocumentOwnerKey(owner)) throw changed();
  }
  private check(owner: HyperDocumentOwner, options: { editable(): boolean; hasPending?(): boolean }, databaseId: string): Check {
    const current = () => { this.owner(owner); if (!options.editable()) throw new Error('This database is read-only.'); if (options.hasPending?.() || this.backend.pending(owner, databaseId)) throw new Error('Save or discard pending cell and form changes before copying a row.'); };
    return async operation => { current(); const result = await operation(); current(); return result; };
  }
  private set(key: string, patch: Partial<HyperRowDuplicatePlan>) { this.store.setState(state => ({ plans: state.plans.map(plan => plan.key === key ? { ...plan, ...patch } : plan) })); }
  find(owner: HyperDocumentOwner, viewId: string, rowId: string) { const key = hyperRowDuplicateKey(owner, viewId, rowId); return this.store.getState().plans.find(plan => plan.key === key); }
  async start(options: HyperRowDuplicateOptions): Promise<RowMetaPB> {
    this.owner(options.owner);
    const key = hyperRowDuplicateKey(options.owner, options.viewId, options.rowId), running = this.active.get(key);
    if (running) return running;
    if (this.find(options.owner, options.viewId, options.rowId)) throw new Error('This row already has a pending copy. Use Retry row copy to finish that operation.');
    if (!this.backend.duplicate) throw new Error('Row duplication is unavailable in this app session.');
    if (!options.viewId || !options.rowId || !options.databaseId) throw new Error('The source database row is unavailable.');
    const owner = this.backend.capture(options.owner); if (!owner) throw changed();
    const plan: HyperRowDuplicatePlan = { key, owner, databaseId: options.databaseId, request: { viewId: options.viewId, rowId: options.rowId, operationId: crypto.randomUUID(), ...(options.groupId ? { groupId: options.groupId } : {}) }, status: 'preparing', error: '', dismissed: false, needsReview: false };
    this.store.setState(state => ({ plans: [...state.plans, plan] })); return this.run(plan, options, false);
  }
  retry(key: string, options: { owner: HyperDocumentOwner; editable(): boolean; hasPending?(): boolean }): Promise<RowMetaPB> {
    this.owner(options.owner); const plan = this.store.getState().plans.find(plan => plan.key === key);
    if (!plan || hyperDocumentOwnerKey(plan.owner) !== hyperDocumentOwnerKey(options.owner)) return Promise.reject(changed());
    const running = this.active.get(key); if (running) return running;
    const owner = this.backend.capture(options.owner); if (!owner) return Promise.reject(changed());
    return this.run({ ...plan, owner }, options, true);
  }
  private run(plan: HyperRowDuplicatePlan, options: { editable(): boolean; hasPending?(): boolean }, retry: boolean): Promise<RowMetaPB> {
    const check = this.check(plan.owner, options, plan.databaseId);
    const request = (async () => {
      let sent = false;
      this.set(plan.key, { owner: plan.owner, status: 'preparing', error: '', dismissed: false });
      try {
        const writable = async () => { const view = await check(() => this.backend.writable(plan.request.viewId, plan.owner, check)); if (view.id !== plan.request.viewId || ![ViewLayoutPB.Grid, ViewLayoutPB.Board, ViewLayoutPB.Calendar].includes(view.layout)) throw new Error('The source database layout changed.'); };
        await writable();
        const database = await check(() => this.backend.database(plan.request.viewId));
        if (database.id !== plan.databaseId) throw new Error('The source database changed.');
        if (!retry || plan.status !== 'uncertain') {
          if (!database.rows.some(row => row.id === plan.request.rowId)) throw new Error('The source row is no longer available in this view.');
          const row = await check(() => this.backend.row(plan.request.viewId, plan.request.rowId));
          if (row.id !== plan.request.rowId) throw new Error('The source row changed.');
          const documentId = hyperRowDuplicateDocument(row); if (documentId) await check(() => this.backend.flush(documentId, plan.owner));
          const latest = await check(() => this.backend.row(plan.request.viewId, plan.request.rowId));
          if (hyperRowDuplicateBinding(latest) !== hyperRowDuplicateBinding(row)) throw new Error('The source row body changed. Reopen the row before copying it.');
        }
        // Retry intentionally reaches native completed-operation lookup before requiring source existence.
        await writable(); if (!this.backend.duplicate) throw new Error('Row duplication is unavailable in this app session.');
        this.set(plan.key, { status: 'copying' });
        const result = await check(() => { sent = true; return this.backend.duplicate!({ ...plan.request }); });
        if (!result.id || result.id === plan.request.rowId) throw new Error('The copied row acknowledgement is invalid.');
        this.store.setState(state => ({ plans: state.plans.filter(item => item.key !== plan.key) })); return result;
      } catch (error) {
        let safe = message(error); try { this.owner(plan.owner); } catch { safe = changed().message; }
        this.set(plan.key, { status: sent || plan.status === 'uncertain' ? 'uncertain' : 'blocked', error: safe, dismissed: false, needsReview: true }); throw new Error(safe);
      }
    })();
    this.active.set(plan.key, request);
    const release = () => { if (this.active.get(plan.key) === request) this.active.delete(plan.key); }; void request.then(release, release); return request;
  }
  dismiss(key: string, owner: HyperDocumentOwner) { this.owner(owner); const plan = this.store.getState().plans.find(plan => plan.key === key); if (plan && !this.active.has(key) && hyperDocumentOwnerKey(plan.owner) === hyperDocumentOwnerKey(owner)) this.set(key, { dismissed: true }); }
  details(key: string, owner: HyperDocumentOwner): string {
    this.owner(owner); const plan = this.store.getState().plans.find(plan => plan.key === key); if (!plan || hyperDocumentOwnerKey(plan.owner) !== hyperDocumentOwnerKey(owner)) throw changed();
    return JSON.stringify({ action: 'retry-same-row-copy-operation-only', databaseId: plan.databaseId, ...plan.request, status: plan.status, error: plan.error }, null, 2);
  }
}
