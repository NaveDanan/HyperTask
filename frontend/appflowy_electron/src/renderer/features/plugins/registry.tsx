// The plugin registry (startup/plugin/plugin.dart, startup/tasks/load_plugin.dart) and each
// plugin's PluginWidgetBuilder: tab label, header items, content padding and body.
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { ViewLayoutPB, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import type { UserProfilePB } from '@shared/protobuf/flowy-user/user_profile_pb';
import { tr, useTr } from '@/i18n';
import { FileText, LayoutTemplate, SquareCheckBig, Trash2 } from 'lucide-react';
import { MenuSeparator } from '@/components/app/menu-row';
import { cn } from '@/lib/utils';
import { PluginType, type Plugin } from '../tabs/plugin';
import { nameOrDefault } from '../view/view-ext';
import { ViewFavoriteButton } from '../view-header/FavoriteButton';
import { CustomViewAction, MoreViewActions } from '../view-header/MoreViewActions';
import { ShareButton } from '../view-header/share/ShareButton';
import { RawEmojiIcon, viewIcon } from '../view-header/ViewIcon';
import { ViewTitleBar } from '../view-header/ViewTitleBar';
import { ViewTitleBarWithRow } from '../view-header/ViewTitleBarWithRow';
import { listenView } from '../view-header/view-listener';
import { BlankPage, HyperLayoutIcon, LocalToolPlaceholder, PlaceholderMessage, ViewPlaceholderPage } from './PlaceholderPage';
import { TrashPage } from './trash/TrashPage';
import { TemplateStorePage } from '../templates/TemplateStorePage';

/** PluginContext: onDeleted(view, index) and the user (null in the secondary view). */
export interface PluginContext {
  onDeleted?: (view: ViewPB, index?: number) => void;
  userProfile?: UserProfilePB | null;
}

export interface PluginWidgets {
  /** viewName: the tab tooltip (null = no tooltip). */
  viewName: string | null;
  tabBarItem: (shortForm: boolean) => ReactNode;
  leftBarItem: ReactNode;
  rightBarItem: ReactNode | null;
  contentPadding: CSSProperties['padding'];
  buildWidget: (context: PluginContext) => ReactNode;
}

/** PluginSandbox registration order (PluginLoadTask): the FadingIndexedStack slot index. */
export const PLUGIN_SLOTS: PluginType[] = [
  PluginType.blank,
  PluginType.trash,
  PluginType.document,
  PluginType.grid,
  PluginType.board,
  PluginType.calendar,
  PluginType.databaseDocument,
  PluginType.chat,
];

/** pluginBuilders(): the creatable plugins (menuName, icon, layout) for add-page menus. */
export const pluginBuilders = () => [
  { pluginType: PluginType.document, menuName: tr('document.menuName'), icon: 'icon_document_s' as const, layout: ViewLayoutPB.Document },
  { pluginType: PluginType.grid, menuName: tr('grid.menuName'), icon: 'icon_grid_s' as const, layout: ViewLayoutPB.Grid },
  { pluginType: PluginType.board, menuName: tr('board.menuName'), icon: 'icon_board_s' as const, layout: ViewLayoutPB.Board },
  { pluginType: PluginType.calendar, menuName: tr('calendar.menuName'), icon: 'icon_calendar_s' as const, layout: ViewLayoutPB.Calendar },
  { pluginType: PluginType.chat, menuName: 'AI Chat', icon: 'chat_ai_page_s' as const, layout: ViewLayoutPB.Chat },
];

/** ViewTabBarItem (workspace/presentation/widgets/tab_bar_item.dart). */
export function ViewTabBarItem({ view, shortForm }: { view: ViewPB; shortForm: boolean }) {
  // The icon comes from the view the tab was opened with (icon changes need a reopen); the name is live.
  const [initialIcon] = useState(() => viewIcon(view));
  const [current, setCurrent] = useState(view);
  useEffect(() => listenView(view.id, { onViewUpdated: setCurrent }), [view.id]);
  return (
    <div className={cn('flex min-w-0 items-center gap-1.5', shortForm && 'justify-center')}>
      {initialIcon ? <RawEmojiIcon icon={initialIcon} size={16} /> : <HyperLayoutIcon layout={view.layout} />}
      {!shortForm && <span className="min-w-0 truncate">{nameOrDefault(current)}</span>}
    </div>
  );
}

function MediumLabel({ text }: { text: string }) {
  return <span className="truncate text-sm font-medium">{text}</span>;
}

function TrashLabel() {
  const { tr } = useTr();
  return <span className="flex min-w-0 items-center gap-1.5"><Trash2 className="size-4 text-muted-foreground" /><MediumLabel text={tr('trash.text')} /></span>;
}

function BlankLabel() {
  const { tr } = useTr();
  return <MediumLabel text={tr('blankPageTitle')} />;
}

/** DocumentPluginWidgetBuilder.rightBarItem: collaborators (empty) + 16, Share, Favorite, More. */
function DocumentRightBar({ view }: { view: ViewPB }) {
  return (
    <div className="ml-auto flex shrink-0 items-center gap-1">
      <ShareButton view={view} />
      <ViewFavoriteButton view={view} />
      <MoreViewActions view={view} />
    </div>
  );
}

/** DatabasePluginWidgetBuilder.rightBarItem: Share, Favorite, More. */
function DatabaseRightBar({ view }: { view: ViewPB }) {
  return (
    <div className="ml-auto flex shrink-0 items-center gap-1">
      <ShareButton view={view} />
      <ViewFavoriteButton view={view} />
      <MoreViewActions view={view} />
    </div>
  );
}

/** AIChatPagePluginWidgetBuilder.rightBarItem: Favorite, More with "Add messages to page". */
function ChatRightBar({ view }: { view: ViewPB }) {
  const { tr } = useTr();
  return (
    <div className="ml-auto flex shrink-0 items-center gap-1">
      <ViewFavoriteButton view={view} />
      <MoreViewActions
        view={view}
        customActions={
          <>
            {/* ChatSelectMessageState.enabled is false until the chat page has messages. */}
            <CustomViewAction
              leftIcon="ai_add_to_page_s"
              label={tr('moreAction.saveAsNewPage')}
              tooltipMessage={tr('moreAction.saveAsNewPageDisabled')}
              disabled
            />
            <MenuSeparator />
          </>
        }
      />
    </div>
  );
}

const DEFAULT_PADDING: CSSProperties['padding'] = '28px 40px';

/** plugin.widgetBuilder for every plugin kind of features/tabs/plugin.ts. */
export function pluginWidgets(plugin: Plugin): PluginWidgets {
  switch (plugin.kind) {
    case 'blank':
      return {
        viewName: tr('blankPageTitle'),
        tabBarItem: (shortForm) => <span className="flex min-w-0 items-center gap-1.5 text-xs"><FileText className="size-4 text-muted-foreground" />{!shortForm && <span className="truncate">{tr('blankPageTitle')}</span>}</span>,
        leftBarItem: <BlankLabel />,
        rightBarItem: null,
        contentPadding: DEFAULT_PADDING,
        buildWidget: () => <BlankPage />,
      };
    case 'trash':
      return {
        viewName: tr('trash.text'),
        tabBarItem: (shortForm) => <span className="flex min-w-0 items-center gap-1.5 text-xs"><Trash2 className="size-4 text-muted-foreground" />{!shortForm && <span className="truncate">{tr('trash.text')}</span>}</span>,
        leftBarItem: <TrashLabel />,
        rightBarItem: null,
        contentPadding: 0,
        buildWidget: () => <TrashPage />,
      };
    case 'localTool':
      return {
        viewName: plugin.title,
        tabBarItem: (shortForm) => <span className="flex min-w-0 items-center gap-1.5 text-xs">{plugin.toolId === 'jira' ? <SquareCheckBig className="size-4 text-muted-foreground" /> : <LayoutTemplate className="size-4 text-muted-foreground" />}{!shortForm && <span className="truncate">{plugin.title}</span>}</span>,
        leftBarItem: <MediumLabel text={plugin.title} />,
        rightBarItem: null,
        contentPadding: 0,
        buildWidget: (context) => plugin.toolId === 'templates' ? <TemplateStorePage userProfile={context.userProfile} /> : <LocalToolPlaceholder title={plugin.title} />,
      };
    case 'databaseDocument':
      return {
        viewName: nameOrDefault(plugin.view),
        // DatabaseDocumentPlugin's tab label is empty (only the close button shows).
        tabBarItem: () => null,
        leftBarItem: <ViewTitleBarWithRow view={plugin.view} />,
        rightBarItem: null,
        contentPadding: 0,
        buildWidget: () => <PlaceholderMessage icon={<HyperLayoutIcon layout={ViewLayoutPB.Document} className="size-5" />} name={nameOrDefault(plugin.view)} />,
      };
    case 'view': {
      const view = plugin.view;
      const type = plugin.type;
      const isDatabase = type === PluginType.grid || type === PluginType.board || type === PluginType.calendar;
      return {
        viewName: nameOrDefault(view),
        tabBarItem: (shortForm) => <ViewTabBarItem view={view} shortForm={shortForm} />,
        leftBarItem: <ViewTitleBar view={view} />,
        rightBarItem:
          type === PluginType.chat ? (
            <ChatRightBar view={view} />
          ) : isDatabase ? (
            <DatabaseRightBar view={view} />
          ) : (
            <DocumentRightBar view={view} />
          ),
        // Document and chat use EdgeInsets.zero; databases EdgeInsets.only(top: 28).
        contentPadding: isDatabase ? '28px 0 0 0' : 0,
        buildWidget: (context) => <ViewPlaceholderPage view={view} context={context} />,
      };
    }
  }
}
