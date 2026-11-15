import { describe, expect, it, vi } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { renderToStaticMarkup } from 'react-dom/server';
import { FieldPBSchema, FieldType } from '@shared/protobuf/flowy-database2/field_entities_pb';
import { FieldSettingsPBSchema, FieldVisibility } from '@shared/protobuf/flowy-database2/field_settings_entities_pb';
import { SelectOptionColorPB, SelectOptionPBSchema } from '@shared/protobuf/flowy-database2/select_option_entities_pb';
import { DatabaseViewSettingPBSchema } from '@shared/protobuf/flowy-database2/setting_entities_pb';
import { SortConditionPB } from '@shared/protobuf/flowy-database2/sort_entities_pb';
import { ViewPBSchema } from '@shared/protobuf/flowy-folder/view_pb';
import { HyperDatabaseController } from '../../HyperDatabaseController';
import type { HyperCell, HyperField } from '../../HyperDatabaseTypes';

import {
  HyperGridFilterRows,
  HyperGridVisibleFields, HyperGridOrderFields, HyperGridMoveField,
  HyperGridDateInput,
  HyperGridDateSeconds,
  HyperGridFormatDate,
  HyperGridTextMutation,
  HyperGridClearMutation,
  HyperGridError,
} from './HyperGridModel';

import { HyperGridSelectColor } from './selectColor';
import { HyperGridSetSort } from './HyperGridFieldMenu';
import { HyperGridCellDisplay } from './HyperGridCell';
import { HyperGridExpanded } from './HyperGridExpanded';
import { HyperGridContext } from './HyperGridContext';

function field(id: string, type = FieldType.RichText, visibility = FieldVisibility.AlwaysShown): HyperField {
  return {
    id,
    name: id,
    type,
    isPrimary: id === 'Title',

    settings: create(FieldSettingsPBSchema, {
      visibility,
      width: 160,
    }),

    options: [],

    proto: create(FieldPBSchema, {
      id,
      name: id,
      fieldType: type,
      isPrimary: id === 'Title',
    }),
  };
}

const todo = create(SelectOptionPBSchema, {
  id: 'todo',
  name: 'To do',
  color: SelectOptionColorPB.Yellow,
});

const done = create(SelectOptionPBSchema, {
  id: 'done',
  name: 'Done',
  color: SelectOptionColorPB.Green,
});

function fixture() {
  const controller = new HyperDatabaseController('grid');

  const fields = [
    field('Title'),
    field('Status', FieldType.SingleSelect),
    field('Notes', FieldType.RichText, FieldVisibility.AlwaysHidden),
  ];

  controller.store.setState({
    status: 'ready',
    fields,
    rowIds: ['b', 'a', 'c'],

    cells: {
      b: {
        Title: {
          kind: 'text',
          text: 'Build grid',
          display: 'Build grid',
        },

        Status: {
          kind: 'singleSelect',
          selected: [todo],
          options: [todo, done],
          display: 'To do',
        },

        Notes: {
          kind: 'text',
          text: 'RELEASE work',
          display: 'RELEASE work',
        },
      },

      a: {
        Title: {
          kind: 'text',
          text: 'Release API',
          display: 'Release API',
        },

        Status: {
          kind: 'singleSelect',
          selected: [done],
          options: [todo, done],
          display: 'Done',
        },
      },
    },
  });

  return controller;
}

describe('HyperGrid search and visibility', () => {
  it('searches hidden fields, ignores case, and preserves the core order', () => {
    const controller = fixture();
    expect(HyperGridFilterRows(controller.state, 'release')).toEqual(['b', 'a']);
    expect(controller.state.rowIds).toEqual(['b', 'a', 'c']);
  });

  it('combines the option filter with search using AND', () => {
    const controller = fixture();
    expect(HyperGridFilterRows(controller.state, 'release', 'Status', 'todo')).toEqual(['b']);
    expect(HyperGridFilterRows(controller.state, '', 'Status', 'done')).toEqual(['a']);
    expect(HyperGridFilterRows(controller.state, 'missing')).toEqual([]);
  });

  it('handles unloaded cells and empty databases', () => {
    const controller = fixture();
    expect(HyperGridFilterRows(controller.state, '')).toEqual(['b', 'a', 'c']);

    expect(HyperGridFilterRows({
      ...controller.state,
      rowIds: [],
    }, 'x')).toEqual([]);
  });

  it('always shows the primary field and hides only AlwaysHidden columns', () => {
    expect(HyperGridVisibleFields([
      field('Title', FieldType.RichText, FieldVisibility.AlwaysHidden),
      field('Hidden', FieldType.Number, FieldVisibility.AlwaysHidden),
      field('Sparse', FieldType.Number, FieldVisibility.HideWhenEmpty),
    ]).map(item => item.id)).toEqual(['Title', 'Sparse']);
  });
});

