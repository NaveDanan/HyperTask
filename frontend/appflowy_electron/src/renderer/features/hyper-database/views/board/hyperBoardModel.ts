import { FieldType } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { FieldVisibility } from '@shared/protobuf/flowy-database2/field_settings_entities_pb';
import { OrderObjectPositionTypePB } from '@shared/protobuf/flowy-database2/position_entities_pb';
import type { KanbanCommitMeta } from '@/components/reui/kanban';
import type { HyperDatabaseController } from '../../HyperDatabaseController';
import type { HyperDatabaseState, HyperField, HyperGroup } from '../../HyperDatabaseTypes';

export type HyperBoardValue = Record<string, string[]>;
export function hyperBoardGroupFields(fields: HyperField[]) {
  return fields.filter(field => field.type === FieldType.SingleSelect || field.type === FieldType.Checkbox);
}
export function hyperBoardGroupField(state: HyperDatabaseState) {
  const id = state.settings?.groupSettings?.items[0]?.fieldId ?? state.groups[0]?.fieldId;
  return hyperBoardGroupFields(state.fields).find(field => field.id === id);
}
export function hyperBoardGroupName(group: HyperGroup, checkbox = false) {
  if (checkbox) return group.groupId === 'Yes' ? 'Checked' : 'Unchecked';
  return group.isDefault ? 'No status' : group.name;
}
export function hyperBoardOrderedGroups(groups: HyperGroup[]) {
  return [...groups.filter(group => group.isDefault), ...groups.filter(group => !group.isDefault)];
}
export function hyperBoardFieldsInitialized(state: HyperDatabaseState) {
  try { return JSON.parse(state.view?.oneOfExtra.value ?? '{}').hyper_board_card_fields_initialized === true; }
  catch { return false; }
}
export function hyperBoardDefaultFields(fields: HyperField[]) {
  const date = fields.find(field => field.type === FieldType.DateTime)?.id;
  const checklist = fields.find(field => field.type === FieldType.Checklist)?.id;
  return fields.filter(field => field.isPrimary || field.type === FieldType.SingleSelect || field.type === FieldType.MultiSelect || field.id === date || field.id === checklist);
}
export function hyperBoardVisibleFields(state: HyperDatabaseState) {
  return hyperBoardFieldsInitialized(state)
    ? state.fields.filter(field => field.isPrimary || field.settings.visibility !== FieldVisibility.AlwaysHidden)
    : hyperBoardDefaultFields(state.fields);
}
export function hyperBoardMatches(state: HyperDatabaseState, rowId: string, query: string) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return state.fields.some(field => {
    const cell = state.cells[rowId]?.[field.id];
    if (field.isPrimary) return cell?.display.toLocaleLowerCase().includes(needle);
    return (cell?.kind === 'singleSelect' || cell?.kind === 'multiSelect') && cell.selected.some(option => option.name.toLocaleLowerCase().includes(needle));
  });
}
export function hyperBoardValue(state: HyperDatabaseState, query = '', excluded = new Set<string>(), hideEmpty = false): HyperBoardValue {
  const allowedRows = new Set(state.rowIds);
  const entries = hyperBoardOrderedGroups(state.groups).flatMap(group => {
    if (!group.isVisible || excluded.has(group.groupId)) return [];
    const rows = group.rows.filter(row => allowedRows.has(row.id)).map(row => row.id).filter(id => hyperBoardMatches(state, id, query));
    return hideEmpty && !rows.length ? [] : [[group.groupId, rows] as const];
  });
  return Object.fromEntries(entries);
}
export function hyperBoardTitle(state: HyperDatabaseState, rowId: string) {
  const primary = state.fields.find(field => field.isPrimary);
  return primary ? state.cells[rowId]?.[primary.id]?.display ?? '' : '';
}
export function hyperBoardCreateOptions(state: HyperDatabaseState, groupId: string, title: string, top = false) {
  const primary = state.fields.find(field => field.isPrimary);
  return {
    oneOfGroupId: { case: 'groupId' as const, value: groupId },
    data: primary ? { [primary.id]: title } : {},
    rowPosition: { position: top ? OrderObjectPositionTypePB.Start : OrderObjectPositionTypePB.End },
  };
}
/** Core MoveGroupRow targets an existing order slot. Normalize before-next placement after refresh. */
export async function hyperBoardPersistMove(controller: Pick<HyperDatabaseController, 'state' | 'moveGroup' | 'moveRowBetweenGroups' | 'moveRow'>, value: HyperBoardValue, meta: KanbanCommitMeta<string>) {
  if (meta.kind === 'column') {
    const target = controller.state.groups.find(group => group.groupId === meta.overContainer);
    if (target?.isDefault) throw new Error('No status must stay first');
    await controller.moveGroup(meta.activeContainer, meta.overContainer);
    return;
  }
  const rowId = String(meta.event.active.id);
  const nextRow = value[meta.overContainer]?.[meta.overIndex + 1];
  const targetRow = meta.activeContainer === meta.overContainer
    ? meta.previousValue[meta.activeContainer]?.[meta.overIndex]
    : nextRow;
  await controller.moveRowBetweenGroups(rowId, meta.activeContainer, meta.overContainer, targetRow);
  if (nextRow) {
    const rows = controller.state.rowIds;
    if (rows.indexOf(rowId) > rows.indexOf(nextRow)) await controller.moveRow(rowId, nextRow);
  }
}
