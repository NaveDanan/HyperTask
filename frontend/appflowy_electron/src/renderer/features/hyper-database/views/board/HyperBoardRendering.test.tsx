import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { create } from '@bufbuild/protobuf';
import { FieldPBSchema, FieldType } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { FieldSettingsPBSchema } from '@shared/protobuf/flowy-database2/field_settings_entities_pb';
import { GroupPBSchema } from '@shared/protobuf/flowy-database2/group_pb';
import { ViewPBSchema, ViewLayoutPB } from '@shared/protobuf/flowy-folder/view_pb';
import { HyperDatabaseController } from '../../HyperDatabaseController';
import type { HyperDatabaseState, HyperField } from '../../HyperDatabaseTypes';
import { HyperBoardView } from '../HyperBoardView';

function hyperBoardEmptyState(): HyperDatabaseState {
  const field = (id: string, type: FieldType, isPrimary = false): HyperField => ({ id, name: id, type, isPrimary, options: [], settings: create(FieldSettingsPBSchema), proto: create(FieldPBSchema, { id, fieldType: type, isPrimary }) });
  return { status: 'ready', error: null, databaseId: 'db', viewId: 'board', view: create(ViewPBSchema, { id: 'board', layout: ViewLayoutPB.Board }), views: [], settings: null, rowIds: [], rows: {}, cells: {}, revision: 0, dataRevision: 0,
    fields: [field('Task', FieldType.RichText, true), field('Status', FieldType.SingleSelect)],
    groups: [{ ...create(GroupPBSchema, { fieldId: 'Status', groupId: 'none', isDefault: true, isVisible: true }), name: 'No status' }, { ...create(GroupPBSchema, { fieldId: 'Status', groupId: 'todo', isVisible: true }), name: 'To do' }] };
}
function hyperRender(state: HyperDatabaseState) {
  const controller = new HyperDatabaseController('board');
  try { return renderToStaticMarkup(<HyperBoardView controller={controller} state={state} view={state.view!} />); }
  finally { controller.dispose(); }
}
describe('HyperBoard empty and loading states', () => {
  it('keeps columns, placeholders and creation available for a zero-row board', () => {
    const html = hyperRender(hyperBoardEmptyState());
    expect(html).toContain('No status group');
    expect(html).toContain('To do group');
    expect(html.match(/data-hyper-board-empty-group="true"/g)).toHaveLength(2);
    expect(html).not.toContain('Board needs a status field');
  });
  it('offers Status field creation when no groupable field exists', () => {
    const state = hyperBoardEmptyState(); state.fields = state.fields.filter(field => field.isPrimary); state.groups = [];
    const html = hyperRender(state);
    expect(html).toContain('Board needs a status field');
    expect(html).toContain('Add Status field');
    expect(html).not.toContain('data-slot="kanban-column"');
  });
  it('shows skeleton columns while data is loading', () => {
    const state = hyperBoardEmptyState(); state.status = 'loading';
    const html = hyperRender(state);
    expect(html.match(/h-64 w-72 shrink-0 rounded-lg/g)).toHaveLength(3);
    expect(html).not.toContain('data-slot="kanban-column"');
  });
});
