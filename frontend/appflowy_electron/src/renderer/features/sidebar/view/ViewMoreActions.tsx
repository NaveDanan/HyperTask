// ViewMoreActionPopover (menu/view/view_more_action_button.dart, view_action_type.dart): the
// tree row's "···" menu, also opened by right-click at the cursor.
import type { ReactNode, Ref } from 'react';
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { WorkspaceTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import { ChevronsDownUp, Copy, FolderInput, PencilLine, SmilePlus, SquareArrowOutUpRight, Star, Trash2, type LucideIcon } from 'lucide-react';
import { tr as translate, useTr } from '@/i18n';
import { AppFlowyPopover, Tooltip, showAFTextFieldDialog, showConfirmDeletionDialog, type PopoverController } from '@/ui';
import { tabsActions } from '@/features/tabs/tabs-store';
import { isViewLocked, nameOrDefault } from '@/features/view/view-ext';
import { ViewBackendService } from '@/features/view/view-service';
import { ActionListPopover, MenuDivider } from '../components';
import { MenuRow } from '@/components/app/menu-row';
import { type SelectedEmojiIconResult } from '../icon-picker/IconEmojiPicker';
import { HyperViewIconPicker } from '../../view-appearance/HyperViewIconPicker';
import { favoriteActions } from '../stores/favorite-store';
import { sidebarSpace } from '../stores/space-store';
import type { FolderSpaceType } from '../stores/types';
import type { ViewBloc } from '../stores/view-bloc';
import { MovePageMenu } from './MovePageMenu';
import { buildViewMoreActionTypes, type ViewMoreActionType } from './view-actions';
import { moveViewCrossSpace } from './ViewItem';

const META: Record<Exclude<ViewMoreActionType, 'divider'>, { key: string; icon: LucideIcon; disabledWhenLocked: boolean }> = {
  favorite: { key: 'disclosureAction.favorite', icon: Star, disabledWhenLocked: false },
  unFavorite: { key: 'disclosureAction.unfavorite', icon: Star, disabledWhenLocked: false },
  rename: { key: 'disclosureAction.rename', icon: PencilLine, disabledWhenLocked: true },
  changeIcon: { key: 'disclosureAction.changeIcon', icon: SmilePlus, disabledWhenLocked: true },
  duplicate: { key: 'disclosureAction.duplicate', icon: Copy, disabledWhenLocked: false },
  moveTo: { key: 'disclosureAction.moveTo', icon: FolderInput, disabledWhenLocked: true },
  delete: { key: 'disclosureAction.delete', icon: Trash2, disabledWhenLocked: true },
  collapseAllPages: { key: 'disclosureAction.collapseAllPages', icon: ChevronsDownUp, disabledWhenLocked: false },
  openInNewTab: { key: 'disclosureAction.openNewTab', icon: SquareArrowOutUpRight, disabledWhenLocked: false },
};

export type ViewMoreActionData = SelectedEmojiIconResult | [space: ViewPB, target: ViewPB] | null;

export function ViewMoreActionPopover({
  view,
  spaceType,
  isExpanded,
  controllerRef,
  onEditing,
  onAction,
  children,
}: {
  view: ViewPB;
  spaceType: FolderSpaceType;
  isExpanded: boolean;
  controllerRef: Ref<PopoverController>;
  onEditing: (value: boolean) => void;
  onAction: (type: ViewMoreActionType, data: ViewMoreActionData) => void;
  children: ReactNode;
}) {
  const types = buildViewMoreActionTypes(view, spaceType, isExpanded);
  return (
    <ActionListPopover
      controllerRef={controllerRef}
      direction="bottomWithLeftAligned"
      offset={{ x: 0, y: 8 }}
      constraints={{ minWidth: 224, maxWidth: 224 }}
      onOpen={() => onEditing(true)}
      onClose={() => onEditing(false)}
      popup={(close) => (
        <>
          {types.map((type, index) => (
            <ViewMoreActionItem
              key={`${type}-${index}`}
              type={type}
              view={view}
              onTap={(data) => {
                onEditing(false);
                onAction(type, data);
                const keepOpen = data !== null && !Array.isArray(data) && data.keepOpen;
                if (!keepOpen) close();
              }}
            />
          ))}
        </>
      )}
    >
      {children}
    </ActionListPopover>
  );
}

function ViewMoreActionItem({
  type,
  view,
  onTap,
}: {
  type: ViewMoreActionType;
  view: ViewPB;
  onTap: (data: ViewMoreActionData) => void;
}) {
  const { tr } = useTr();
  if (type === 'divider') return <MenuDivider />;
  const meta = META[type];
  const item = (tapHandler?: () => void) => (
    <MenuRow icon={<meta.icon className="size-4" />} label={tr(meta.key)} destructive={type === 'delete'} submenu={type === 'moveTo'} onClick={tapHandler} />
  );

  let child: ReactNode;
  if (type === 'changeIcon') {
    child = (
      <AppFlowyPopover
        plain
        constraints={{ maxWidth: 364, maxHeight: 356 }}
        margin={0}
        popup={() => (
          <HyperViewIconPicker view={view} onApplied={keep => { if (!keep) onTap(null); }} />
        )}
      >
        {item()}
      </AppFlowyPopover>
    );
  } else if (type === 'moveTo') {
    // Move to is not available for local workspaces.
    if (sidebarSpace.actions.userProfile?.workspaceType !== WorkspaceTypePB.ServerW) return null;
    child = (
      <AppFlowyPopover
        constraints={{ maxWidth: 288, maxHeight: 400 }}
        margin={0}
        direction="rightWithTopAligned"
        popup={() => <MovePageMenu sourceView={view} onSelected={(space, target) => onTap([space, target])} />}
      >
        {item()}
      </AppFlowyPopover>
    );
  } else {
    child = item(() => onTap(null));
  }

  if (meta.disabledWhenLocked && isViewLocked(view)) {
    // LockPageButtonWrapper: a tooltip and IgnorePointer, no dimming.
    return (
      <Tooltip message={tr('lockPage.lockedOperationTooltip')}>
        <div>
          <div className="pointer-events-none">{child}</div>
        </div>
      </Tooltip>
    );
  }
  return <>{child}</>;
}

/** SingleInnerViewItem._buildViewMoreActionButton.onAction (tree rows). */
export async function handleViewMoreAction(
  type: ViewMoreActionType,
  data: ViewMoreActionData,
  { view, parentView, bloc }: { view: ViewPB; parentView: ViewPB | null; bloc: ViewBloc },
) {
  switch (type) {
    case 'favorite':
    case 'unFavorite':
      void favoriteActions.toggle(view);
      break;
    case 'rename':
      showAFTextFieldDialog({
        title: translate('disclosureAction.rename'),
        initialValue: nameOrDefault(view),
        maxLength: 256,
        onConfirm: (name) => void bloc.rename(name),
      });
      break;
    case 'delete': {
      // A confirmation is only asked when the page (or a child) is published.
      const [published] = await ViewBackendService.containPublishedPage(view);
      if (published) {
        showConfirmDeletionDialog({
          name: view.name,
          description: translate('publish.containsPublishedPage'),
          onConfirm: () => void bloc.delete(),
        });
      } else {
        void bloc.delete();
      }
      break;
    }
    case 'duplicate':
      void bloc.duplicate();
      break;
    case 'openInNewTab':
      tabsActions.openViewInNewTab(view);
      break;
    case 'collapseAllPages':
      void bloc.collapseAllPages();
      break;
    case 'changeIcon':
      if (data && !Array.isArray(data)) void ViewBackendService.updateViewIcon(view, data.data);
      break;
    case 'moveTo':
      if (Array.isArray(data)) moveViewCrossSpace(bloc, data[0], view, parentView, view, data[1].id);
      break;
    default:
      break;
  }
}

export type { ViewMoreActionType };
