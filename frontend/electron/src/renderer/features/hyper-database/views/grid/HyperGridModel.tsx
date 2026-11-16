import { hyperMentionPeople } from '@/features/hyper-people/hyperMentions';
import { Users } from 'lucide-react';
import { format } from 'date-fns';

import {
  Calendar,
  CircleChevronDown,
  Clock,
  Hash,
  Link,
  List,
  ListChecks,
  SquareCheck,
  Type,
  FileText,
  Paperclip,
  Network,
  Timer,
} from 'lucide-react';

import { FieldType } from '@shared/protobuf/hyper-database2/field_entities_pb';
import { FieldVisibility } from '@shared/protobuf/hyper-database2/field_settings_entities_pb';
import type { HyperCell, HyperCellMutation, HyperDatabaseState, HyperField } from '../../HyperDatabaseTypes';

export const HyperGridFieldTypes = [{
  type: FieldType.RichText,
  label: 'Text',
  icon: Type,
}, {
  type: FieldType.RichText, label: 'People', icon: Users, people: true,
}, {
  type: FieldType.Number,
  label: 'Number',
  icon: Hash,
}, {
  type: FieldType.SingleSelect,
  label: 'Single select',
  icon: CircleChevronDown,
}, {
  type: FieldType.MultiSelect,
  label: 'Multi select',
  icon: List,
}, {
  type: FieldType.DateTime,
  label: 'Date',
  icon: Calendar,
}, {
  type: FieldType.Checkbox,
  label: 'Checkbox',
  icon: SquareCheck,
}, {
  type: FieldType.URL,
  label: 'URL',
  icon: Link,
}, {
  type: FieldType.Checklist,
  label: 'Checklist',
  icon: ListChecks,
}, {
  type: FieldType.CreatedTime,
  label: 'Created time',
  icon: Clock,
}, {
  type: FieldType.LastEditedTime,
  label: 'Last edited time',
  icon: Clock,
}, {
  type: FieldType.Relation,
  label: 'Relation',
  icon: Network,
}, {
  type: FieldType.Media,
  label: 'Media',
  icon: Paperclip,
}, {
  type: FieldType.Time,
  label: 'Time',
  icon: Timer,
}, {
  type: FieldType.Summary,
  label: 'Summary',
  icon: FileText,
}, {
  type: FieldType.Translate,
  label: 'Translate',
  icon: FileText,
}];

export function HyperGridFieldIcon(
  {
    type,
    className = 'size-3.5', people = false,
  }: {
    type: FieldType; people?: boolean;
    className?: string;
  },
) {
  const Icon = people ? Users : HyperGridFieldTypes.find(item => item.type === type)?.icon ?? Type;
  return <Icon className={className} aria-hidden='true' />;
}

export function HyperGridVisibleFields(fields: HyperField[]) {
  return fields.filter(field => field.isPrimary || field.settings.visibility !== FieldVisibility.AlwaysHidden);
}

export function HyperGridFilterRows(state: HyperDatabaseState, query: string, fieldId?: string, optionId?: string, person?: { fieldId: string; email: string }) {
  const search = query.trim().toLocaleLowerCase();

  return state.rowIds.filter(id => {
    const cells = state.cells[id];

    if (search && !state.fields.some(field => cells?.[field.id]?.display.toLocaleLowerCase().includes(search)))
      return false;

    const peopleCell = person ? cells?.[person.fieldId] : undefined;
    if (person && (peopleCell?.kind !== 'text' || !hyperMentionPeople(peopleCell.text).some(item => item.email === person.email.toLowerCase()))) return false;
    const cell = fieldId ? cells?.[fieldId] : undefined;
    return !optionId || (cell?.kind === 'singleSelect' && cell.selected.some(option => option.id === optionId));
  });
}

export function HyperGridTextMutation(cell: HyperCell, raw: string): HyperCellMutation | undefined {
  if (cell.kind === 'text') return {
    kind: 'text',
    text: raw,
  };

  if (cell.kind === 'url') return {
    kind: 'url',
    url: raw,
  };

  if (cell.kind === 'number') {
    if (!raw.trim()) return {
      kind: 'number',
      value: null,
    };

    const value = Number(raw);

    return Number.isFinite(value) ? {
      kind: 'number',
      value,
    } : undefined;
  }

  return undefined;
}

export function HyperGridClearMutation(cell: HyperCell): HyperCellMutation | undefined {
  switch (cell.kind) {
  case 'text':
    return {
      kind: 'text',
      text: '',
    };
  case 'number':
    return {
      kind: 'number',
      value: null,
    };
  case 'url':
    return {
      kind: 'url',
      url: '',
    };
  case 'checkbox':
    return {
      kind: 'checkbox',
      checked: false,
    };
  case 'date':
    return {
      kind: 'date',
      clear: true,
    };
  case 'singleSelect':
  case 'multiSelect':
    return {
      kind: cell.kind,
      deleteOptionIds: cell.selected.map(option => option.id),
    };
  default:
    return undefined;
  }
}

export function HyperGridFormatDate(timestamp: bigint | null, includeTime = false) {
  if (timestamp === null)
    return '';

  const date = new Date(Number(timestamp) * 1000);
  return Number.isNaN(date.getTime()) ? '' : format(date, includeTime ? 'MMM d, yyyy HH:mm' : 'MMM d, yyyy');
}

export function HyperGridDateInput(timestamp: bigint | null, includeTime: boolean) {
  if (timestamp === null)
    return '';

  const date = new Date(Number(timestamp) * 1000);
  return Number.isNaN(date.getTime()) ? '' : format(date, includeTime ? 'yyyy-MM-dd\'T\'HH:mm' : 'yyyy-MM-dd');
}

export function HyperGridDateSeconds(raw: string): bigint | undefined {
  if (!raw)
    return undefined;

  // Local dates are local midnight, just as datetime-local uses local wall time.
  const millis = new Date(raw.length === 10 ? `${raw}T00:00:00` : raw).getTime();

  return Number.isFinite(millis) ? BigInt(Math.floor(millis / 1000)) : undefined;
}

export function HyperGridError(error: unknown) {
  if (error instanceof Error)
    return error.message;

  if (error && typeof error === 'object' && 'msg' in error)
    return String(error.msg);

  return String(error);
}

/** GetDatabase exposes global field order; retain this Grid view's order in core-backed extra data. */
export function HyperGridOrderFields(fields: HyperField[], saved: unknown): HyperField[] {
  if (!Array.isArray(saved)) return fields;
  const order = new Map(saved.filter((id): id is string => typeof id === 'string').map((id, index) => [id, index]));
  return [...fields].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return (order.get(a.id) ?? saved.length) - (order.get(b.id) ?? saved.length);
  });
}
export function HyperGridMoveField(order: string[], from: string, to: string): string[] {
  const fromIndex = order.indexOf(from); const toIndex = order.indexOf(to);
  if (fromIndex < 0 || toIndex < 0 || from === to) return order;
  const next = [...order]; next.splice(fromIndex, 1); next.splice(toIndex, 0, from); return next;
}