describe('HyperGrid cell writes and date boundaries', () => {
  const number: HyperCell = {
    kind: 'number',
    value: 12,
    display: '$12.00',
  };

  it('writes numeric values explicitly and rejects invalid values', () => {
    expect(HyperGridTextMutation(number, '12.5')).toEqual({
      kind: 'number',
      value: 12.5,
    });

    expect(HyperGridTextMutation(number, '')).toEqual({
      kind: 'number',
      value: null,
    });

    expect(HyperGridTextMutation(number, 'not a number')).toBeUndefined();
    expect(HyperGridTextMutation(number, 'Infinity')).toBeUndefined();
  });

  it('does not write to read-only fields', () => {
    const readonly: HyperCell = {
      kind: 'summary',
      text: 'Summary',
      display: 'Summary',
    };

    expect(HyperGridTextMutation(readonly, 'changed')).toBeUndefined();
    expect(HyperGridClearMutation(readonly)).toBeUndefined();
  });

  it('clears select option IDs and dates using their dedicated protocols', () => {
    expect(HyperGridClearMutation({
      kind: 'multiSelect',
      selected: [todo, done],
      options: [todo, done],
      display: '',
    })).toEqual({
      kind: 'multiSelect',
      deleteOptionIds: ['todo', 'done'],
    });

    expect(HyperGridClearMutation({
      kind: 'date',
      timestamp: 0n,
      endTimestamp: null,
      includeTime: false,
      isRange: false,
      reminderId: '',
      display: '',
    })).toEqual({
      kind: 'date',
      clear: true,
    });
  });

  it('keeps unset dates separate from epoch zero and uses seconds', () => {
    expect(HyperGridFormatDate(null)).toBe('');
    expect(HyperGridDateInput(null, false)).toBe('');
    expect(HyperGridFormatDate(0n)).not.toBe('');
    const input = HyperGridDateInput(1767225600n, true);
    expect(HyperGridDateSeconds(input)).toBe(1767225600n);
    expect(HyperGridDateSeconds('')).toBeUndefined();
    expect(HyperGridDateSeconds('garbage')).toBeUndefined();
    expect(HyperGridDateSeconds('2026-01-01')).toBe(BigInt(new Date('2026-01-01T00:00:00').getTime() / 1000));
  });

  it('reports core and validation errors', () => {
    expect(HyperGridError({
      msg: 'Core rejected write',
    })).toBe('Core rejected write');

    expect(HyperGridError(new Error('Invalid number'))).toBe('Invalid number');
  });
});

describe('HyperGrid persisted sort writes', () => {
  it('replaces a different active sort and passes the view ID to Rust', async () => {
    const controller = fixture();

    controller.store.setState({
      settings: create(DatabaseViewSettingPBSchema, {
        sorts: {
          items: [{
            id: 'old',
            fieldId: 'Status',
            condition: SortConditionPB.Ascending,
          }],
        },
      }),
    });

    const update = vi.spyOn(controller, 'updateSettings').mockResolvedValue(undefined);
    await HyperGridSetSort(controller, controller.state.fields[0], true);

    expect(update).toHaveBeenNthCalledWith(1, {
      oneOfDeleteSort: {
        case: 'deleteSort',

        value: {
          viewId: 'grid',
          sortId: 'old',
        },
      },
    });

    expect(update).toHaveBeenNthCalledWith(2, {
      oneOfUpdateSort: {
        case: 'updateSort',

        value: {
          viewId: 'grid',
          fieldId: 'Title',
          condition: SortConditionPB.Descending,
        },
      },
    });
  });

  it('a second click clears the same sort; direction changes preserve its ID', async () => {
    const controller = fixture();

    controller.store.setState({
      settings: create(DatabaseViewSettingPBSchema, {
        sorts: {
          items: [{
            id: 'sort',
            fieldId: 'Title',
            condition: SortConditionPB.Ascending,
          }],
        },
      }),
    });

    const update = vi.spyOn(controller, 'updateSettings').mockResolvedValue(undefined);
    await HyperGridSetSort(controller, controller.state.fields[0], false);

    expect(update).toHaveBeenCalledExactlyOnceWith({
      oneOfDeleteSort: {
        case: 'deleteSort',

        value: {
          viewId: 'grid',
          sortId: 'sort',
        },
      },
    });

    update.mockClear();
    await HyperGridSetSort(controller, controller.state.fields[0], true);

    expect(update).toHaveBeenCalledExactlyOnceWith({
      oneOfUpdateSort: {
        case: 'updateSort',

        value: {
          viewId: 'grid',
          fieldId: 'Title',
          condition: SortConditionPB.Descending,

          oneOfSortId: {
            case: 'sortId',
            value: 'sort',
          },
        },
      },
    });
  });
});

