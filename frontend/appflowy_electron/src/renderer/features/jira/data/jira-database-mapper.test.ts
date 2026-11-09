import { describe, expect, it, vi } from 'vitest';
import { BackendJiraDatabaseGateway, JiraDatabaseMapper, type JiraDatabaseGateway, type JiraDbField } from './jira-database-mapper';
import { JiraIssue } from './models/jira-issue';
import { JiraNotConfiguredException, JiraServerException, JiraValidationException } from './jira-exception';
import { issueJson, testConfig } from '../test-utils';
import * as events from '@/backend/events';
import { create } from '@bufbuild/protobuf';
import { CellPBSchema } from '@shared/protobuf/flowy-database2/cell_entities_pb';
import { DatabasePBSchema } from '@shared/protobuf/flowy-database2/database_entities_pb';
import { FieldPBSchema, FieldType, RepeatedFieldPBSchema } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { RowMetaPBSchema } from '@shared/protobuf/flowy-database2/row_entities_pb';
import { FlowyErrorSchema } from '@shared/protobuf/flowy-error/errors_pb';
vi.mock('@/backend/events', () => ({ DatabaseEventGetFields: vi.fn(), DatabaseEventCreateField: vi.fn(), DatabaseEventGetDatabase: vi.fn(),
  DatabaseEventGetCell: vi.fn(), DatabaseEventCreateRow: vi.fn(), DatabaseEventUpdateCell: vi.fn() }));
