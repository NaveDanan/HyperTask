import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { ViewLayoutPB } from '@shared/protobuf/flowy-folder/view_pb';

/** PluginType (startup/plugin/plugin.dart), in registration order. */
export enum PluginType {
  blank = 'blank',
  trash = 'trash',
  document = 'document',
  grid = 'grid',
  board = 'board',
  calendar = 'calendar',
  databaseDocument = 'databaseDocument',
  chat = 'chat',
}

/** PluginArgumentKeys used when opening a view at a location. */
export interface PluginArguments {
  /** Document: block path to select. */
  selection?: number[];
  blockId?: string;
  /** Database: row to open. */
  rowId?: string;
}

export type LocalToolId = 'jira' | 'templates' | 'organization';

/**
 * What a tab shows. Tab identity is `id`: the view id for view plugins, "TrashStack",
 * "local-tool:<toolId>", the row id for row pages, "" for the blank page.
 */
export type Plugin =
  | { kind: 'blank'; id: ''; type: PluginType.blank }
  | { kind: 'trash'; id: 'TrashStack'; type: PluginType.trash }
  | { kind: 'view'; id: string; type: PluginType; view: ViewPB; args?: PluginArguments }
  | {
      kind: 'databaseDocument';
      id: string;
      type: PluginType.databaseDocument;
      view: ViewPB;
      databaseId: string;
      rowId: string;
      documentId?: string;
    }
  // LocalToolPlugin reports PluginType.blank, so it never sets the latest view.
  | { kind: 'localTool'; id: `local-tool:${LocalToolId}`; type: PluginType.blank; toolId: LocalToolId; title: string };

export const blankPlugin = (): Plugin => ({ kind: 'blank', id: '', type: PluginType.blank });
export const trashPlugin = (): Plugin => ({ kind: 'trash', id: 'TrashStack', type: PluginType.trash });
export const localToolPlugin = (toolId: LocalToolId): Plugin => ({
  kind: 'localTool',
  id: `local-tool:${toolId}`,
  type: PluginType.blank,
  toolId,
  title: toolId === 'jira' ? 'Jira' : toolId === 'organization' ? 'All docs' : 'Templates',
});

export function pluginTypeForLayout(layout: ViewLayoutPB): PluginType {
  switch (layout) {
    case ViewLayoutPB.Grid:
      return PluginType.grid;
    case ViewLayoutPB.Board:
      return PluginType.board;
    case ViewLayoutPB.Calendar:
      return PluginType.calendar;
    case ViewLayoutPB.Chat:
      return PluginType.chat;
    default:
      return PluginType.document;
  }
}

/** ViewExtension.plugin({arguments}) (workspace/application/view/view_ext.dart). */
export function viewPlugin(view: ViewPB, args?: PluginArguments): Plugin {
  return { kind: 'view', id: view.id, type: pluginTypeForLayout(view.layout), view, args };
}

export const pluginView = (plugin: Plugin): ViewPB | undefined =>
  plugin.kind === 'view' || plugin.kind === 'databaseDocument' ? plugin.view : undefined;

/** ViewLayoutPB.icon / ViewPB.defaultIcon. */
export function layoutIcon(layout: ViewLayoutPB) {
  switch (layout) {
    case ViewLayoutPB.Grid:
      return 'icon_grid_s' as const;
    case ViewLayoutPB.Board:
      return 'icon_board_s' as const;
    case ViewLayoutPB.Calendar:
      return 'icon_calendar_s' as const;
    case ViewLayoutPB.Chat:
      return 'chat_ai_page_s' as const;
    default:
      return 'icon_document_s' as const;
  }
}
