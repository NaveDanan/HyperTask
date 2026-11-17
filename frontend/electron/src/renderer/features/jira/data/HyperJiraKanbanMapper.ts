import { fromBinary } from '@bufbuild/protobuf';
import { unwrap } from '@/backend/dispatch';
import { DatabaseEventGetDatabase, DatabaseEventGetAllRows, DatabaseEventGetFields, DatabaseEventGetDatabaseSetting, DatabaseEventGetGroups, DatabaseEventGetCell,
  DatabaseEventCreateRow, DatabaseEventCreateSelectOption, DatabaseEventInsertOrUpdateSelectOption, DatabaseEventUpdateSelectOptionCell } from '@/backend/events';
import { FieldType } from '@shared/protobuf/hyper-database2/field_entities_pb';
import { OrderObjectPositionTypePB } from '@shared/protobuf/hyper-database2/position_entities_pb';
import { SingleSelectTypeOptionPBSchema, SelectOptionCellDataPBSchema } from '@shared/protobuf/hyper-database2/select_option_entities_pb';
import { HyperBackendJiraDatabaseGateway, JiraDatabaseMapper, type JiraDatabaseGateway, type JiraDbField } from './jira-database-mapper';
import type { JiraConfig } from './models/jira-config';
import { JiraStatusCategory, type JiraIssue } from './models/jira-issue';

