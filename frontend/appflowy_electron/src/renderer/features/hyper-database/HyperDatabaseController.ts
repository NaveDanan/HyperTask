import { create, fromBinary, toBinary, type MessageInitShape } from '@bufbuild/protobuf';
import { createStore } from 'zustand/vanilla';
import { unwrap } from '@/backend/dispatch';
import { NotificationSource } from '@/backend/notifications';
import type { SubscribeObject } from '@shared/protobuf/flowy-notification/subject_pb';
import { DatabaseNotification as N } from '@shared/protobuf/flowy-database2/notification_pb';
import { FolderNotification } from '@shared/protobuf/flowy-folder/notification_pb';
import { FieldType, CreateFieldPayloadPBSchema } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { FieldSettingsPBSchema, type FieldSettingsPB } from '@shared/protobuf/flowy-database2/field_settings_entities_pb';
import { RowMetaPBSchema, type RowMetaPB, type RowCoverPB, CreateRowPayloadPBSchema } from '@shared/protobuf/flowy-database2/row_entities_pb';
import { RowsChangePBSchema, RowsVisibilityChangePBSchema, DidFetchRowPBSchema } from '@shared/protobuf/flowy-database2/view_entities_pb';
import { ReorderAllRowsPBSchema, ReorderSingleRowPBSchema } from '@shared/protobuf/flowy-database2/sort_entities_pb';
import { DatabaseLayoutPB, DatabaseSettingChangesetPBSchema, LayoutSettingChangesetPBSchema } from '@shared/protobuf/flowy-database2/setting_entities_pb';
import { CalendarLayoutSettingPBSchema, type CalendarLayoutSettingPB } from '@shared/protobuf/flowy-database2/calendar_entities_pb';
import { SingleSelectTypeOptionPBSchema, type SelectOptionPB } from '@shared/protobuf/flowy-database2/select_option_entities_pb';
import { ViewLayoutPB, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { mergeViewExtra, viewExtra, isDatabaseLayout } from '@/features/view/view-ext';
import { copyHyperFilters } from './HyperFilterCopy';
import { decodeHyperCell, hyperFieldOptions } from './HyperCellCodec';
import { hyperDatabaseBackend, type HyperDatabaseBackend } from './HyperDatabaseBackend';
import type { HyperCell, HyperCellMutation, HyperDatabaseState, HyperField, HyperLayout, HyperCalendarEvent, HyperRow } from './HyperDatabaseTypes';

export const hyperLayout = (view: Pick<ViewPB, 'layout' | 'oneOfExtra'>): HyperLayout =>
  view.layout === ViewLayoutPB.Grid && viewExtra(view)?.hyper_layout === 'gantt' ? 'gantt' : view.layout === ViewLayoutPB.Board ? 'board' : view.layout === ViewLayoutPB.Calendar ? 'calendar' : 'grid';
export const hyperCoreLayout = (layout: HyperLayout) => layout === 'board' ? ViewLayoutPB.Board : layout === 'calendar' ? ViewLayoutPB.Calendar : ViewLayoutPB.Grid;
const message = (error: unknown) => error instanceof Error ? error.message : error && typeof error === 'object' && 'msg' in error ? String(error.msg) : String(error);
const normalizeRow = (meta: RowMetaPB): HyperRow => ({ id: meta.id, icon: meta.oneOfIcon.value ?? null, cover: meta.oneOfCover.value ?? null, documentId: meta.oneOfDocumentId.value ?? null, isDocumentEmpty: meta.oneOfIsDocumentEmpty.value ?? true, meta });
// ID-only RowOrder snapshots must not clear hydrated metadata. Full notifications can clear it.
const snapshotRow = (meta: RowMetaPB, previous?: HyperRow): HyperRow =>
  previous && meta.oneOfDocumentId.case === undefined && meta.oneOfIsDocumentEmpty.case === undefined ? previous : normalizeRow(meta);
const initial = (viewId: string): HyperDatabaseState => ({ status: 'idle', error: null, databaseId: '', viewId, view: null, views: [], fields: [], rowIds: [], rows: {}, cells: {}, groups: [], settings: null, revision: 0, dataRevision: 0 });

/** One controller per mounted database page. Dispose it when the page closes. */
export class HyperDatabaseController {
  readonly store;
  private epoch = 0;
  private stop?: () => void;
  private timer?: ReturnType<typeof setTimeout>;
  private refreshRunning?: Promise<void>;
  private refreshAgain = false;
  private viewRefreshRunning?: Promise<void>;
  private viewRefreshAgain = false;
  private dirtyCells = new Set<string>();
  private versions = new Map<string, number>();
  private pendingCells = new Map<string, { epoch: number; version: number; promise: Promise<HyperCell | undefined> }>();
  private rowOrderPatches?: Array<(ids: string[]) => string[]>;
  private extraQueue: Promise<unknown> = Promise.resolve();
  private extraVersion = 0;
  private queue: Array<() => void> = [];
  private active = 0;
  private viewIds = new Map<string, string>();
  private cachedKeys = new Map<string, true>();
  constructor(readonly viewId: string, private backend: HyperDatabaseBackend = hyperDatabaseBackend, private options = { batchSize: 50, concurrency: 8, maxCachedCells: 20000 }) {
    if (options.batchSize < 1 || options.concurrency < 1 || options.maxCachedCells < 1) throw new Error('Controller batch, concurrency and cache limits must be positive');
    this.store = createStore<HyperDatabaseState>(() => initial(viewId));
  }
  get state() { return this.store.getState(); }
  private patch(patch: Partial<HyperDatabaseState>) { this.store.setState(s => ({ ...patch, revision: s.revision + 1 })); }
  private async limited<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.options.concurrency) await new Promise<void>(resolve => this.queue.push(resolve));
    this.active++;
    try { return await work(); }
    finally { this.active--; this.queue.shift()?.(); }
  }
  async open() {
    this.stop?.(); this.epoch++;
    this.stop = this.backend.subscribe(subject => this.onNotification(subject));
    this.patch({ status: 'loading', error: null });
    const epoch = this.epoch;
    await this.refreshRunning;
    if (epoch !== this.epoch) return;
    await this.refresh();
    if (this.state.status === 'ready') { await this.viewRefreshRunning; if (epoch === this.epoch) await this.refreshViews(); }
  }
  dispose() {
    this.epoch++; this.stop?.(); this.stop = undefined;
    clearTimeout(this.timer); this.timer = undefined;
    this.dirtyCells.clear(); this.versions.clear(); this.cachedKeys.clear(); this.viewIds.clear();
  }
  /** Coalesced metadata refresh; preserves cached cells whose field schema is unchanged. */
  async refresh(): Promise<void> {
    if (this.refreshRunning) { this.refreshAgain = true; return this.refreshRunning; }
    const epoch = this.epoch;
    const work = async () => {
      do {
        this.refreshAgain = false;
        const orderPatches: Array<(ids: string[]) => string[]> = [];
        this.rowOrderPatches = orderPatches;
        const extraVersion = this.extraVersion;
        try {
          const [database, fields, settings, groups, view] = await Promise.all([
            this.backend.DatabaseEventGetDatabase({ value: this.viewId }).then(unwrap),
            this.backend.DatabaseEventGetFields({ viewId: this.viewId }).then(unwrap),
            this.backend.DatabaseEventGetDatabaseSetting({ value: this.viewId }).then(unwrap),
            this.backend.DatabaseEventGetGroups({ value: this.viewId }).then(unwrap),
            this.backend.views.getView(this.viewId).then(unwrap),
          ]);
          if (epoch !== this.epoch) return;
          const previous = this.state;
          const previousFields = new Map(previous.fields.map(f => [f.id, f]));
          const settingsById = new Map(settings.fieldSettings?.items.map(s => [s.fieldId, s]));
          const fieldMap = new Map(fields.items.map(f => [f.id, f]));
          const orderedFields: HyperField[] = database.fields.flatMap(({ fieldId }) => {
            const proto = fieldMap.get(fieldId); if (!proto) return [];
            return [{ id: proto.id, name: proto.name, type: proto.fieldType, isPrimary: proto.isPrimary, proto, options: hyperFieldOptions(proto), settings: settingsById.get(proto.id) ?? create(FieldSettingsPBSchema, { fieldId: proto.id, width: 180 }) }];
          });
          for (const f of orderedFields) {
            const old = previousFields.get(f.id);
            if (old && (old.type !== f.type || old.proto.typeOptionData.toString() !== f.proto.typeOptionData.toString())) {
              for (const key of this.pendingCells.keys()) if (key.endsWith(`:${f.id}`)) this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
            }
          }
          const rows = Object.fromEntries(database.rows.map(meta => [meta.id, snapshotRow(meta, previous.rows[meta.id])]));
          // Replay ordering and visibility notifications received during the snapshot request.
          if (orderPatches.length) Object.assign(rows, previous.rows);
          const rowIds = orderPatches.reduce((ids, apply) => apply(ids), database.rows.map(r => r.id));
          const cells: HyperDatabaseState['cells'] = {};
          for (const meta of database.rows) {
            const cached = previous.cells[meta.id]; if (!cached) continue;
            const retained = Object.fromEntries(orderedFields.flatMap(f => {
              const old = previousFields.get(f.id);
              const same = old?.type === f.type && old.proto.typeOptionData.toString() === f.proto.typeOptionData.toString();
              return same && cached[f.id] ? [[f.id, cached[f.id]]] : [];
            }));
            if (Object.keys(retained).length) cells[meta.id] = retained;
          }
          const optionMap = new Map(orderedFields.flatMap(f => f.options.map(o => [o.id, o] as const)));
          this.patch({ status: 'ready', error: null, databaseId: database.id, fields: orderedFields, rowIds, rows, cells, settings, view: extraVersion === this.extraVersion ? view : previous.view, groups: groups.items.map(g => ({ ...g, option: optionMap.get(g.groupId), name: optionMap.get(g.groupId)?.name ?? (g.isDefault ? 'No status' : g.groupId) })) });
        } catch (error) { if (epoch === this.epoch) this.patch({ status: 'error', error: message(error) }); }
        finally { if (this.rowOrderPatches === orderPatches) this.rowOrderPatches = undefined; }
      } while (this.refreshAgain && epoch === this.epoch);
      if (epoch === this.epoch && this.state.status === 'ready') void this.loadRows(this.state.rowIds.slice(0, this.options.batchSize));
    };
    this.refreshRunning = work();
    try { await this.refreshRunning; } finally { this.refreshRunning = undefined; }
  }
  async refreshViews(): Promise<void> {
    if (this.viewRefreshRunning) { this.viewRefreshAgain = true; return this.viewRefreshRunning; }
    const work = async () => {
      const epoch = this.epoch;
      do {
      this.viewRefreshAgain = false;
      try {
        const all = unwrap(await this.backend.allViews()).items;
        const flat = new Map<string, ViewPB>();
        const collect = (views: ViewPB[]) => { for (const v of views) { if (flat.has(v.id)) continue; flat.set(v.id, v); collect(v.childViews); } };
        collect(all);
        const candidates = [...flat.values()].filter(v => isDatabaseLayout(v.layout));
        const databaseId = this.state.databaseId;
        const views = await Promise.all(candidates.map(v => this.limited(async () => {
          let id = this.viewIds.get(v.id);
          if (!id) { const result = await this.backend.DatabaseEventGetDatabaseId({ value: v.id }); if (!result.ok) return null; id = result.value.value; if (epoch !== this.epoch) return null; this.viewIds.set(v.id, id); }
          return id === databaseId ? v : null;
        })));
        const matching = views.filter((v): v is ViewPB => v !== null);
        const root = matching.find(view => !matching.some(parent => parent.id === view.parentViewId));
        if (root) {
          const rootView = unwrap(await this.backend.views.getView(root.id));
          const order = new Map([root.id, ...rootView.childViews.map(view => view.id)].map((id, index) => [id, index]));
          matching.sort((a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id));
        }
        if (epoch === this.epoch) this.patch({ views: matching });
      } catch (error) { if (epoch === this.epoch) this.patch({ error: message(error) }); }
      } while (this.viewRefreshAgain && epoch === this.epoch);
    };
    this.viewRefreshRunning = work();
    try { await this.viewRefreshRunning; } finally { this.viewRefreshRunning = undefined; }
  }
  /** Load only rows/fields a view needs. Deduplicated, bounded concurrency, bounded cache. */
  async loadRows(rowIds: readonly string[], fieldIds: readonly string[] = this.state.fields.map(f => f.id)) {
    for (let index = 0; index < rowIds.length; index += this.options.batchSize) {
      await Promise.all(rowIds.slice(index, index + this.options.batchSize).flatMap(row => fieldIds.map(field => this.loadCell(row, field))));
    }
  }
  /** Finite scans retain requested values independently of the bounded viewport cache. */
  async scanRows(rowIds: readonly string[], fieldIds: readonly string[], active: () => boolean = () => true): Promise<HyperDatabaseState['cells']> {
    const cells: HyperDatabaseState['cells'] = {};
    for (let index = 0; index < rowIds.length && active(); index += this.options.batchSize) {
      await Promise.all(rowIds.slice(index, index + this.options.batchSize).map(async rowId => {
        const values = await Promise.all(fieldIds.map(async fieldId => [fieldId, await this.loadCell(rowId, fieldId)] as const));
        if (active()) cells[rowId] = Object.fromEntries(values.filter((entry): entry is readonly [string, HyperCell] => entry[1] !== undefined));
      }));
    }
    return cells;
  }
  async loadRowMeta(rowId: string) {
    const epoch = this.epoch;
    const meta = unwrap(await this.backend.DatabaseEventGetRowMeta({ viewId: this.viewId, rowId }));
    if (epoch === this.epoch && this.state.rows[rowId]) this.patch({ rows: { ...this.state.rows, [rowId]: normalizeRow(meta) } });
  }
  async loadCell(rowId: string, fieldId: string, force = false): Promise<HyperCell | undefined> {
    const key = `${rowId}:${fieldId}`;
    const epoch = this.epoch;
    if (force) {
      this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
      if (this.state.cells[rowId]?.[fieldId]) {
        const cells = { ...this.state.cells, [rowId]: { ...this.state.cells[rowId] } };
        delete cells[rowId][fieldId]; this.cachedKeys.delete(key); this.patch({ cells });
      }
    }
    const pending = this.pendingCells.get(key);
    if (pending) {
      const cell = await pending.promise;
      if (epoch !== this.epoch) return;
      if (pending.epoch !== epoch || pending.version !== (this.versions.get(key) ?? 0)) return this.loadCell(rowId, fieldId);
      return cell;
    }
    if (!force && this.state.cells[rowId]?.[fieldId] && !this.state.cells[rowId][fieldId].error) return this.state.cells[rowId][fieldId];
    const version = this.versions.get(key) ?? 0;
    const promise = this.limited(async () => {
      const field = this.state.fields.find(f => f.id === fieldId);
      if (!field || !this.state.rows[rowId] || epoch !== this.epoch) return;
      const result = await this.backend.DatabaseEventGetCell({ viewId: this.viewId, rowId, fieldId }).catch(error => ({ ok: false as const, error }));
      if (epoch !== this.epoch || version !== (this.versions.get(key) ?? 0) || !this.state.rows[rowId]) return;
      const cell = result.ok ? decodeHyperCell(result.value, field.proto) : { ...decodeHyperCell({ $typeName: 'CellPB', rowId, fieldId, data: new Uint8Array(), oneOfFieldType: { case: undefined } }, field.proto), error: message(result.error) };
      const cells = { ...this.state.cells, [rowId]: { ...this.state.cells[rowId], [fieldId]: cell } };
      this.cachedKeys.delete(key); this.cachedKeys.set(key, true);
      while (this.cachedKeys.size > this.options.maxCachedCells) {
        const oldest = this.cachedKeys.keys().next().value!; this.cachedKeys.delete(oldest);
        const split = oldest.lastIndexOf(':'); const row = oldest.slice(0, split); const f = oldest.slice(split + 1);
        if (cells[row]) { cells[row] = { ...cells[row] }; delete cells[row][f]; }
      }
      this.patch({ cells });
      return cell;
    });
    const request = { epoch, version, promise };
    this.pendingCells.set(key, request);
    let cell: HyperCell | undefined;
    try { cell = await promise; } finally { if (this.pendingCells.get(key) === request) this.pendingCells.delete(key); }
    // A live invalidation may reject this generation while a scan is awaiting it.
    // Retry that generation, but never retry errors or work invalidated by disposal.
    if (epoch === this.epoch && version !== (this.versions.get(key) ?? 0) && this.state.rows[rowId] && this.state.fields.some(f => f.id === fieldId)) return this.loadCell(rowId, fieldId);
    return cell;
  }
  private scheduleRefresh() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.refresh(); }, 24);
  }
  private invalidateCell(rowId: string, fieldId: string) {
    if (!this.state.rows[rowId] || !this.state.fields.some(f => f.id === fieldId)) return;
    const key = `${rowId}:${fieldId}`;
    this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
    const hadCell = Boolean(this.state.cells[rowId]?.[fieldId] || this.pendingCells.has(key));
    const cells = { ...this.state.cells, [rowId]: { ...this.state.cells[rowId] } };
    delete cells[rowId][fieldId]; this.cachedKeys.delete(key);
    this.patch({ cells, dataRevision: this.state.dataRevision + 1 });
    if (!hadCell) return;
    this.dirtyCells.add(key);
    queueMicrotask(() => {
      if (!this.dirtyCells.delete(key)) return;
      void this.loadCell(rowId, fieldId, true);
    });
  }
  /** Public for replay fixtures; the adapter supplies unmodified SubscribeObject messages. */
  onNotification(subject: SubscribeObject) {
    if (subject.oneOfError.case === 'error') return;
    if (subject.source === NotificationSource.Folder) {
      if ([FolderNotification.DidUpdateView, FolderNotification.DidUpdateChildViews, FolderNotification.DidMoveViewToTrash, FolderNotification.DidDeleteView, FolderNotification.DidRestoreView].includes(subject.ty)) void this.refreshViews();
      if (subject.id === this.viewId && subject.ty === FolderNotification.DidUpdateView) this.scheduleRefresh();
      return;
    }
    if (subject.source !== NotificationSource.Database) return;
    const bytes = subject.oneOfPayload.value ?? new Uint8Array();
    const state = this.state;
    try {
      if (subject.ty === N.DidUpdateCell) {
        const split = subject.id.lastIndexOf(':');
        if (split >= 0) this.invalidateCell(subject.id.slice(0, split), subject.id.slice(split + 1));
        return;
      }
      if (subject.ty === N.DidUpdateRowMeta && state.rows[subject.id]) {
        const meta = fromBinary(RowMetaPBSchema, bytes); this.patch({ rows: { ...state.rows, [meta.id]: normalizeRow(meta) } }); this.scheduleRefresh(); return;
      }
      if (subject.ty === N.DidUpdateField && state.fields.some(f => f.id === subject.id)) { this.scheduleRefresh(); return; }
      if (subject.ty === N.DidUpdateGroupRow && state.groups.some(g => g.groupId === subject.id)) { this.scheduleRefresh(); return; }
      if (subject.ty === N.DidFetchRow && state.rows[subject.id]) {
        const row = fromBinary(DidFetchRowPBSchema, bytes); if (row.meta) this.patch({ rows: { ...state.rows, [row.rowId]: normalizeRow(row.meta) } }); return;
      }
      if (subject.id !== this.viewId && subject.id !== state.databaseId) return;
      switch (subject.ty) {
        case N.DidUpdateRow: {
          const update = fromBinary(RowsChangePBSchema, bytes);
          const removed = new Set(update.deletedRows); const rows = { ...state.rows }; const cells = { ...state.cells };
          let rowIds = state.rowIds.filter(id => !removed.has(id));
          for (const id of removed) { delete rows[id]; delete cells[id]; }
          for (const entry of update.insertedRows) {
            const meta = entry.rowMeta; if (!meta || entry.isHiddenInView) continue;
            rowIds = rowIds.filter(id => id !== meta.id); rowIds.splice(entry.oneOfIndex.value ?? rowIds.length, 0, meta.id); rows[meta.id] = normalizeRow(meta);
          }
          const invalidated: Array<[string, string]> = [];
          for (const entry of update.updatedRows) {
            if (entry.oneOfRowMeta.case === 'rowMeta') rows[entry.rowId] = normalizeRow(entry.oneOfRowMeta.value);
            for (const fieldId of entry.fieldIds) invalidated.push([entry.rowId, fieldId]);
          }
          this.patch({ rows, rowIds, cells });
          for (const [rowId, fieldId] of invalidated) this.invalidateCell(rowId, fieldId);
          this.scheduleRefresh(); break;
        }
        case N.DidReorderRows: {
          const ids = fromBinary(ReorderAllRowsPBSchema, bytes).rowOrders;
          this.rowOrderPatches?.push(() => ids.filter(id => !!this.state.rows[id]));
          this.patch({ rowIds: ids.filter(id => !!state.rows[id]) }); break;
        }
        case N.DidReorderSingleRow: {
          const change = fromBinary(ReorderSingleRowPBSchema, bytes); const ids = state.rowIds.filter(id => id !== change.rowId);
          if (state.rows[change.rowId]) ids.splice(change.newIndex, 0, change.rowId);
          this.rowOrderPatches?.push(order => { const next = order.filter(id => id !== change.rowId); if (this.state.rows[change.rowId]) next.splice(change.newIndex, 0, change.rowId); return next; });
          this.patch({ rowIds: ids }); break;
        }
        case N.DidFetchRow: {
          const row = fromBinary(DidFetchRowPBSchema, bytes); if (row.meta) this.patch({ rows: { ...state.rows, [row.rowId]: normalizeRow(row.meta) } }); break;
        }
        case N.DidUpdateViewRowsVisibility: {
          const change = fromBinary(RowsVisibilityChangePBSchema, bytes); const hidden = new Set(change.invisibleRows);
          const ids = state.rowIds.filter(id => !hidden.has(id)); const rows = { ...state.rows };
          for (const item of change.visibleRows) if (item.rowMeta) { const id = item.rowMeta.id; if (!ids.includes(id)) ids.splice(item.oneOfIndex.value ?? ids.length, 0, id); rows[id] = snapshotRow(item.rowMeta, rows[id]); }
          this.rowOrderPatches?.push(order => {
            const next = order.filter(id => !hidden.has(id));
            for (const item of change.visibleRows) if (item.rowMeta && !next.includes(item.rowMeta.id)) next.splice(item.oneOfIndex.value ?? next.length, 0, item.rowMeta.id);
            return next;
          });
          this.patch({ rowIds: ids, rows }); break;
        }
        case N.DidUpdateFields: case N.DidUpdateNumOfGroups: case N.DidGroupByField:
        case N.DidUpdateFilter: case N.DidUpdateSort: case N.DidUpdateSettings:
        case N.DidUpdateLayoutSettings: case N.DidUpdateDatabaseLayout: case N.DidUpdateFieldSettings:
          this.scheduleRefresh(); break;
      }
    } catch (error) { this.patch({ error: `Database notification: ${message(error)}` }); this.scheduleRefresh(); }
  }
  private async mutate<T>(work: Promise<T>): Promise<T> { const value = await work; await this.refresh(); return value; }
  createRow(options: Omit<MessageInitShape<typeof CreateRowPayloadPBSchema>, 'viewId' | '$typeName'> = {}) { return this.mutate(this.backend.DatabaseEventCreateRow(create(CreateRowPayloadPBSchema, { ...options, viewId: this.viewId })).then(unwrap)); }
  duplicateRow(rowId: string) { return this.mutate(this.backend.DatabaseEventDuplicateRow({ viewId: this.viewId, rowId }).then(unwrap)); }
  deleteRows(rowIds: string[]) { return this.mutate(this.backend.DatabaseEventDeleteRows({ viewId: this.viewId, rowIds }).then(unwrap)); }
  moveRow(fromRowId: string, toRowId: string) { return this.mutate(this.backend.DatabaseEventMoveRow({ viewId: this.viewId, fromRowId, toRowId }).then(unwrap)); }
  createField(name: string, fieldType: FieldType, options: Omit<MessageInitShape<typeof CreateFieldPayloadPBSchema>, 'viewId' | 'fieldType' | 'oneOfFieldName' | '$typeName'> = {}) {
    return this.mutate(this.backend.DatabaseEventCreateField(create(CreateFieldPayloadPBSchema, { ...options, viewId: this.viewId, fieldType, oneOfFieldName: { case: 'fieldName', value: name } })).then(unwrap));
  }
  renameField(fieldId: string, name: string) { return this.mutate(this.backend.DatabaseEventUpdateField({ viewId: this.viewId, fieldId, oneOfName: { case: 'name', value: name } }).then(unwrap)); }
  deleteField(fieldId: string) { return this.mutate(this.backend.DatabaseEventDeleteField({ viewId: this.viewId, fieldId }).then(unwrap)); }
  duplicateField(fieldId: string) { return this.mutate(this.backend.DatabaseEventDuplicateField({ viewId: this.viewId, fieldId }).then(unwrap)); }
  moveField(fromFieldId: string, toFieldId: string) { return this.mutate(this.backend.DatabaseEventMoveField({ viewId: this.viewId, fromFieldId, toFieldId }).then(unwrap)); }
  changeFieldType(fieldId: string, fieldType: FieldType) { return this.mutate(this.backend.DatabaseEventUpdateFieldType({ viewId: this.viewId, fieldId, fieldType }).then(unwrap)); }
  updateFieldTypeOptions(fieldId: string, typeOptionData: Uint8Array) { return this.mutate(this.backend.DatabaseEventUpdateFieldTypeOption({ viewId: this.viewId, fieldId, typeOptionData }).then(unwrap)); }
  updateFieldSettings(fieldId: string, patch: Partial<Pick<FieldSettingsPB, 'width' | 'visibility' | 'wrapCellContent'>>) {
    return this.mutate(this.backend.DatabaseEventUpdateFieldSettings({ viewId: this.viewId, fieldId,
      ...(patch.width !== undefined ? { oneOfWidth: { case: 'width', value: patch.width } as const } : {}),
      ...(patch.visibility !== undefined ? { oneOfVisibility: { case: 'visibility', value: patch.visibility } as const } : {}),
      ...(patch.wrapCellContent !== undefined ? { oneOfWrapCellContent: { case: 'wrapCellContent', value: patch.wrapCellContent } as const } : {}),
    }).then(unwrap));
  }
  async updateCell(rowId: string, fieldId: string, value: HyperCellMutation) {
    const cellId = { viewId: this.viewId, rowId, fieldId };
    const field = this.state.fields.find(f => f.id === fieldId);
    if (!field) throw new Error(`Unknown field ${fieldId}`);
    const kinds: Record<HyperCellMutation['kind'], FieldType> = { text: FieldType.RichText, summary: FieldType.Summary, translate: FieldType.Translate, number: FieldType.Number, url: FieldType.URL, checkbox: FieldType.Checkbox, date: FieldType.DateTime, singleSelect: FieldType.SingleSelect, multiSelect: FieldType.MultiSelect, checklist: FieldType.Checklist, relation: FieldType.Relation, time: FieldType.Time, media: FieldType.Media };
    if (field.type !== kinds[value.kind]) throw new Error(`Cannot write ${value.kind} to ${FieldType[field.type]}`);
    switch (value.kind) {
      case 'date': {
        const previous = await this.loadCell(rowId, fieldId);
        const range = value.isRange ?? (previous?.kind === 'date' && previous.isRange);
        const changesDate = value.timestamp !== undefined || value.endTimestamp !== undefined;
        const timestamp = value.timestamp ?? (range && changesDate && previous?.kind === 'date' ? previous.timestamp ?? value.endTimestamp : undefined);
        const endTimestamp = value.endTimestamp ?? (range && changesDate && previous?.kind === 'date' ? previous.endTimestamp ?? timestamp : undefined);
        unwrap(await this.backend.DatabaseEventUpdateDateCell({ cellId,
        ...(timestamp !== undefined ? { oneOfTimestamp: { case: 'timestamp', value: timestamp } as const } : {}),
        ...(endTimestamp !== undefined ? { oneOfEndTimestamp: { case: 'endTimestamp', value: endTimestamp } as const } : {}),
        ...(value.includeTime !== undefined ? { oneOfIncludeTime: { case: 'includeTime', value: value.includeTime } as const } : {}),
        ...(value.isRange !== undefined ? { oneOfIsRange: { case: 'isRange', value: value.isRange } as const } : {}),
        ...(value.clear !== undefined ? { oneOfClearFlag: { case: 'clearFlag', value: value.clear } as const } : {}),
        ...(value.reminderId !== undefined ? { oneOfReminderId: { case: 'reminderId', value: value.reminderId } as const } : {}),
      })); break;
      }
      case 'singleSelect': case 'multiSelect': unwrap(await this.backend.DatabaseEventUpdateSelectOptionCell({ cellIdentifier: cellId, insertOptionIds: value.insertOptionIds ?? [], deleteOptionIds: value.deleteOptionIds ?? [] })); break;
      case 'checklist': unwrap(await this.backend.DatabaseEventUpdateChecklistCell({ cellId, insertTask: value.insert?.map(item => ({ name: item.name, ...(item.index !== undefined ? { oneOfIndex: { case: 'index', value: item.index } as const } : {}) })), deleteTasks: value.deleteIds, updateTasks: value.update, completedTasks: value.completedIds, reorder: value.reorder })); break;
      case 'relation': unwrap(await this.backend.DatabaseEventUpdateRelationCell({ viewId: this.viewId, cellId, insertedRowIds: value.insertRowIds, removedRowIds: value.deleteRowIds })); break;
      case 'media': unwrap(await this.backend.DatabaseEventUpdateMediaCell({ viewId: this.viewId, cellId, insertedFiles: value.insertFiles, removedIds: value.deleteIds })); break;
      default: {
        const cellChangeset = value.kind === 'checkbox' ? (value.checked ? 'Yes' : 'No') : value.kind === 'number' ? (value.value?.toString() ?? '') : value.kind === 'time' ? (value.seconds?.toString() ?? '') : value.kind === 'url' ? value.url : value.text;
        unwrap(await this.backend.DatabaseEventUpdateCell({ ...cellId, cellChangeset }));
      }
    }
    await this.loadCell(rowId, fieldId, true);
    this.patch({ dataRevision: this.state.dataRevision + 1 });
  }
  async setChecklistItemCompleted(rowId: string, fieldId: string, itemId: string, completed: boolean) {
    const cell = await this.loadCell(rowId, fieldId);
    if (cell?.kind !== 'checklist' || cell.error) throw new Error('Checklist could not be loaded');
    const item = cell.items.find(item => item.id === itemId); if (!item) throw new Error('Checklist item was deleted');
    if (item.completed !== completed) await this.updateCell(rowId, fieldId, { kind: 'checklist', completedIds: [itemId] });
  }
  async createSelectOption(fieldId: string, name: string, rowId = '', color?: SelectOptionPB['color']) {
    let option = unwrap(await this.backend.DatabaseEventCreateSelectOption({ viewId: this.viewId, fieldId, optionName: name }));
    if (color !== undefined) option = { ...option, color };
    unwrap(await this.backend.DatabaseEventInsertOrUpdateSelectOption({ viewId: this.viewId, fieldId, rowId, items: [option] }));
    await this.refresh(); if (rowId) await this.loadCell(rowId, fieldId, true); return option;
  }
  updateSelectOptions(fieldId: string, items: SelectOptionPB[]) { return this.mutate(this.backend.DatabaseEventInsertOrUpdateSelectOption({ viewId: this.viewId, fieldId, items }).then(unwrap)); }
  deleteSelectOptions(fieldId: string, items: SelectOptionPB[]) { return this.mutate(this.backend.DatabaseEventDeleteSelectOption({ viewId: this.viewId, fieldId, items }).then(unwrap)); }
  setGroupByField(fieldId: string, settingContent = new Uint8Array()) { return this.mutate(this.backend.DatabaseEventSetGroupByField({ viewId: this.viewId, fieldId, settingContent }).then(unwrap)); }
  async getGroups() { await this.refresh(); return this.state.groups; }
  moveGroup(fromGroupId: string, toGroupId: string) { return this.mutate(this.backend.DatabaseEventMoveGroup({ viewId: this.viewId, fromGroupId, toGroupId }).then(unwrap)); }
  async moveRowBetweenGroups(rowId: string, fromGroupId: string, toGroupId: string, toRowId?: string) {
    await this.mutate(this.backend.DatabaseEventMoveGroupRow({ viewId: this.viewId, fromRowId: rowId, fromGroupId, toGroupId, ...(toRowId ? { oneOfToRowId: { case: 'toRowId', value: toRowId } as const } : {}) }).then(unwrap));
    for (const f of this.state.fields) if (this.state.cells[rowId]?.[f.id]) await this.loadCell(rowId, f.id, true);
  }
  createGroup(name: string) { const groupConfigId = this.state.settings?.groupSettings?.items[0]?.id ?? ''; return this.mutate(this.backend.DatabaseEventCreateGroup({ viewId: this.viewId, groupConfigId, name }).then(unwrap)); }
  renameGroup(groupId: string, name: string) { return this.mutate(this.backend.DatabaseEventUpdateGroup({ viewId: this.viewId, groupId, oneOfName: { case: 'name', value: name } }).then(unwrap)); }
  hideGroup(groupId: string, hidden = true) { return this.mutate(this.backend.DatabaseEventUpdateGroup({ viewId: this.viewId, groupId, oneOfVisible: { case: 'visible', value: !hidden } }).then(unwrap)); }
  async deleteGroup(groupId: string) {
    const group = this.state.groups.find(g => g.groupId === groupId);
    const field = this.state.fields.find(f => f.id === group?.fieldId);
    const option = field?.options.find(o => o.id === groupId);
    if (!group || group.isDefault || field?.type !== FieldType.SingleSelect || !option) throw new Error('Choose a status option group');
    // Rust DeleteGroup deletes its rows. Removing the option schema instead clears
    // decoded selections across linked views while preserving every card.
    const options = fromBinary(SingleSelectTypeOptionPBSchema, field.proto.typeOptionData);
    options.options = options.options.filter(o => o.id !== groupId);
    await this.updateFieldTypeOptions(field.id, toBinary(SingleSelectTypeOptionPBSchema, options));
  }
  updateSettings(patch: Omit<MessageInitShape<typeof DatabaseSettingChangesetPBSchema>, 'viewId' | '$typeName'>) { return this.mutate(this.backend.DatabaseEventUpdateDatabaseSetting(create(DatabaseSettingChangesetPBSchema, { ...patch, viewId: this.viewId })).then(unwrap)); }
  updateLayoutSettings(patch: Omit<MessageInitShape<typeof LayoutSettingChangesetPBSchema>, 'viewId' | '$typeName'>) { return this.mutate(this.backend.DatabaseEventSetLayoutSetting(create(LayoutSettingChangesetPBSchema, { ...patch, viewId: this.viewId })).then(unwrap)); }
  updateCalendarSettings(patch: Partial<Omit<CalendarLayoutSettingPB, '$typeName'>>) {
    const setting = this.state.settings?.layoutSetting?.oneOfCalendar.value;
    return this.updateLayoutSettings({ layoutType: DatabaseLayoutPB.Calendar, oneOfCalendar: { case: 'calendar', value: create(CalendarLayoutSettingPBSchema, { ...create(CalendarLayoutSettingPBSchema), ...setting, ...patch }) } });
  }
  /** Seconds since epoch; overlapping ranges included. The backend has no range endpoint. */
  async getCalendarEvents(start: bigint, end: bigint, retained?: HyperDatabaseState['cells']): Promise<HyperCalendarEvent[]> {
    const events = unwrap(await this.backend.DatabaseEventGetAllCalendarEvents({ viewId: this.viewId })).items;
    const dateFields = [...new Set(events.map(e => e.dateFieldId))];
    const cells = retained ?? await this.scanRows(events.flatMap(e => e.rowMeta ? [e.rowMeta.id] : []), dateFields);
    return events.flatMap(e => {
      if (!e.rowMeta || e.oneOfTimestamp.case !== 'timestamp') return [];
      const date = cells[e.rowMeta.id]?.[e.dateFieldId];
      const timestamp = e.oneOfTimestamp.value;
      const endTimestamp = date?.kind === 'date' && date.isRange ? date.endTimestamp : null;
      return timestamp < end && (endTimestamp ?? timestamp) >= start ? [{ rowId: e.rowMeta.id, title: e.title, dateFieldId: e.dateFieldId, timestamp, endTimestamp, includeTime: date?.kind === 'date' && date.includeTime, meta: e.rowMeta }] : [];
    });
  }
  async moveCalendarEvent(rowId: string, dateFieldId: string, timestamp: bigint) {
    const previous = await this.loadCell(rowId, dateFieldId);
    if (previous?.kind === 'date' && previous.timestamp !== null && previous.endTimestamp !== null && previous.isRange) {
      // The core's MoveCalendarEvent supplies only a start and silently ignores ranges.
      await this.updateCell(rowId, dateFieldId, { kind: 'date', timestamp, endTimestamp: previous.endTimestamp + timestamp - previous.timestamp, isRange: true });
    } else {
      unwrap(await this.backend.DatabaseEventMoveCalendarEvent({ cellPath: { viewId: this.viewId, rowId, fieldId: dateFieldId }, timestamp }));
      await this.loadCell(rowId, dateFieldId, true);
    }
  }
  async updateRowMeta(rowId: string, patch: { icon?: string; cover?: RowCoverPB | null; isDocumentEmpty?: boolean }) {
    if (patch.cover === null) unwrap(await this.backend.DatabaseEventRemoveCover({ viewId: this.viewId, rowId }));
    unwrap(await this.backend.DatabaseEventUpdateRowMeta({ viewId: this.viewId, id: rowId,
      ...(patch.icon !== undefined ? { oneOfIconUrl: { case: 'iconUrl', value: patch.icon } as const } : {}),
      ...(patch.cover ? { oneOfCover: { case: 'cover', value: patch.cover } as const } : {}),
      ...(patch.isDocumentEmpty !== undefined ? { oneOfIsDocumentEmpty: { case: 'isDocumentEmpty', value: patch.isDocumentEmpty } as const } : {}),
    })); await this.loadRowMeta(rowId); await this.refresh();
  }
  async addView(layout: HyperLayout, name: string) {
    const current = this.state.view; if (!current) throw new Error('Open the database first');
    const root = this.state.views.find(v => !this.state.views.some(p => p.id === v.parentViewId)) ?? current;
    let view = unwrap(await this.backend.views.createView({ parentViewId: root.id, name, layoutType: hyperCoreLayout(layout), ext: { database_id: this.state.databaseId } }));
    if (layout === 'gantt') { const extra = mergeViewExtra(view, { hyper_layout: 'gantt' }); unwrap(await this.backend.views.updateView({ viewId: view.id, extra })); view = { ...view, oneOfExtra: { case: 'extra', value: extra } }; }
    this.viewIds.set(view.id, this.state.databaseId); await this.refreshViews(); return view;
  }
  updateViewExtra(patch: Record<string, unknown>) {
    const run = this.extraQueue.then(async () => {
      const view = this.state.view; if (!view) throw new Error('Open the database first');
      const extra = mergeViewExtra(view, patch);
      const updated = unwrap(await this.backend.views.updateView({ viewId: view.id, extra }));
      // UpdateView can return an empty acknowledgement; retain the known view and merged extra.
      this.extraVersion++;
      this.patch({ view: updated.id ? updated : { ...view, oneOfExtra: { case: 'extra', value: extra } } }); await this.refreshViews();
    });
    this.extraQueue = run.catch(() => undefined);
    return run;
  }
  async renameView(viewId: string, name: string) { unwrap(await this.backend.views.updateView({ viewId, name })); await this.refreshViews(); }
  /** Duplicate view settings within this database, preserving extra keys (including Gantt). */
  async duplicateView(view: ViewPB) {
    const created = await this.addView(hyperLayout(view), `${view.name} (copy)`);
    const extra = mergeViewExtra(created, viewExtra(view) ?? {}); unwrap(await this.backend.views.updateView({ viewId: created.id, extra }));
    const settings = unwrap(await this.backend.DatabaseEventGetDatabaseSetting({ value: view.id }));
    for (const f of settings.fieldSettings?.items ?? []) unwrap(await this.backend.DatabaseEventUpdateFieldSettings({ viewId: created.id, fieldId: f.fieldId, oneOfWidth: { case: 'width', value: f.width }, oneOfVisibility: { case: 'visibility', value: f.visibility }, oneOfWrapCellContent: { case: 'wrapCellContent', value: f.wrapCellContent } }));
    if (settings.layoutSetting) unwrap(await this.backend.DatabaseEventSetLayoutSetting({ viewId: created.id, layoutType: settings.layoutSetting.layoutType, oneOfBoard: settings.layoutSetting.oneOfBoard, oneOfCalendar: settings.layoutSetting.oneOfCalendar }));
    for (const g of settings.groupSettings?.items ?? []) unwrap(await this.backend.DatabaseEventSetGroupByField({ viewId: created.id, fieldId: g.fieldId, settingContent: g.content }));
    await copyHyperFilters(this.backend, created.id, settings.filters?.items ?? []);
    for (const sort of settings.sorts?.items ?? []) unwrap(await this.backend.DatabaseEventUpdateDatabaseSetting({ viewId: created.id, oneOfUpdateSort: { case: 'updateSort', value: { viewId: created.id, fieldId: sort.fieldId, condition: sort.condition } } }));
    await this.refreshViews(); return { ...created, oneOfExtra: { case: 'extra', value: extra } } satisfies ViewPB;
  }
  async deleteView(viewId: string) { unwrap(await this.backend.views.deleteView(viewId)); await this.refreshViews(); }
  async getRelatedRows(databaseId: string, rowIds: string[]) { return unwrap(await this.backend.DatabaseEventGetRelatedRowDatas({ databaseId, rowIds })).rows; }
}
