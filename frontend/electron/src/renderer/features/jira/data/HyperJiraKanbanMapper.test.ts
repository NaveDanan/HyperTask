import { describe, expect, it } from 'vitest';
import { HyperJiraKanbanMapper, hyperJiraKanbanColumn, hyperJiraKanbanDecision, type HyperJiraKanbanGateway } from './HyperJiraKanbanMapper';
import { JiraIssue, JiraStatusCategory } from './models/jira-issue';
import { JiraDatabaseMapper, type JiraDbField } from './jira-database-mapper';
import { issueJson, testConfig } from '../test-utils';

const issue = (key = 'DEMO-1', updated = '2024-06-01T10:00:00Z', category = JiraStatusCategory.toDo) => JiraIssue.fromJson(issueJson(key, { updated, category }));
class HyperKanbanMemoryGateway implements HyperJiraKanbanGateway {
  fields: JiraDbField[] = [{ id: 'title', name: 'Title', isPrimary: true, isText: true }, { id: 'status', name: 'Stage', isText: false }];
  options = [{ id: 'todo', name: 'TO DO' }, { id: 'doing', name: 'Doing' }, { id: 'done', name: 'Done' }];
  rows: Record<string, Record<string, string>> = { manual: { title: 'Human card', status: 'doing', notes: 'Keep' } };
  writes: string[] = []; groupFieldId = 'status'; failGroup = false;
  constructor() { for (const name of Object.keys(JiraDatabaseMapper.columns(issue(), testConfig))) this.fields.push({ id: name, name, isText: true }); }
  async getBoard() { return { fields: this.fields, groupFieldId: this.groupFieldId, options: this.options }; }
  async getFields() { return this.fields; }
  async createTextField(_view: string, name: string) { const field = { id: name, name, isText: true }; this.fields.push(field); this.writes.push('field'); return field; }
  async getRowIds() { return Object.keys(this.rows); }
  async getText(_view: string, row: string, field: string) { return this.rows[row][field] ?? ''; }
  async createRow(_view: string, cells: Record<string, string>) { const id = 'row-' + Object.keys(this.rows).length; this.rows[id] = { ...cells }; this.writes.push('create'); return id; }
  async updateText(_view: string, row: string, field: string, value: string) { this.rows[row][field] = value; this.writes.push(field); }
  async createOption(_view: string, _field: string, name: string) { this.writes.push('option'); return { id: name, name }; }
  async createCard(view: string, group: string, cells: Record<string, string>) { return this.createRow(view, { ...cells, [this.groupFieldId]: group }); }
  async setGroup(_view: string, row: string, field: string, option: string) { if (this.failGroup) throw new Error('board unavailable'); this.rows[row][field] = option; this.writes.push('group'); }
}
describe('Hyper Jira Kanban mapping', () => {
  it.each([
    [JiraStatusCategory.toDo, 'to-do', 'todo'], [JiraStatusCategory.inProgress, 'dOiNg', 'doing'], [JiraStatusCategory.done, 'COMPLETED', 'done'],
  ])('reuses reasonable case-insensitive options for %s', (category, name, id) => {
    expect(hyperJiraKanbanColumn(category, [{ id, name }]).option?.id).toBe(id);
  });
  it('only requests a new canonical option when no match exists, with unknown statuses in To Do', () => {
    expect(hyperJiraKanbanColumn(JiraStatusCategory.inProgress, [{ id: 'x', name: 'Done' }])).toEqual({ name: 'In Progress', option: undefined });
    expect(hyperJiraKanbanColumn(JiraStatusCategory.unknown, []).name).toBe('To Do');
  });
  it('decides by key lookup, source link and normalized updated timestamp', () => {
    const i = issue(), row = { id: 'r', link: testConfig.browseUrl(i.key), updated: '2024-06-01T13:00:00+03:00' };
    expect(hyperJiraKanbanDecision(i, testConfig)).toBe('create');
    expect(hyperJiraKanbanDecision(i, testConfig, row)).toBe('unchanged');
    expect(hyperJiraKanbanDecision(i, testConfig, { ...row, updated: '' })).toBe('update');
    expect(hyperJiraKanbanDecision(i, testConfig, { ...row, link: '' })).toBe('skip');
  });
  it('deduplicates across syncs, mapper restarts and full refresh; preserves dragged cards until Jira changes', async () => {
    const g = new HyperKanbanMemoryGateway(), mapper = new HyperJiraKanbanMapper(g), i = issue();
    await mapper.sync('board', testConfig, [i, i]);
    expect(Object.keys(g.rows)).toHaveLength(2); expect(g.rows['row-1']).toMatchObject({ title: i.summary, status: 'todo', 'Jira Key': i.key, 'Jira Link': testConfig.browseUrl(i.key) });
    g.rows['row-1'].title = 'My title'; g.rows['row-1'].status = 'done'; g.rows['row-1'].notes = 'Keep';
    const before = g.writes.length;
    await new HyperJiraKanbanMapper(g).sync('board', testConfig, [i]); expect(g.writes).toHaveLength(before);
    const changed = issue('DEMO-1', '2024-07-01T10:00:00Z', JiraStatusCategory.inProgress);
    await mapper.sync('board', testConfig, [changed]);
    expect(g.rows['row-1']).toMatchObject({ title: changed.summary, status: 'doing', notes: 'Keep', 'Jira Updated': changed.updated.toISOString() });
    expect(g.writes.at(-1)).toBe('Jira Updated'); expect(g.rows.manual).toEqual({ title: 'Human card', status: 'doing', notes: 'Keep' });
    await mapper.sync('board', testConfig, []); expect(Object.keys(g.rows)).toHaveLength(2);
  });
  it('never edits an unrelated card with a colliding key or adds a duplicate of it', async () => {
    const g = new HyperKanbanMemoryGateway(); g.rows.manual['Jira Key'] = 'DEMO-1';
    const before = structuredClone(g.rows);
    await new HyperJiraKanbanMapper(g).sync('board', testConfig, [issue()]); expect(g.rows).toEqual(before); expect(g.writes).toEqual([]);
  });
  it('creates only missing options and skips unsupported grouping fields', async () => {
    const g = new HyperKanbanMemoryGateway(); g.options = [];
    await new HyperJiraKanbanMapper(g).sync('board', testConfig, [issue(), issue('DEMO-2')]);
    expect(g.writes.filter(w => w === 'option')).toHaveLength(1);
    const skipped = new HyperKanbanMemoryGateway(); skipped.groupFieldId = '';
    await new HyperJiraKanbanMapper(skipped).sync('board', testConfig, [issue()]); expect(skipped.writes).toEqual([]);
  });
  it('keeps the previous timestamp on partial failure so the next sync retries', async () => {
    const g = new HyperKanbanMemoryGateway(), mapper = new HyperJiraKanbanMapper(g), original = issue();
    await mapper.sync('board', testConfig, [original]); g.failGroup = true;
    const changed = issue('DEMO-1', '2024-07-01T10:00:00Z');
    await expect(mapper.sync('board', testConfig, [changed])).rejects.toThrow('board unavailable');
    expect(g.rows['row-1']['Jira Updated']).toBe(original.updated.toISOString());
    g.failGroup = false; await mapper.sync('board', testConfig, [changed]); expect(g.rows['row-1']['Jira Updated']).toBe(changed.updated.toISOString());
    expect(Object.keys(g.rows)).toHaveLength(2);
  });
  it('aborts on a failed key read or a session/workspace change before creating any card', async () => {
    const g = new HyperKanbanMemoryGateway(); g.getText = async () => { throw new Error('read failed'); };
    await expect(new HyperJiraKanbanMapper(g).sync('board', testConfig, [issue()])).rejects.toThrow('read failed'); expect(g.writes).toEqual([]);
    await expect(new HyperJiraKanbanMapper(g).sync('board', testConfig, [issue()], () => false)).rejects.toThrow('stopped'); expect(g.writes).toEqual([]);
  });
});
