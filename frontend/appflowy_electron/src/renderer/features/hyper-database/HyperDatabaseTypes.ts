import type { FieldPB, FieldType } from '@shared/protobuf/flowy-database2/field_entities_pb';
import type { FieldSettingsPB } from '@shared/protobuf/flowy-database2/field_settings_entities_pb';
import type { SelectOptionPB } from '@shared/protobuf/flowy-database2/select_option_entities_pb';
import type { RowCoverPB, RowMetaPB } from '@shared/protobuf/flowy-database2/row_entities_pb';
import type { MediaFilePB } from '@shared/protobuf/flowy-database2/media_entities_pb';
import type { GroupPB } from '@shared/protobuf/flowy-database2/group_pb';
import type { DatabaseViewSettingPB } from '@shared/protobuf/flowy-database2/setting_entities_pb';
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import type { HyperDatabaseController } from './HyperDatabaseController';

export type HyperLayout = 'grid' | 'board' | 'calendar' | 'gantt';
export type HyperCell = { display: string; error?: string } & (
  | { kind: 'text' | 'summary' | 'translate'; text: string }
  | { kind: 'number'; value: number | null }
  | { kind: 'url'; url: string }
  | { kind: 'checkbox'; checked: boolean }
  | { kind: 'date'; timestamp: bigint | null; endTimestamp: bigint | null; isRange: boolean; includeTime: boolean; reminderId: string }
  | { kind: 'singleSelect' | 'multiSelect'; selected: SelectOptionPB[]; options: SelectOptionPB[] }
  | { kind: 'checklist'; items: Array<SelectOptionPB & { completed: boolean }>; progress: number }
  | { kind: 'createdTime' | 'lastEditedTime'; timestamp: bigint | null }
  | { kind: 'relation'; rowIds: string[]; databaseId: string }
  | { kind: 'time'; seconds: bigint | null }
  | { kind: 'media'; files: MediaFilePB[] }
);
export type HyperCellMutation =
  | { kind: 'text' | 'summary' | 'translate'; text: string }
  | { kind: 'number'; value: number | null }
  | { kind: 'url'; url: string }
  | { kind: 'checkbox'; checked: boolean }
  | { kind: 'date'; timestamp?: bigint; endTimestamp?: bigint; includeTime?: boolean; isRange?: boolean; clear?: boolean; reminderId?: string }
  | { kind: 'singleSelect' | 'multiSelect'; insertOptionIds?: string[]; deleteOptionIds?: string[] }
  | { kind: 'checklist'; insert?: Array<{ name: string; index?: number }>; deleteIds?: string[]; update?: SelectOptionPB[]; completedIds?: string[]; reorder?: string }
  | { kind: 'relation'; insertRowIds?: string[]; deleteRowIds?: string[] }
  | { kind: 'time'; seconds: bigint | null }
  | { kind: 'media'; insertFiles?: MediaFilePB[]; deleteIds?: string[] };
export interface HyperField {
  id: string; name: string; type: FieldType; isPrimary: boolean;
  settings: FieldSettingsPB; options: SelectOptionPB[]; proto: FieldPB;
}
export interface HyperRow {
  id: string; icon: string | null; cover: RowCoverPB | null;
  isDocumentEmpty: boolean; documentId: string | null; meta: RowMetaPB;
}
export interface HyperGroup extends GroupPB { name: string; option?: SelectOptionPB }
export interface HyperCalendarEvent {
  rowId: string; title: string; dateFieldId: string;
  timestamp: bigint; endTimestamp: bigint | null; includeTime: boolean; meta: RowMetaPB;
}
export interface HyperDatabaseState {
  status: 'idle' | 'loading' | 'ready' | 'error'; error: string | null;
  databaseId: string; viewId: string; view: ViewPB | null; views: ViewPB[];
  fields: HyperField[]; rowIds: string[]; rows: Record<string, HyperRow>;
  /** Missing means not loaded. Use loadRows for the viewport; cells with error can be retried. */
  cells: Record<string, Record<string, HyperCell>>;
  groups: HyperGroup[]; settings: DatabaseViewSettingPB | null;
  revision: number;
  /** Changes to authoritative cell data, excluding reads/cache eviction. */
  dataRevision: number;
}
/** Stable seam owned by the foundation. View agents own only their view and subfolder. */
export interface HyperDatabaseViewProps {
  controller: HyperDatabaseController; state: HyperDatabaseState; view: ViewPB;
}
