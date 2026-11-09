import { DatabaseEventGetFields, DatabaseEventCreateField, DatabaseEventGetDatabase, DatabaseEventGetCell, DatabaseEventCreateRow, DatabaseEventUpdateCell } from '@/backend/events';
import type { FlowyResult } from '@/backend/dispatch';
import { FieldType } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { OrderObjectPositionTypePB } from '@shared/protobuf/flowy-database2/position_entities_pb';
import { JiraConfig } from './models/jira-config';
import { JiraIssue, JiraStatusCategory, jiraStatusCategoryLabels } from './models/jira-issue';
import { JiraNotConfiguredException, JiraServerException, JiraValidationException } from './jira-exception';
export interface JiraDbField { id: string; name: string; isText: boolean; isPrimary?: boolean }
/** Small backend seam for testing mapping without a running Rust core. */
export interface JiraDatabaseGateway {
  getFields(viewId: string): Promise<JiraDbField[]>;
  createTextField(viewId: string, name: string): Promise<JiraDbField>;
  getRowIds(viewId: string): Promise<string[]>;
  getText(viewId: string, rowId: string, fieldId: string): Promise<string>;
  createRow(viewId: string, cells: Record<string, string>): Promise<string>;
  updateText(viewId: string, rowId: string, fieldId: string, text: string): Promise<void>;
}
export interface JiraDatabaseSyncReportInput {
  created?: number; updated?: number; unchanged?: number; createdFields?: string[]; skippedFields?: string[]; duplicateKeys?: string[]; staleKeys?: string[];
}
export class HyperJiraDatabaseSyncReport {
  readonly created: number; readonly updated: number; readonly unchanged: number;
  readonly createdFields: string[]; readonly skippedFields: string[]; readonly duplicateKeys: string[]; readonly staleKeys: string[];
  constructor(i: JiraDatabaseSyncReportInput = {}) {
    this.created = i.created ?? 0; this.updated = i.updated ?? 0; this.unchanged = i.unchanged ?? 0;
    this.createdFields = i.createdFields ?? []; this.skippedFields = i.skippedFields ?? []; this.duplicateKeys = i.duplicateKeys ?? []; this.staleKeys = i.staleKeys ?? [];
  }
  get summary(): string {
    const parts = [this.created + ' created', this.updated + ' updated', this.unchanged + ' unchanged'];
    if (this.createdFields.length) parts.push('added fields: ' + this.createdFields.join(', '));
    if (this.skippedFields.length) parts.push('skipped non-text fields: ' + this.skippedFields.join(', '));
    if (this.duplicateKeys.length) parts.push('duplicate rows for ' + this.duplicateKeys.join(', '));
    if (this.staleKeys.length) parts.push(this.staleKeys.length + ' rows no longer in Jira');
    return parts.join(' · ');
  }
}
export interface JiraDatabaseSyncOptions { viewId: string; config: JiraConfig; issues: JiraIssue[] }
/** One-way mirror: writes mapped text cells only and never deletes rows/fields. */
export class HyperJiraDatabaseMapper {
  static readonly keyColumn = 'Jira Key';
  static readonly updatedColumn = 'Jira Updated';
  constructor(readonly gateway: JiraDatabaseGateway = new HyperBackendJiraDatabaseGateway()) {}
  static columns(i: JiraIssue, c: JiraConfig): Record<string, string> {
    return { 'Jira Key': i.key, 'Jira Status': i.statusName, 'Jira Status Category': jiraStatusCategoryLabels[i.statusCategory],
      'Jira Type': i.issueTypeName, 'Jira Assignee': i.assignee ? i.assigneeLabel : '', 'Jira Priority': i.priorityName,
      'Jira Link': c.browseUrl(i.key), 'Jira Updated': i.updated.toISOString() };
  }
  async sync(o: JiraDatabaseSyncOptions): Promise<HyperJiraDatabaseSyncReport> {
    const { viewId, config, issues } = o, g = this.gateway;
    if (!viewId.trim()) throw new JiraNotConfiguredException('Set a target database view id in Jira settings.');
    const fields = await g.getFields(viewId), byName = new Map<string, JiraDbField>();
    for (const f of fields) if (!byName.has(f.name)) byName.set(f.name, f);
    const primary = fields.find(f => f.isPrimary && f.isText);
    const createdFields: string[] = [], skippedFields: string[] = [], fieldIds = new Map<string, string>();
    const sample = new JiraIssue({ id: '', key: '', summary: '', statusName: '', statusCategory: JiraStatusCategory.unknown, issueTypeName: '', updated: new Date(0) });
    for (const name of Object.keys(HyperJiraDatabaseMapper.columns(sample, config))) {
      const existing = byName.get(name);
      if (!existing) { fieldIds.set(name, (await g.createTextField(viewId, name)).id); createdFields.push(name); }
      else if (existing.isText) fieldIds.set(name, existing.id); else skippedFields.push(name);
    }
    const keyId = fieldIds.get(HyperJiraDatabaseMapper.keyColumn), updatedId = fieldIds.get(HyperJiraDatabaseMapper.updatedColumn);
    if (!keyId || !updatedId) throw new JiraValidationException('The "Jira Key" and "Jira Updated" columns must be text fields.');
    const rowsByKey = new Map<string, string>(), duplicates = new Set<string>();
    for (const row of await g.getRowIds(viewId)) {
      const key = (await g.getText(viewId, row, keyId)).trim(); if (!key) continue;
      if (rowsByKey.has(key)) duplicates.add(key); else rowsByKey.set(key, row);
    }
    let created = 0, updated = 0, unchanged = 0;
    for (const issue of issues) {
      const values = HyperJiraDatabaseMapper.columns(issue, config), cells: Record<string, string> = Object.create(null);
      for (const [name, value] of Object.entries(values)) { const id = fieldIds.get(name); if (id) cells[id] = value; }
      if (primary) cells[primary.id] = issue.summary;
      const row = rowsByKey.get(issue.key);
      if (!row) { rowsByKey.set(issue.key, await g.createRow(viewId, cells)); created++; continue; }
      if (!createdFields.length && await g.getText(viewId, row, updatedId) === values['Jira Updated']) { unchanged++; continue; }
      for (const [id, value] of Object.entries(cells)) {
        if (id !== keyId && await g.getText(viewId, row, id) !== value) await g.updateText(viewId, row, id, value);
      }
      updated++;
    }
    const keys = new Set(issues.map(i => i.key));
    return new HyperJiraDatabaseSyncReport({ created, updated, unchanged, createdFields, skippedFields,
      duplicateKeys: [...duplicates].sort(), staleKeys: [...rowsByKey.keys()].filter(k => !keys.has(k)).sort() });
  }
}
function backendValue<T>(r: FlowyResult<T>): T { if (!r.ok) throw new JiraServerException(r.error.msg); return r.value; }
/** Generated TS events mirror the Flutter backend payloads, including rich-text data. */
export class HyperBackendJiraDatabaseGateway implements JiraDatabaseGateway {
  async getFields(viewId: string): Promise<JiraDbField[]> {
    return backendValue(await DatabaseEventGetFields({ viewId })).items.map(f => ({ id: f.id, name: f.name, isText: f.fieldType === FieldType.RichText, isPrimary: f.isPrimary }));
  }
  async createTextField(viewId: string, name: string): Promise<JiraDbField> {
    const f = backendValue(await DatabaseEventCreateField({ viewId, fieldType: FieldType.RichText, oneOfFieldName: { case: 'fieldName', value: name } }));
    return { id: f.id, name: f.name, isText: true, isPrimary: f.isPrimary };
  }
  async getRowIds(viewId: string): Promise<string[]> { return backendValue(await DatabaseEventGetDatabase({ value: viewId })).rows.map(r => r.id); }
  async getText(viewId: string, rowId: string, fieldId: string): Promise<string> {
    const r = await DatabaseEventGetCell({ viewId, rowId, fieldId });
    return r.ok ? new TextDecoder().decode(r.value.data) : '';
  }
  async createRow(viewId: string, cells: Record<string, string>): Promise<string> {
    return backendValue(await DatabaseEventCreateRow({ viewId, rowPosition: { position: OrderObjectPositionTypePB.End }, data: cells })).id;
  }
  async updateText(viewId: string, rowId: string, fieldId: string, text: string): Promise<void> {
    backendValue(await DatabaseEventUpdateCell({ viewId, rowId, fieldId, cellChangeset: text }));
  }
}
export { HyperJiraDatabaseMapper as JiraDatabaseMapper, HyperJiraDatabaseSyncReport as JiraDatabaseSyncReport, HyperBackendJiraDatabaseGateway as BackendJiraDatabaseGateway };
