import { describe, expect, it, vi } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { FieldPBSchema, FieldType } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { FieldSettingsPBSchema, FieldVisibility } from '@shared/protobuf/flowy-database2/field_settings_entities_pb';
import { GroupPBSchema } from '@shared/protobuf/flowy-database2/group_pb';
import { RowMetaPBSchema } from '@shared/protobuf/flowy-database2/row_entities_pb';
import { SelectOptionPBSchema } from '@shared/protobuf/flowy-database2/select_option_entities_pb';
import { ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import type { HyperDatabaseState, HyperField } from '../../HyperDatabaseTypes';
import type { KanbanCommitMeta } from '@/components/reui/kanban';
import { hyperBoardCreateOptions, hyperBoardGroupName, hyperBoardMatches, hyperBoardPersistMove, hyperBoardValue, hyperBoardVisibleFields } from './hyperBoardModel';

function hyperField(id: string, type: FieldType, primary = false): HyperField {
  return { id, name: id, type, isPrimary: primary, proto: create(FieldPBSchema, { id, fieldType: type, isPrimary: primary }), settings: create(FieldSettingsPBSchema), options: [] };
}
function hyperState(): HyperDatabaseState {
  const group = (id: string, rowIds: string[], isDefault = false, isVisible = true) => ({ ...create(GroupPBSchema, { groupId: id, fieldId: 'status', isDefault, isVisible, rows: rowIds.map(id => create(RowMetaPBSchema, { id })) }), name: id });
  return { status: 'ready', error: null, viewId: 'board', databaseId: 'db', view: create(ViewPBSchema), views: [], settings: null, revision: 0, dataRevision: 0,
    fields: [hyperField('title', FieldType.RichText, true), hyperField('status', FieldType.SingleSelect), hyperField('labels', FieldType.MultiSelect), hyperField('date', FieldType.DateTime), hyperField('date2', FieldType.DateTime), hyperField('checklist', FieldType.Checklist), hyperField('estimate', FieldType.Number)],
    rowIds: ['a', 'b', 'c'], rows: {}, cells: {
      a: { title: { kind: 'text', text: 'Ship release', display: 'Ship release' } },
      b: { title: { kind: 'text', text: 'Review docs', display: 'Review docs' }, labels: { kind: 'multiSelect', display: 'Launch', selected: [create(SelectOptionPBSchema, { id: 'launch', name: 'Launch' })], options: [] } },
    }, groups: [group('done', ['c']), group('none', [], true), group('todo', ['a', 'b', 'filtered-out']), group('hidden', ['a'], false, false)] };
}
function hyperMeta(kind: 'item' | 'column', active: string, from: string, to: string, index = 0): KanbanCommitMeta<string> {
  return { kind, activeContainer: from, activeIndex: 0, overContainer: to, overIndex: index, previousValue: { todo: ['a', 'b'], done: ['c'] }, event: {
    active: { id: active, data: { current: undefined }, rect: { current: { initial: null, translated: null } } },
    over: null, delta: { x: 0, y: 0 }, collisions: null, activatorEvent: new Event('pointerup'),
  } };
}
describe('HyperBoard data and mutations', () => {
  it('pins No status, preserves Rust group order and excludes hidden/core-filtered rows', () => {
    expect(hyperBoardValue(hyperState())).toEqual({ none: [], done: ['c'], todo: ['a', 'b'] });
  });
  it('searches title and option names, case-insensitively', () => {
    const state = hyperState();
    expect(hyperBoardMatches(state, 'a', 'SHIP')).toBe(true);
    expect(hyperBoardMatches(state, 'b', 'launch')).toBe(true);
    expect(hyperBoardValue(state, ' launch ')).toEqual({ none: [], done: [], todo: ['b'] });
    expect(hyperBoardMatches(state, 'unloaded', 'launch')).toBe(false);
  });
  it('applies local group filters and hide-empty without mutating core state', () => {
    const state = hyperState();
    expect(hyperBoardValue(state, '', new Set(['todo']), true)).toEqual({ done: ['c'] });
    expect(state.groups.find(group => group.groupId === 'todo')?.isVisible).toBe(true);
  });
  it('defaults to primary, selects, first date and first checklist; honors saved visibility', () => {
    const state = hyperState();
    expect(hyperBoardVisibleFields(state).map(field => field.id)).toEqual(['title', 'status', 'labels', 'date', 'checklist']);
    state.view = create(ViewPBSchema, { oneOfExtra: { case: 'extra', value: '{"hyper_board_card_fields_initialized":true}' } });
    state.fields[1].settings.visibility = FieldVisibility.AlwaysHidden;
    state.fields[0].settings.visibility = FieldVisibility.AlwaysHidden;
    expect(hyperBoardVisibleFields(state).map(field => field.id)).toContain('title');
    expect(hyperBoardVisibleFields(state).map(field => field.id)).not.toContain('status');
    expect(hyperBoardVisibleFields(state).map(field => field.id)).toContain('estimate');
  });
  it('labels checkbox groups using the core Yes/No identifiers', () => {
    const group = hyperState().groups[0];
    expect(hyperBoardGroupName({ ...group, groupId: 'Yes' }, true)).toBe('Checked');
    expect(hyperBoardGroupName({ ...group, groupId: 'No' }, true)).toBe('Unchecked');
  });
  it('creates rows using the group oneof and primary-field changeset', () => {
    expect(hyperBoardCreateOptions(hyperState(), 'todo', 'New task')).toMatchObject({ oneOfGroupId: { case: 'groupId', value: 'todo' }, data: { title: 'New task' }, rowPosition: { position: 0 } });
    expect(hyperBoardCreateOptions(hyperState(), 'todo', '', true).rowPosition.position).toBe(1);
  });
  it('commits a cross-group move and normalizes the refreshed core order when necessary', async () => {
    const state = hyperState(); state.rowIds = ['b', 'c', 'a']; state.groups[0].rows = ['c', 'a'].map(id => create(RowMetaPBSchema, { id }));
    const controller = { state, moveRowBetweenGroups: vi.fn().mockResolvedValue(undefined), moveRow: vi.fn().mockResolvedValue(undefined), moveGroup: vi.fn() };
    await hyperBoardPersistMove(controller, { todo: ['b'], done: ['a', 'c'] }, hyperMeta('item', 'a', 'todo', 'done'));
    expect(controller.moveRowBetweenGroups).toHaveBeenCalledWith('a', 'todo', 'done', 'c');
    expect(controller.moveRow).toHaveBeenCalledWith('a', 'c');
  });
  it('persists a same-group reorder using the original target slot', async () => {
    const state = hyperState(); state.groups[2].rows = ['b', 'a'].map(id => create(RowMetaPBSchema, { id }));
    const controller = { state, moveRowBetweenGroups: vi.fn().mockResolvedValue(undefined), moveRow: vi.fn(), moveGroup: vi.fn() };
    await hyperBoardPersistMove(controller, { todo: ['b', 'a'] }, hyperMeta('item', 'a', 'todo', 'todo', 1));
    expect(controller.moveRowBetweenGroups).toHaveBeenCalledWith('a', 'todo', 'todo', 'b');
    expect(controller.moveRow).not.toHaveBeenCalled();
  });
  it('keeps No status pinned and propagates rejected moves for rollback', async () => {
    const state = hyperState();
    const controller = { state, moveRowBetweenGroups: vi.fn().mockRejectedValue(new Error('offline')), moveRow: vi.fn(), moveGroup: vi.fn().mockResolvedValue(undefined) };
    await expect(hyperBoardPersistMove(controller, {}, hyperMeta('column', 'todo', 'todo', 'none'))).rejects.toThrow('No status');
    expect(controller.moveGroup).not.toHaveBeenCalled();
    await expect(hyperBoardPersistMove(controller, {}, hyperMeta('item', 'a', 'todo', 'done'))).rejects.toThrow('offline');
    await hyperBoardPersistMove(controller, {}, hyperMeta('column', 'todo', 'todo', 'done'));
    expect(controller.moveGroup).toHaveBeenCalledWith('todo', 'done');
  });
});
