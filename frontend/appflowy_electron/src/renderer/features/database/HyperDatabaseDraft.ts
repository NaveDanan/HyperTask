import { FieldType, type FieldPB } from '@shared/protobuf/flowy-database2/field_entities_pb';
import type { CellPB } from '@shared/protobuf/flowy-database2/cell_entities_pb';
import type { MediaFilePB } from '@shared/protobuf/flowy-database2/media_entities_pb';
import type { HyperDocumentOwner } from '../document/HyperDocumentOwner';
import type { HyperDatabaseRepository } from './HyperDatabaseRepository';
import { hyperDecodeCell, type HyperCellValue } from './HyperDatabaseCells';

export type HyperDatabaseDraftOwner = HyperDocumentOwner;
export const hyperDatabaseDraftOwnerKey = (owner: HyperDatabaseDraftOwner) => JSON.stringify([owner.contextKey, owner.workspaceId, owner.actorId]);
export const hyperDatabaseDraftFieldKey = (field: FieldPB) => JSON.stringify([field.fieldType, Array.from(field.typeOptionData)]);
export type HyperDatabaseDraftMethod = 'updateText' | 'updateDate' | 'updateDateDetails' | 'updateSelect' | 'createSelectOption' | 'checklist' | 'relation' | 'attachMediaFiles' | 'attachMediaLink' | 'removeMedia' | 'renameMedia' | 'uploadMedia';
export interface HyperDatabaseDraftMutation { method: HyperDatabaseDraftMethod; args: unknown[] }
export interface HyperDatabaseDraftTarget {
  owner: HyperDatabaseDraftOwner; databaseId: string; rowId: string; fieldId: string; fieldType: FieldType; fieldKey: string;
}
export interface HyperDatabaseDraftLease {
  viewId: string; repository: HyperDatabaseRepository; current(): boolean; saved(): void;
  read(target: HyperDatabaseDraftTarget): Promise<{ field: FieldPB; cell: CellPB }>;
  execute(mutation: HyperDatabaseDraftMutation, prepared: MediaFilePB[], check: () => Promise<void>, sent: () => void): Promise<void>;
}
export interface HyperDatabaseDraftState {
  value: HyperCellValue | null; draft: string; forms: Readonly<Record<string, string>>;
  dirty: boolean; saving: boolean; error: string | null; issue: 'changed' | 'unavailable' | 'uncertain' | null;
  version: number; leases: number;
}
const errorMessage = (error: unknown) => (error as { msg?: string; message?: string } | null)?.msg ?? (error as Error | null)?.message ?? String(error);
const printable = (value: unknown) => JSON.stringify(value, (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2);
const copy = <T,>(value: T): T => structuredClone(value);
const bytesEqual = (left: Uint8Array, right: Uint8Array) => left.length === right.length && left.every((value, index) => value === right[index]);
export class HyperDatabaseDraftBlocked extends Error {
  constructor(public issue: 'changed' | 'unavailable' | 'uncertain') { super(issue); }
}

/** A retained record owns data and immutable mutation arguments, never a component retry callback. */
export class HyperDatabaseDraftController {
  readonly key: string;
  readonly target: HyperDatabaseDraftTarget;
  readonly fieldName: string;
  private listeners = new Set<() => void>();
  private leases = new Set<HyperDatabaseDraftLease>();
  private base: Uint8Array | null = null;
  private mutation: HyperDatabaseDraftMutation | null = null;
  private prepared: MediaFilePB[] = [];
  private readVersion = 0;
  private textDirty = false;
  private state: HyperDatabaseDraftState = { value: null, draft: '', forms: {}, dirty: false, saving: false, error: null, issue: null, version: 0, leases: 0 };
  constructor(owner: HyperDatabaseDraftOwner, databaseId: string, rowId: string, field: FieldPB, private changed: () => void = () => {}) {
    this.target = { owner, databaseId, rowId, fieldId: field.id, fieldType: field.fieldType, fieldKey: hyperDatabaseDraftFieldKey(field) };
    this.key = JSON.stringify([hyperDatabaseDraftOwnerKey(owner), databaseId, rowId, field.id, this.target.fieldKey]);
    this.fieldName = field.name;
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private set(next: Partial<HyperDatabaseDraftState>) { this.state = { ...this.state, ...next }; this.listeners.forEach(listener => listener()); this.changed(); }
  get pending() { return this.state.dirty || this.state.saving; }
  attach(lease: HyperDatabaseDraftLease) {
    this.leases.add(lease); this.set({ leases: this.leases.size });
    return () => { this.leases.delete(lease); this.set({ leases: this.leases.size }); };
  }
  async load(repository: HyperDatabaseRepository, viewId: string, field: FieldPB) {
    if (this.pending || !this.target.owner.isCurrent()) return;
    const readVersion = ++this.readVersion, version = this.state.version, sourceField = copy(field);
    if (hyperDatabaseDraftFieldKey(sourceField) !== this.target.fieldKey) return;
    try {
      const cell = await repository.cell(viewId, this.target.rowId, this.target.fieldId);
      if (this.pending || this.state.version !== version || readVersion !== this.readVersion || !this.target.owner.isCurrent()) return;
      this.accept(sourceField, cell); this.set({ error: null, issue: null });
    } catch (error) { if (readVersion === this.readVersion && !this.pending && this.target.owner.isCurrent()) this.set({ error: errorMessage(error) }); }
  }
  private accept(field: FieldPB, cell: CellPB) {
    this.base = new Uint8Array(cell.data);
    const value = copy(hyperDecodeCell(field, cell));
    this.set({ value, draft: value.date ?? value.text });
  }
  edit(value: string) {
    if (!this.state.value || !this.target.owner.isCurrent()) return;
    if (!this.state.saving) { this.mutation = null; this.prepared = []; }
    this.textDirty = value !== (this.state.value.date ?? this.state.value.text);
    this.set({ draft: value, dirty: this.textDirty || Object.keys(this.state.forms).length > 0 || !!this.mutation, version: this.state.version + 1 });
  }
  form(key: string, fallback: string) { return this.state.forms[key] ?? fallback; }
  editForm(key: string, value: string, fallback = '') {
    if (!this.state.value || !this.target.owner.isCurrent()) return;
    const forms = { ...this.state.forms };
    if (value === fallback) delete forms[key]; else forms[key] = value;
    if (!this.state.saving) { this.mutation = null; this.prepared = []; }
    this.set({ forms, dirty: Object.keys(forms).length > 0 || this.textDirty || !!this.mutation, version: this.state.version + 1 });
  }
  private check(lease: HyperDatabaseDraftLease, attached: boolean) {
    if (!this.target.owner.isCurrent() || !lease.current() || attached && !this.leases.has(lease)) throw new HyperDatabaseDraftBlocked('unavailable');
  }
  private async validate(lease: HyperDatabaseDraftLease, attached: boolean) {
    this.check(lease, attached);
    const latest = await lease.read(this.target);
    this.check(lease, attached);
    if (hyperDatabaseDraftFieldKey(latest.field) !== this.target.fieldKey || !this.base || !bytesEqual(this.base, latest.cell.data)) throw new HyperDatabaseDraftBlocked('changed');
    return latest;
  }
  async saveText(lease: HyperDatabaseDraftLease, attached = true) {
    const method = this.state.value?.date !== undefined ? 'updateDate' : 'updateText';
    return this.runMutation(lease, { method, args: [lease.viewId, this.target.rowId, this.target.fieldId, this.state.draft] }, attached);
  }
  async runMutation(lease: HyperDatabaseDraftLease, mutation: HyperDatabaseDraftMutation, attached = true) {
    if (this.state.saving || this.state.issue === 'uncertain') return false;
    this.mutation = copy(mutation); this.prepared = [];
    const captured = copy(mutation);
    return this.perform(lease, attached, async () => { await this.commit(lease, captured, attached); });
  }
  /** The callback is used once for existing child interfaces and is never retained for retry. */
  async run(lease: HyperDatabaseDraftLease, operation: () => Promise<void>) {
    if (this.state.saving || this.state.issue === 'uncertain') return false;
    this.mutation = null; this.prepared = [];
    return this.perform(lease, true, operation);
  }
  async commit(lease: HyperDatabaseDraftLease, mutation: HyperDatabaseDraftMutation, attached = true) {
    if (!this.state.saving) throw new HyperDatabaseDraftBlocked('unavailable');
    this.mutation = copy(mutation);
    await this.validate(lease, attached);
    // No compare-and-set exists in the native event. This check cannot exclude a concurrent client write.
    await this.executing!.execute(copy(this.mutation), this.prepared, async () => { await this.validate(lease, attached); }, () => {});
  }
  private async perform(lease: HyperDatabaseDraftLease, attached: boolean, operation: () => Promise<void>) {
    const version = this.state.version;
    this.set({ saving: true, dirty: true, error: null, issue: null });
    let sent = false;
    try {
      await this.validate(lease, attached);
      // execute() marks the point at which an asynchronous native operation may have run.
      const execute = lease.execute;
      const tracked: HyperDatabaseDraftLease = { ...lease, execute: async (mutation, prepared, check) => { await execute(mutation, prepared, check, () => { sent = true; }); } };
      this.executing = tracked;
      await operation();
      this.executing = null;
      this.check(lease, false);
      const field = await lease.read(this.target);
      this.check(lease, false);
      const createdOption = this.mutation?.method === 'createSelectOption' && field.field.fieldType === this.target.fieldType && [FieldType.SingleSelect, FieldType.MultiSelect].includes(field.field.fieldType);
      if (hyperDatabaseDraftFieldKey(field.field) !== this.target.fieldKey && !createdOption) throw new HyperDatabaseDraftBlocked('uncertain');
      const newer = this.state.version !== version;
      this.base = new Uint8Array(field.cell.data);
      const value = copy(hyperDecodeCell(field.field, field.cell));
      const forms = { ...this.state.forms };
      if (!newer && this.mutation) {
        for (const key of this.completedForms(this.mutation)) delete forms[key];
        if (this.mutation.method === 'updateText' || this.mutation.method === 'updateDate') this.textDirty = false;
      }
      this.mutation = null; this.prepared = [];
      this.set({ value, ...(this.textDirty ? {} : { draft: value.date ?? value.text }), forms, dirty: this.textDirty || Object.keys(forms).length > 0, error: null, issue: null });
      this.leases.forEach(current => { if (current.current()) current.saved(); });
      return !newer;
    } catch (error) {
      const issue = sent && (!this.target.owner.isCurrent() || !lease.current() || error instanceof HyperDatabaseDraftBlocked && error.issue === 'unavailable') ? 'uncertain' : error instanceof HyperDatabaseDraftBlocked ? error.issue : null;
      this.set({ dirty: true, issue, error: errorMessage(error) });
      return false;
    } finally { this.executing = null; this.set({ saving: false }); }
  }
  private completedForms(mutation: HyperDatabaseDraftMutation): string[] {
    if (mutation.method === 'updateDateDetails') return Object.keys(this.state.forms).filter(key => key.startsWith('date.'));
    if (mutation.method === 'createSelectOption') return ['newOption'];
    if (mutation.method === 'attachMediaLink') return ['mediaUrl', 'mediaName'];
    if (mutation.method === 'renameMedia') return ['file:' + String(mutation.args[3])];
    if (mutation.method === 'checklist') {
      const changes = mutation.args[3] as { insertTask?: unknown[]; updateTasks?: { id: string }[] };
      return [...(changes.insertTask ? ['newTask'] : []), ...(changes.updateTasks?.map(task => 'task:' + task.id) ?? [])];
    }
    return [];
  }
  private executing: HyperDatabaseDraftLease | null = null;
  async executePrepared(lease: HyperDatabaseDraftLease, mutation: HyperDatabaseDraftMutation) {
    const current = this.executing;
    if (!current || current.viewId !== lease.viewId || current.repository !== lease.repository) throw new HyperDatabaseDraftBlocked('unavailable');
    this.mutation = copy(mutation);
    await this.validate(lease, true);
    await current.execute(copy(mutation), this.prepared, async () => { await this.validate(lease, true); }, () => {});
  }
  async retry(lease: HyperDatabaseDraftLease, attached = false) {
    if (this.state.saving || !this.state.dirty || this.state.issue === 'uncertain' || this.state.issue === 'changed') return false;
    if (!this.mutation) {
      if (Object.keys(this.state.forms).length) return false;
      return this.saveText(lease, attached);
    }
    const mutation = copy(this.mutation);
    // A linked view may recover the same underlying cell, but always uses its current view identifier.
    mutation.args[0] = lease.viewId;
    return this.perform(lease, attached, async () => {
      await this.validate(lease, attached);
      await this.executing!.execute(mutation, this.prepared, async () => { await this.validate(lease, attached); }, () => {});
    });
  }
  get retryable() { return !!this.mutation || !Object.keys(this.state.forms).length; }
  discard() {
    if (this.state.saving || !this.target.owner.isCurrent()) return false;
    this.mutation = null; this.prepared = []; this.textDirty = false;
    this.set({ draft: this.state.value?.date ?? this.state.value?.text ?? '', forms: {}, dirty: false, error: null, issue: null, version: this.state.version + 1 });
    return true;
  }
  copyText() {
    if (!this.target.owner.isCurrent()) return '';
    if (Object.keys(this.state.forms).length) return printable({ value: this.state.draft, inputs: this.state.forms, ...(this.mutation ? { operation: this.mutation } : {}) });
    if (this.mutation && ['updateText', 'updateDate'].includes(this.mutation.method)) return this.textDirty ? this.state.draft : String(this.mutation.args[3] ?? '');
    return this.mutation ? printable(this.mutation) : this.state.draft;
  }
}

export class HyperDatabaseDraftRegistry {
  private entries = new Map<string, HyperDatabaseDraftController>();
  private listeners = new Set<() => void>();
  private revision = 0;
  private cleanupQueued = false;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getSnapshot = () => this.revision;
  private changed = () => {
    this.revision++; this.listeners.forEach(listener => listener());
    if (this.cleanupQueued) return;
    this.cleanupQueued = true;
    queueMicrotask(() => {
      this.cleanupQueued = false;
      let removed = false;
      for (const [key, entry] of this.entries) if (!entry.pending && !entry.getSnapshot().leases) { this.entries.delete(key); removed = true; }
      if (removed) { this.revision++; this.listeners.forEach(listener => listener()); }
    });
  };
  get(owner: HyperDatabaseDraftOwner, databaseId: string, rowId: string, field: FieldPB) {
    const candidate = new HyperDatabaseDraftController(owner, databaseId, rowId, field, this.changed);
    const existing = this.entries.get(candidate.key);
    if (existing) return existing;
    this.entries.set(candidate.key, candidate);
    return candidate;
  }
  release(controller: HyperDatabaseDraftController) {
    queueMicrotask(() => {
      if (!controller.pending && !controller.getSnapshot().leases && this.entries.get(controller.key) === controller) { this.entries.delete(controller.key); this.changed(); }
    });
  }
  pending(owner: HyperDatabaseDraftOwner | null, databaseId: string) {
    if (!owner?.isCurrent()) return [];
    const scope = hyperDatabaseDraftOwnerKey(owner);
    return [...this.entries.values()].filter(entry => entry.pending && entry.target.databaseId === databaseId && hyperDatabaseDraftOwnerKey(entry.target.owner) === scope);
  }
}
export const hyperDatabaseDrafts = new HyperDatabaseDraftRegistry();
