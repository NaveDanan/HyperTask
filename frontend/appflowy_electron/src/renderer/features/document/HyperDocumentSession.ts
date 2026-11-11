import { fromBinary } from '@bufbuild/protobuf';
import { createStore } from 'zustand';
import { DocEventPBSchema, type BlockActionPB, type DocumentDataPB } from '@shared/protobuf/flowy-document/entities_pb';
import { DocumentNotification } from '@shared/protobuf/flowy-document/notification_pb';
import {
  DocumentEventOpenDocument, DocumentEventCloseDocument, DocumentEventGetDocumentData,
  DocumentEventApplyAction, DocumentEventUndo, DocumentEventRedo,
} from '@/backend/events/flowy-document';
import { unwrap } from '@/backend/dispatch';
import { listen, NotificationSource } from '@/backend/notifications';
import type { HyperDocumentChange } from './HyperDocumentModel';

export interface HyperDocumentBackend {
  open(id: string): Promise<DocumentDataPB>;
  read(id: string): Promise<DocumentDataPB>;
  apply(id: string, actions: BlockActionPB[]): Promise<void>;
  close(id: string): Promise<void>;
  history(id: string, redo: boolean): Promise<void>;
  listen(id: string, onUpdate: () => void): () => void;
}
export interface HyperDocumentScope {
  workspaceId: string;
  actorId: string;
  /** Optional server/storage/launch identity when workspace IDs alone are not unique. */
  contextKey?: string;
  /** Check the current core owner, not the lifetime of an individual pane. */
  isCurrent(): boolean;
}
export class HyperDocumentScopeError extends Error {
  constructor() { super('The document workspace or account changed. The original draft has been kept.'); this.name = 'HyperDocumentScopeError'; }
}
const scopeKey = (scope: HyperDocumentScope) => JSON.stringify([scope.contextKey ?? '', scope.workspaceId, scope.actorId]);
const scopeCurrent = (scope: HyperDocumentScope) => { try { return scope.isCurrent(); } catch { return false; } };
interface CoreDocumentQueue { owner: HyperDocumentSession | null; queue: Promise<void> }
const coreQueues = new WeakMap<HyperDocumentBackend, Map<string, CoreDocumentQueue>>();
function coreDocumentQueue(service: HyperDocumentBackend, id: string) {
  let queues = coreQueues.get(service);
  if (!queues) { queues = new Map(); coreQueues.set(service, queues); }
  let queue = queues.get(id);
  if (!queue) { queue = { owner: null, queue: Promise.resolve() }; queues.set(id, queue); }
  return queue;
}
const backend: HyperDocumentBackend = {
  open: async documentId => unwrap(await DocumentEventOpenDocument({ documentId })),
  read: async documentId => unwrap(await DocumentEventGetDocumentData({ documentId })),
  apply: async (documentId, actions) => unwrap(await DocumentEventApplyAction({ documentId, actions })),
  close: async documentId => unwrap(await DocumentEventCloseDocument({ documentId })),
  history: async (documentId, redo) => { unwrap(await (redo ? DocumentEventRedo : DocumentEventUndo)({ documentId })); },
  listen: (id, onUpdate) => listen<DocumentNotification>(NotificationSource.Document, (type, result) => {
    if (type === DocumentNotification.DidReceiveUpdate && result.ok) {
      // Own actions are already applied optimistically. Remote updates and history snapshots
      // must be read after pending writes, so they cannot replace unsaved local text.
      const event = fromBinary(DocEventPBSchema, result.value);
      if (event.isRemote || event.oneOfNewSnapshot.case === 'newSnapshot') onUpdate();
    }
  }, id),
};
export interface HyperDocumentState {
  document: DocumentDataPB | null;
  status: 'loading' | 'ready' | 'saving' | 'error';
  error: string | null;
  historyPending: boolean;
}
/** A scoped companion may reconcile non-document state after native history succeeds.
 * Its errors belong to its own recovery UI, never to the document save queue. */
export interface HyperDocumentHistoryParticipant {
  blocked(): boolean;
  prepare(before: DocumentDataPB, redo: boolean): Promise<boolean>;
  complete(before: DocumentDataPB, after: DocumentDataPB, redo: boolean): Promise<void>;
  retain(): boolean;
  cancel?(error: unknown): void;
}
const errorText = (error: unknown) => error instanceof Error ? error.message : (error as { msg?: string })?.msg ?? String(error);

