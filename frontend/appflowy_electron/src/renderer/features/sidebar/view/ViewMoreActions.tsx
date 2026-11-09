// ViewMoreActionPopover (menu/view/view_more_action_button.dart, view_action_type.dart): the
// tree row's "···" menu, also opened by right-click at the cursor.
import type { ReactNode, Ref } from 'react';
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { WorkspaceTypePB } from '@shared/protobuf/flowy-user/workspace_pb';
import type { FlowySvgName } from '@/icons/flowy-svgs';
import { tr as translate, useTr } from '@/i18n';
import { AppFlowyPopover, Tooltip, showAFTextFieldDialog, showConfirmDeletionDialog, type PopoverController } from '@/ui';
import { tabsActions } from '@/features/tabs/tabs-store';
import { isViewLocked, nameOrDefault, viewIconData } from '@/features/view/view-ext';
import { ViewBackendService } from '@/features/view/view-service';
import { ActionListPopover, MenuDivider, MenuItem } from '../components';
import { IconEmojiPicker, type SelectedEmojiIconResult } from '../icon-picker/IconEmojiPicker';
import { favoriteActions } from '../stores/favorite-store';
import { sidebarSpace } from '../stores/space-store';
import type { FolderSpaceType } from '../stores/types';
import type { ViewBloc } from '../stores/view-bloc';
import { MovePageMenu } from './MovePageMenu';
import { buildViewMoreActionTypes, type ViewMoreActionType } from './view-actions';
import { moveViewCrossSpace } from './ViewItem';

const META: Record<Exclude<ViewMoreActionType, 'divider'>, { key: string; icon: FlowySvgName; disabledWhenLocked: boolean }> = {
  favorite: { key: 'disclosureAction.favorite', icon: 'favorite_s', disabledWhenLocked: false },
  unFavorite: { key: 'disclosureAction.unfavorite', icon: 'unfavorite_s', disabledWhenLocked: false },
  rename: { key: 'disclosureAction.rename', icon: 'view_item_rename_s', disabledWhenLocked: true },
  changeIcon: { key: 'disclosureAction.changeIcon', icon: 'change_icon_s', disabledWhenLocked: true },
  duplicate: { key: 'disclosureAction.duplicate', icon: 'duplicate_s', disabledWhenLocked: false },
  moveTo: { key: 'disclosureAction.moveTo', icon: 'move_to_s', disabledWhenLocked: true },
  delete: { key: 'disclosureAction.delete', icon: 'trash_s', disabledWhenLocked: true },
  collapseAllPages: { key: 'disclosureAction.collapseAllPages', icon: 'collapse_all_page_s', disabledWhenLocked: false },
  openInNewTab: { key: 'disclosureAction.openNewTab', icon: 'view_item_open_in_new_tab_s', disabledWhenLocked: false },
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
      constraints={{ minWidth: 260 }}
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
    <MenuItem icon={meta.icon} name={tr(meta.key)} danger={type === 'delete'} onTap={tapHandler} />
  );

  let child: ReactNode;
  if (type === 'changeIcon') {
    child = (
      <AppFlowyPopover
        constraints={{ maxWidth: 364, maxHeight: 356 }}
        margin={0}
        popup={() => (
          <IconEmojiPicker tabs={['emoji', 'icon', 'custom']} initialType={viewIconData(view).type} onSelected={(result) => onTap(result)} />
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
        constraints={{ maxWidth: 260, maxHeight: 345 }}
        margin="12px 14px"
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
          <div style={{ pointerEvents: 'none' }}>{child}</div>
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