describe('HyperGrid rendered cell and expansion states', () => {
  it.each([SelectOptionColorPB.Green, SelectOptionColorPB.Lime])('maps green/lime %s to success', color => {
    expect(HyperGridSelectColor(color)).toBe('success-light');
  });

  it.each([SelectOptionColorPB.Purple, SelectOptionColorPB.Blue, SelectOptionColorPB.Aqua])('maps cool colours %s to info', color => {
    expect(HyperGridSelectColor(color)).toBe('info-light');
  });

  it('renders semantic select badges and an overflow count', () => {
    const markup = renderToStaticMarkup(<HyperGridCellDisplay
      cell={{
        kind: 'multiSelect',

        selected: [todo, done, {
          ...todo,
          id: 'other',
        }],

        options: [],
        display: '',
      }} />);

    expect(markup).toContain('To do');
    expect(markup).toContain('Done');
    expect(markup).toContain('+1');
    expect(markup).toContain('success');
  });

  it('shows checklist completion and date ranges without raw protobuf values', () => {
    const checklist = renderToStaticMarkup(<HyperGridCellDisplay
      cell={{
        kind: 'checklist',
        display: '',
        progress: 0.5,

        items: [{
          ...todo,
          completed: true,
        }, {
          ...done,
          completed: false,
        }],
      }} />);

    expect(checklist).toContain('1/2');
    expect(checklist).toContain('Checklist completion');

    const date = renderToStaticMarkup(<HyperGridCellDisplay
      cell={{
        kind: 'date',
        display: '',
        timestamp: 1767225600n,
        endTimestamp: 1767312000n,
        includeTime: false,
        isRange: true,
        reminderId: '',
      }} />);

    expect(date).toContain('2026');
    expect(date).toContain('→');
  });

  it('renders hidden properties and the complete checklist rail', () => {
    const controller = fixture();
    const checklist = field('Checklist', FieldType.Checklist);

    controller.store.setState({
      fields: [...controller.state.fields, checklist],

      cells: {
        ...controller.state.cells,

        b: {
          ...controller.state.cells.b,

          Checklist: {
            kind: 'checklist',
            display: '',
            progress: 0.5,

            items: [{
              ...todo,
              completed: true,
            }, {
              ...done,
              completed: false,
            }],
          },
        },
      },
    });

    const noop = vi.fn();

    const markup = renderToStaticMarkup(<HyperGridContext.Provider
      value={{
        controller,
        state: controller.state,
        fields: controller.state.fields,
        moveField: vi.fn(async () => {}),

        view: create(ViewPBSchema, {
          id: 'grid',
        }),

        editing: null,
        edit: noop,
        write: vi.fn(async () => {}),
        run: vi.fn(async () => true),
        expand: noop,
        cell: (row, field) => controller.state.cells[row]?.[field],
        deleteRows: noop,
      }}>
      <HyperGridExpanded rowId='b' />
    </HyperGridContext.Provider>);

    expect(markup).toContain('Properties');
    expect(markup).toContain('Notes');
    expect(markup).toContain('RELEASE work');
    expect(markup).toContain('1 of 2 done');
    expect(markup).toContain('1 open');
    expect(markup).toContain('Add item');
  });
});


describe('HyperGrid per-view field order', () => {
  it('moves both directions without mutating the original order', () => {
    const order = ['Title', 'Status', 'Priority'];
    expect(HyperGridMoveField(order, 'Priority', 'Status')).toEqual(['Title', 'Priority', 'Status']);
    expect(HyperGridMoveField(order, 'Status', 'Priority')).toEqual(['Title', 'Priority', 'Status']);
    expect(order).toEqual(['Title', 'Status', 'Priority']);
  });
  it('keeps primary first, ignores deleted IDs, and appends new fields', () => {
    const fields = [field('Title'), field('Status'), field('Priority'), field('New')];
    expect(HyperGridOrderFields(fields, ['Priority', 'deleted', 'Title', 'Status']).map(f=>f.id)).toEqual(['Title', 'Priority', 'Status', 'New']);
    expect(HyperGridOrderFields(fields, null)).toBe(fields);
  });
});