class HyperFakeGateway implements JiraDatabaseGateway {
  rows: Record<string, Record<string, string>> = {};
  writes = 0; fieldCreates = 0; private id = 0;
  constructor(readonly fields: JiraDbField[]) {}
  async getFields(): Promise<JiraDbField[]> { return [...this.fields]; }
  async createTextField(_v: string, name: string): Promise<JiraDbField> {
    this.fieldCreates++; const f = { id: 'f' + this.id++, name, isText: true }; this.fields.push(f); return f;
  }
  async getRowIds(): Promise<string[]> { return Object.keys(this.rows); }
  async getText(_v: string, row: string, field: string): Promise<string> { return this.rows[row]?.[field] ?? ''; }
  async createRow(_v: string, cells: Record<string, string>): Promise<string> { this.writes++; const id = 'r' + this.id++; this.rows[id] = { ...cells }; return id; }
  async updateText(_v: string, row: string, field: string, text: string): Promise<void> { this.writes++; this.rows[row][field] = text; }
  fieldId(name: string): string { return this.fields.find(f => f.name === name)!.id; }
}
const baseFields = (): JiraDbField[] => [{ id: 'title', name: 'Name', isText: true, isPrimary: true }, { id: 'notes', name: 'My notes', isText: true }];
const issues = [JiraIssue.fromJson(issueJson('DEMO-1', { assignee: 'a' })), JiraIssue.fromJson(issueJson('DEMO-2', { category: 'done', status: 'Done' }))];
describe('Flutter database mapper cases', () => {
  it('creates fields/rows once; rerun is a no-op', async () => {
    const g = new HyperFakeGateway(baseFields()), mapper = new JiraDatabaseMapper(g), o = { viewId: 'v', config: testConfig, issues };
    const first = await mapper.sync(o); expect(first.created).toBe(2); expect(first.createdFields).toContain('Jira Key');
    const row = Object.values(g.rows)[0]; expect(row.title).toBe('Summary of DEMO-1'); expect(row[g.fieldId('Jira Link')]).toBe('https://jira.example.com/browse/DEMO-1'); expect(row.notes).toBeUndefined();
    const before = g.writes, second = await mapper.sync(o); expect(second).toMatchObject({ created: 0, unchanged: 2 }); expect(g.writes).toBe(before); expect(g.fieldCreates).toBe(first.createdFields.length);
  });
  it('updates only changed cells and preserves user columns', async () => {
    const g = new HyperFakeGateway(baseFields()), mapper = new JiraDatabaseMapper(g); await mapper.sync({ viewId: 'v', config: testConfig, issues });
    const row = Object.keys(g.rows)[0]; g.rows[row].notes = 'keep me';
    const changed = JiraIssue.fromJson(issueJson('DEMO-1', { assignee: 'a', status: 'In Progress', category: 'indeterminate', updated: '2024-06-01T10:00:00Z' }));
    const before = g.writes, report = await mapper.sync({ viewId: 'v', config: testConfig, issues: [changed, issues[1]] });
    expect(report).toMatchObject({ updated: 1, unchanged: 1 }); expect(g.writes - before).toBe(3); expect(g.rows[row].notes).toBe('keep me'); expect(g.rows[row][g.fieldId('Jira Status')]).toBe('In Progress');
  });
  it('skips non-text fields and reports duplicate/stale keys without deleting', async () => {
    const g = new HyperFakeGateway([...baseFields(), { id: 'st', name: 'Jira Status', isText: false }]), mapper = new JiraDatabaseMapper(g);
    await mapper.sync({ viewId: 'v', config: testConfig, issues });
    const id = g.fieldId('Jira Key'); g.rows.dup = { [id]: 'DEMO-1' }; g.rows.old = { [id]: 'DEMO-0' };
    const report = await mapper.sync({ viewId: 'v', config: testConfig, issues });
    expect(report.skippedFields).toEqual(['Jira Status']); expect(report.duplicateKeys).toEqual(['DEMO-1']); expect(report.staleKeys).toEqual(['DEMO-0']);
    expect(g.rows.old).toBeDefined(); expect(Object.values(g.rows).some(r => 'st' in r)).toBe(false);
  });
  it('requires target view and text key/timestamp columns', async () => {
    await expect(new JiraDatabaseMapper(new HyperFakeGateway([])).sync({ viewId: '', config: testConfig, issues })).rejects.toBeInstanceOf(JiraNotConfiguredException);
    await expect(new JiraDatabaseMapper(new HyperFakeGateway([{ id: 'k', name: 'Jira Key', isText: false }])).sync({ viewId: 'v', config: testConfig, issues })).rejects.toBeInstanceOf(JiraValidationException);
  });
  it('fills newly added mapped columns even when timestamps match', async () => {
    const g = new HyperFakeGateway(baseFields()), mapper = new JiraDatabaseMapper(g);
    await mapper.sync({ viewId: 'v', config: testConfig, issues }); const id = g.fieldId('Jira Priority');
    g.fields.splice(g.fields.findIndex(f => f.id === id), 1);
    const report = await mapper.sync({ viewId: 'v', config: testConfig, issues });
    expect(report.updated).toBe(2); expect(Object.values(g.rows)[0][g.fieldId('Jira Priority')]).toBe('Medium');
  });
});
describe('generated backend gateway', () => {
  it('uses matching protobuf payloads and decodes UTF-8 text', async () => {
    vi.mocked(events.DatabaseEventGetFields).mockResolvedValue({ ok: true, value: create(RepeatedFieldPBSchema, { items: [{ id: 'title', name: 'Name', fieldType: FieldType.RichText, isPrimary: true }] }) });
    vi.mocked(events.DatabaseEventCreateField).mockResolvedValue({ ok: true, value: create(FieldPBSchema, { id: 'f', name: 'Jira Key' }) });
    vi.mocked(events.DatabaseEventGetDatabase).mockResolvedValue({ ok: true, value: create(DatabasePBSchema, { rows: [{ id: 'r' }] }) });
    vi.mocked(events.DatabaseEventGetCell).mockResolvedValue({ ok: true, value: create(CellPBSchema, { data: new TextEncoder().encode('שלום') }) });
    vi.mocked(events.DatabaseEventCreateRow).mockResolvedValue({ ok: true, value: create(RowMetaPBSchema, { id: 'r2' }) });
    vi.mocked(events.DatabaseEventUpdateCell).mockResolvedValue({ ok: true, value: undefined });
    const g = new BackendJiraDatabaseGateway();
    expect((await g.getFields('v'))[0]).toMatchObject({ isPrimary: true, isText: true });
    expect(await g.createTextField('v', 'Jira Key')).toMatchObject({ id: 'f' });
    expect(events.DatabaseEventCreateField).toHaveBeenCalledWith({ viewId: 'v', fieldType: FieldType.RichText, oneOfFieldName: { case: 'fieldName', value: 'Jira Key' } });
    expect(await g.getRowIds('v')).toEqual(['r']); expect(events.DatabaseEventGetDatabase).toHaveBeenCalledWith({ value: 'v' });
    expect(await g.getText('v', 'r', 'f')).toBe('שלום');
    expect(await g.createRow('v', { f: 'DEMO-1' })).toBe('r2'); expect(events.DatabaseEventCreateRow).toHaveBeenCalledWith({ viewId: 'v', rowPosition: { position: 0 }, data: { f: 'DEMO-1' } });
    await g.updateText('v', 'r', 'f', 'new'); expect(events.DatabaseEventUpdateCell).toHaveBeenCalledWith({ viewId: 'v', rowId: 'r', fieldId: 'f', cellChangeset: 'new' });
  });
  it('maps backend errors and preserves Dart empty-cell fallback', async () => {
    const failure = { ok: false as const, error: create(FlowyErrorSchema, { msg: 'backend failure' }) };
    vi.mocked(events.DatabaseEventGetFields).mockResolvedValue(failure); vi.mocked(events.DatabaseEventGetCell).mockResolvedValue(failure);
    const g = new BackendJiraDatabaseGateway(); await expect(g.getFields('v')).rejects.toBeInstanceOf(JiraServerException); expect(await g.getText('v', 'r', 'f')).toBe('');
  });
});