export class HyperDocumentSession {
  readonly store = createStore<HyperDocumentState>(() => ({ document: null, status: 'loading', error: null, historyPending: false }));
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private revision = 0;
  private readVersion = 0;
  private refreshNeeded = false;
  private disposed = false;
  private stopListening: () => void;
  private opening: Promise<void>;
  private failure: unknown;
  private ownershipLost = false;
  private unsaved = false;
  private coreQueue: CoreDocumentQueue | undefined;
  private readonly scope?: HyperDocumentScope;
  private historyParticipant?: HyperDocumentHistoryParticipant;

  attachHistoryParticipant(participant: HyperDocumentHistoryParticipant): void {
    if (this.historyParticipant && this.historyParticipant !== participant) throw new Error('This document already has a history participant.');
    this.historyParticipant = participant;
  }

  /** A saved document can still have an unfinished native-history companion. */
  assertCopyReady(): void {
    this.requireCurrent();
    if (this.store.getState().historyPending || this.historyParticipant?.blocked() || this.historyParticipant?.retain()) throw new Error('Finish document history or reminder recovery before copying this row.');
    if (this.failure) throw this.failure;
  }

  /** Isolated custom backends may omit scope; shared renderer acquisitions supply it. */
  constructor(readonly id: string, private readonly service: HyperDocumentBackend = backend, scope?: HyperDocumentScope) {
    this.scope = scope ? { ...scope } : undefined;
    this.stopListening = () => {};
    if (this.scope && scopeCurrent(this.scope)) {
      this.coreQueue = coreDocumentQueue(service, id);
      this.coreQueue.owner?.loseOwnership();
      this.coreQueue.owner = this;
    }
    this.opening = this.call(async () => {
      this.stopListening = service.listen(id, () => { void this.refresh(); });
      return service.open(id);
    }).then(document => {
      if (this.current()) this.store.setState({ document, status: 'ready' });
    }).catch(error => { this.fail(error); });
    this.queue = this.opening;
  }
  private fail(error: unknown) {
    this.failure = error;
    if (!this.disposed) this.store.setState({ status: 'error', error: errorText(error) });
  }
  /** Ownership loss is permanent for this session. Returning to the workspace never
   * retries an old queue or replaces a retained draft with fresh core data. */
  private loseOwnership() {
    if (this.ownershipLost || this.disposed) return;
    this.ownershipLost = true; this.readVersion++;
    this.stopListening(); this.stopListening = () => {};
    this.fail(this.failure ?? new HyperDocumentScopeError());
  }
  isCurrentOwner(): boolean { return this.current(); }
  /** Safe for render guards. Failed drafts remain visible to their original owner. */
  belongsTo(scope: HyperDocumentScope): boolean {
    return !this.disposed && !!this.scope && scopeKey(this.scope) === scopeKey(scope) && scopeCurrent(scope);
  }
  private current(): boolean {
    if (this.disposed || this.ownershipLost) return false;
    if (this.scope && (!scopeCurrent(this.scope) || this.coreQueue?.owner !== this)) { this.loseOwnership(); return false; }
    return true;
  }
  private requireCurrent() { if (!this.current()) throw new HyperDocumentScopeError(); }
  private call<T>(operation: () => Promise<T>): Promise<T> {
    if (this.scope && !this.current()) return Promise.reject(new HyperDocumentScopeError());
    if (!this.coreQueue) return operation();
    const queued = this.coreQueue.queue.then(async () => {
      this.requireCurrent();
      const result = await operation();
      this.requireCurrent();
      return result;
    });
    this.coreQueue.queue = queued.then(() => {}, () => {});
    return queued;
  }
  change(build: (document: DocumentDataPB) => HyperDocumentChange): HyperDocumentChange | null {
    const state = this.store.getState();
    if (!this.current() || !state.document || state.historyPending || this.failure) return null;
    const change = build(state.document);
    if (!change.actions.length) return change;
    this.revision++;
    this.unsaved = true;
    this.pending++;
    this.store.setState({ document: change.document, status: 'saving' });
    this.queue = this.queue.then(async () => {
      if (this.failure) return;
      try { await this.call(() => this.service.apply(this.id, change.actions)); }
      catch (error) { this.fail(error); }
    }).finally(() => {
      this.pending--;
      if (!this.pending && !this.failure && !this.disposed) {
        this.unsaved = false;
        this.store.setState({ status: 'ready' });
        if (this.refreshNeeded) void this.refresh();
      }
    });
    return change;
  }
  async flush() {
    this.requireCurrent();
    // A change can join the queue during an await.
    let queued;
    do { queued = this.queue; await queued; } while (queued !== this.queue);
    this.requireCurrent();
    if (this.failure) throw this.failure;
  }
  async refresh() {
    this.refreshNeeded = true;
    if (!this.current() || this.pending || this.failure) return;
    this.refreshNeeded = false;
    const revision = this.revision;
    const readVersion = ++this.readVersion;
    try {
      await this.opening;
      this.requireCurrent();
      const document = await this.call(() => this.service.read(this.id));
      if (!this.current() || this.failure || readVersion !== this.readVersion) return;
      if (this.pending || revision !== this.revision) { this.refreshNeeded = true; return; }
      this.store.setState({ document });
    } catch (error) { this.fail(error); }
  }
  async history(redo: boolean) {
    if (!this.current() || this.store.getState().historyPending || this.failure || this.historyParticipant?.blocked()) return;
    this.store.setState({ historyPending: true });
    let before: DocumentDataPB | null = null;
    try {
      await this.flush();
      before = this.store.getState().document;
      if (!before || this.historyParticipant && !await this.historyParticipant.prepare(before, redo).catch(() => false)) { this.store.setState({ historyPending: false }); return; }
      this.requireCurrent();
      // Serialize history with text mutations, just like a normal edit.
      this.pending++;
      this.store.setState({ status: 'saving' });
      this.queue = this.queue.then(() => this.call(() => this.service.history(this.id, redo))).catch(error => this.fail(error)).finally(() => { this.pending--; });
      await this.queue;
      if (this.failure) this.historyParticipant?.cancel?.(this.failure);
      await this.refresh();
      if (!this.failure && !this.disposed) this.store.setState({ status: 'ready' });
    } catch (error) { this.historyParticipant?.cancel?.(error); this.fail(error); }
    // A failed reminder operation must not turn a successful native Undo into a failed
    // document save, or cause a second Undo when the user retries that operation.
    try {
      const after = this.store.getState().document;
      if (before && after && !this.failure && !this.disposed) await this.historyParticipant?.complete(before, after, redo);
    } catch { /* Participants retain their own scoped recovery details. */ }
    finally { if (!this.disposed) this.store.setState({ historyPending: false }); }
  }
  /** Explicit user-confirmed recovery. Failed actions are never replayed. The old draft
   * remains available until a fresh saved document has been opened successfully. */
  async reloadSaved(): Promise<void> {
    if (this.disposed || this.store.getState().historyPending) throw new Error('The document is not ready to reload.');
    if (this.scope && !scopeCurrent(this.scope)) throw new HyperDocumentScopeError();
    this.store.setState({ historyPending: true });
    const recovering = this.queue.then(async () => {
      if (this.disposed || this.scope && !scopeCurrent(this.scope)) throw new HyperDocumentScopeError();
      if (this.scope) {
        this.coreQueue = coreDocumentQueue(this.service, this.id);
        if (this.coreQueue.owner !== this) this.coreQueue.owner?.loseOwnership();
        this.coreQueue.owner = this;
      }
      this.ownershipLost = false; this.readVersion++; this.revision++;
      this.stopListening(); this.stopListening = () => {};
      const document = await this.call(() => this.service.open(this.id));
      this.requireCurrent();
      this.stopListening = this.service.listen(this.id, () => { void this.refresh(); });
      this.failure = undefined; this.unsaved = false; this.refreshNeeded = false;
      this.store.setState({ document, status: 'ready', error: null });
    }).catch(error => { this.fail(error); throw error; }).finally(() => {
      if (!this.disposed) this.store.setState({ historyPending: false });
    });
    this.queue = recovering.catch(() => {});
    await recovering;
  }
  async dispose(): Promise<boolean> {
    // Keep a failed session in memory, including its unsaved document, for reopening/export.
    await this.queue;
    if (this.historyParticipant?.retain()) return false;
    const current = this.current();
    if (this.failure && this.store.getState().document && (this.unsaved || !this.ownershipLost)) return false;
    this.stopListening();
    this.stopListening = () => {};
    if (current) {
      try { await this.call(() => this.service.close(this.id)); } catch { /* The core may already have exited or changed owner. */ }
    }
    if (this.failure && this.store.getState().document && (this.unsaved || !this.ownershipLost)) return false;
    this.disposed = true;
    if (this.coreQueue?.owner === this) {
      this.coreQueue.owner = null;
      const queues = coreQueues.get(this.service);
      if (queues?.get(this.id) === this.coreQueue) queues.delete(this.id);
    }
    return true;
  }
}

