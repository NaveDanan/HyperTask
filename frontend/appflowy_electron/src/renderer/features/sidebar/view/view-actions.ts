// The tree row's "···" action order (view_more_action_button.dart _buildActionTypes).
import { ViewLayoutPB, type ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import type { FolderSpaceType } from '../stores/types';

export type ViewMoreActionType =
  | 'favorite'
  | 'unFavorite'
  | 'divider'
  | 'rename'
  | 'changeIcon'
  | 'duplicate'
  | 'moveTo'
  | 'delete'
  | 'collapseAllPages'
  | 'openInNewTab';

/** _buildActionTypes: the exact action order for tree rows and favorites. */
export function buildViewMoreActionTypes(
  view: Pick<ViewPB, 'isFavorite' | 'layout' | 'childViews'>,
  spaceType: FolderSpaceType,
  isExpanded: boolean,
): ViewMoreActionType[] {
  if (spaceType === 'favorite') return ['unFavorite', 'divider', 'rename', 'openInNewTab'];
  const types: ViewMoreActionType[] = [view.isFavorite ? 'unFavorite' : 'favorite', 'divider', 'rename'];
  if (view.layout !== ViewLayoutPB.Chat) types.push('changeIcon', 'duplicate');
  types.push('moveTo', 'delete', 'divider');
  if (view.layout !== ViewLayoutPB.Chat && view.childViews.length > 0 && isExpanded) types.push('collapseAllPages', 'divider');
  types.push('openInNewTab');
  return types;
}