export interface HyperJiraKanbanOption { id: string; name: string }
export interface HyperJiraKanbanBoard { fields: JiraDbField[]; groupFieldId: string; options: HyperJiraKanbanOption[] }
export interface HyperJiraKanbanGateway extends JiraDatabaseGateway {
  getBoard(viewId: string): Promise<HyperJiraKanbanBoard>;
  createOption(viewId: string, fieldId: string, name: string): Promise<HyperJiraKanbanOption>;
  createCard(viewId: string, groupId: string, cells: Record<string, string>): Promise<string>;
  setGroup(viewId: string, rowId: string, fieldId: string, optionId: string): Promise<void>;
}
const hyperJiraColumnNames = {
  new: ['To Do', 'Todo', 'Not started', 'Backlog', 'Open', 'New'],
  indeterminate: ['In Progress', 'Doing', 'In process', 'Started', 'Working', 'Active'],
  done: ['Done', 'Completed', 'Complete', 'Closed', 'Resolved', 'Finished'],
};
const hyperJiraNormalizeColumn = (name: string) => name.trim().toLowerCase().replace(/[\s_-]+/g, '');
export function hyperJiraKanbanColumn(category: JiraStatusCategory, options: HyperJiraKanbanOption[]) {
  const names = hyperJiraColumnNames[category === JiraStatusCategory.unknown ? JiraStatusCategory.toDo : category];
  for (const name of names) {
    const option = options.find(o => hyperJiraNormalizeColumn(o.name) === hyperJiraNormalizeColumn(name));
    if (option) return { name: names[0], option };
  }
  return { name: names[0], option: undefined };
}
export interface HyperJiraKanbanRow { id: string; updated: string; link: string }
export function hyperJiraKanbanDecision(issue: JiraIssue, config: JiraConfig, row?: HyperJiraKanbanRow) {
  if (!row) return 'create';
  // The key alone may belong to a hand-made card or another Jira server.
  if (row.link !== config.browseUrl(issue.key)) return 'skip';
  return Date.parse(row.updated) === issue.updated.getTime() ? 'unchanged' : 'update';
}
/** Uses the board's own grouping field; Jira Updated is the durable copy watermark. */
export class HyperJiraKanbanMapper {
  constructor(private readonly gateway?: HyperJiraKanbanGateway) {}
  async sync(viewId: string, config: JiraConfig, issues: JiraIssue[], isCurrent = () => true): Promise<void> {
    const g = this.gateway ?? new HyperBackendJiraKanbanGateway(isCurrent);
    const check = () => { if (!isCurrent()) throw new Error('Jira board copy stopped.'); };
    check();
    const board = await g.getBoard(viewId);
    check();
    if (!board.groupFieldId) return;
    const primary = board.fields.find(f => f.isPrimary && f.isText);
    if (!primary) return;
    const sample = issues[0]; if (!sample) return;
    const fields = new Map<string, string>();
    for (const name of Object.keys(JiraDatabaseMapper.columns(sample, config))) {
      const existing = board.fields.find(f => f.name.toLowerCase() === name.toLowerCase());
      if (existing && !existing.isText) continue;
      check(); fields.set(name, existing?.id ?? (await g.createTextField(viewId, name)).id);
    }
    const keyId = fields.get(JiraDatabaseMapper.keyColumn), updatedId = fields.get(JiraDatabaseMapper.updatedColumn), linkId = fields.get('Jira Link');
    if (!keyId || !updatedId || !linkId) throw new Error('Jira Key, Link and Updated must be text fields.');
    const rows = new Map<string, HyperJiraKanbanRow>();
    for (const id of await g.getRowIds(viewId)) {
      check();
      const key = (await g.getText(viewId, id, keyId)).trim(); if (!key) continue;
      const [updated, link] = await Promise.all([g.getText(viewId, id, updatedId), g.getText(viewId, id, linkId)]);
      if (!rows.has(key) || link === config.browseUrl(key)) rows.set(key, { id, updated, link });
    }
    // Deduplicate even if a transport supplies a repeated key; prefer its newest version.
    const unique = new Map<string, JiraIssue>();
    for (const issue of issues) if (!unique.has(issue.key) || unique.get(issue.key)!.updated < issue.updated) unique.set(issue.key, issue);
    for (const issue of unique.values()) {
      check();
      const row = rows.get(issue.key), decision = hyperJiraKanbanDecision(issue, config, row);
      if (decision === 'skip' || decision === 'unchanged') continue;
      const column = hyperJiraKanbanColumn(issue.statusCategory, board.options);
      let option = column.option;
      if (!option) { check(); option = await g.createOption(viewId, board.groupFieldId, column.name); board.options.push(option); }
      const cells: Record<string, string> = { [primary.id]: issue.summary };
      for (const [name, value] of Object.entries(JiraDatabaseMapper.columns(issue, config))) { const id = fields.get(name); if (id) cells[id] = value; }
      check();
      if (!row) {
        const id = await g.createCard(viewId, option.id, cells);
        rows.set(issue.key, { id, link: cells[linkId], updated: cells[updatedId] });
      } else {
        for (const [fieldId, value] of Object.entries(cells)) {
          if (fieldId === keyId || fieldId === updatedId) continue;
          check(); await g.updateText(viewId, row.id, fieldId, value);
        }
        check(); await g.setGroup(viewId, row.id, board.groupFieldId, option.id);
        // Write last so a partial failure retries the entire changed card next time.
        check(); await g.updateText(viewId, row.id, updatedId, cells[updatedId]);
      }
    }
  }
}
export class HyperBackendJiraKanbanGateway extends HyperBackendJiraDatabaseGateway implements HyperJiraKanbanGateway {
  constructor(private readonly isCurrent = () => true) { super(); }
  private check() { if (!this.isCurrent()) throw new Error('Jira board copy stopped.'); }
  async getBoard(viewId: string): Promise<HyperJiraKanbanBoard> {
    // Initialize the native editor before its metadata calls, as HyperDatabaseController does.
    unwrap(await DatabaseEventGetDatabase({ value: viewId }));
    const [fields, settings, groups] = await Promise.all([DatabaseEventGetFields({ viewId }).then(unwrap),
      DatabaseEventGetDatabaseSetting({ value: viewId }).then(unwrap), DatabaseEventGetGroups({ value: viewId }).then(unwrap)]);
    const fieldId = settings.groupSettings?.items[0]?.fieldId ?? groups.items[0]?.fieldId;
    const grouping = fields.items.find(f => f.id === fieldId && f.fieldType === FieldType.SingleSelect);
    return { fields: fields.items.map(f => ({ id: f.id, name: f.name, isText: f.fieldType === FieldType.RichText, isPrimary: f.isPrimary })),
      groupFieldId: grouping?.id ?? '', options: grouping ? fromBinary(SingleSelectTypeOptionPBSchema, grouping.typeOptionData).options : [] };
  }
  override async getRowIds(viewId: string): Promise<string[]> {
    return unwrap(await DatabaseEventGetAllRows({ value: viewId })).items.map(row => row.id);
  }
  override async getText(viewId: string, rowId: string, fieldId: string): Promise<string> {
    // A failed key read must abort, otherwise the next create could duplicate a card.
    return new TextDecoder().decode(unwrap(await DatabaseEventGetCell({ viewId, rowId, fieldId })).data);
  }
  async createOption(viewId: string, fieldId: string, name: string): Promise<HyperJiraKanbanOption> {
    const option = unwrap(await DatabaseEventCreateSelectOption({ viewId, fieldId, optionName: name }));
    this.check();
    unwrap(await DatabaseEventInsertOrUpdateSelectOption({ viewId, fieldId, items: [option] }));
    return option;
  }
  async createCard(viewId: string, groupId: string, cells: Record<string, string>): Promise<string> {
    return unwrap(await DatabaseEventCreateRow({ viewId, rowPosition: { position: OrderObjectPositionTypePB.End }, oneOfGroupId: { case: 'groupId', value: groupId }, data: cells })).id;
  }
  async setGroup(viewId: string, rowId: string, fieldId: string, optionId: string): Promise<void> {
    const cellIdentifier = { viewId, rowId, fieldId };
    const selected = fromBinary(SelectOptionCellDataPBSchema, unwrap(await DatabaseEventGetCell(cellIdentifier)).data).selectOptions;
    this.check();
    unwrap(await DatabaseEventUpdateSelectOptionCell({ cellIdentifier, insertOptionIds: [optionId], deleteOptionIds: selected.filter(o => o.id !== optionId).map(o => o.id) }));
  }
}