// A document can be visible in both the main and side panes. Closing either pane must not
// close the core document while the other pane is editing it.
interface HyperDocumentEntry { id: string; scope: HyperDocumentScope; session: HyperDocumentSession; users: number; version: number; closing?: Promise<boolean> }
export class HyperDocumentSessionPool {
  private readonly sessions = new Map<string, HyperDocumentEntry>();
  private readonly scopedIds = new Set<string>();
  constructor(private readonly service: HyperDocumentBackend = backend) {}
  async acquire(id: string, scope?: HyperDocumentScope): Promise<{ session: HyperDocumentSession; release(): void }> {
    if (scope && !scopeCurrent(scope)) throw new HyperDocumentScopeError();
    if (!scope && this.scopedIds.has(id)) throw new Error('Document ownership is required to reopen this document.');
    if (scope) this.scopedIds.add(id);
    const owner = scope ? { ...scope } : { workspaceId: '$legacy', actorId: '$legacy', isCurrent: () => true };
    const key = JSON.stringify([id, scope ? 'scoped' : 'legacy', scopeKey(owner)]);
    let entry = this.sessions.get(key);
    if (entry?.closing) { await entry.closing; entry = this.sessions.get(key); }
    if (scope && !scopeCurrent(scope)) throw new HyperDocumentScopeError();
    if (!entry) {
      entry = { id, scope: owner, session: new HyperDocumentSession(id, this.service, owner), users: 0, version: 0 };
      this.sessions.set(key, entry);
    }
    entry.users++; entry.version++;
    const owned = entry;
    let released = false;
    return { session: entry.session, release: () => {
      if (released) return;
      released = true; owned.users--;
      const version = ++owned.version;
      queueMicrotask(() => {
        if (owned.users || version !== owned.version) return;
        owned.closing = owned.session.dispose().then(closed => {
          if (closed && this.sessions.get(key) === owned) this.sessions.delete(key);
          else owned.closing = undefined;
          return closed;
        });
      });
    } };
  }
  async flush(id: string, scope?: HyperDocumentScope, forCopy = false) {
    if (scope) {
      if (!scopeCurrent(scope)) throw new HyperDocumentScopeError();
      const entry = this.sessions.get(JSON.stringify([id, 'scoped', scopeKey(scope)]));
      if (forCopy) entry?.session.assertCopyReady();
      await entry?.session.flush();
      if (!scopeCurrent(scope)) throw new HyperDocumentScopeError();
      if (forCopy) entry?.session.assertCopyReady();
      return;
    }
    // Legacy read-only callers can wait for a single current owner, but never flush
    // an inactive account's queue or use an ambiguous owner implicitly.
    const entries = Array.from(this.sessions.values()).filter(entry => entry.id === id && scopeCurrent(entry.scope));
    if (entries.length > 1) throw new Error('Document ownership is required to flush this document.');
    if (forCopy) entries[0]?.session.assertCopyReady();
    await entries[0]?.session.flush();
    if (forCopy) entries[0]?.session.assertCopyReady();
  }
}
const sessions = new HyperDocumentSessionPool();
export const acquireHyperDocument = (id: string, scope?: HyperDocumentScope) => sessions.acquire(id, scope);
export const flushHyperDocument = (id: string, scope?: HyperDocumentScope) => sessions.flush(id, scope);
export const flushHyperDocumentForCopy = (id: string, scope: HyperDocumentScope) => sessions.flush(id, scope, true);
