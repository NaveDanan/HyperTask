// ViewTitleBar._buildViewTitles (workspace/presentation/widgets/view_title_bar.dart) as data.
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { isSpace } from '../view/view-ext';
import { viewIsLocked } from './page-access-level-store';

export type Crumb =
  | { type: 'title'; view: ViewPB; editable: boolean }
  | { type: 'ellipsis' }
  | { type: 'divider' }
  | { type: 'trash' };

export interface Breadcrumbs {
  crumbs: Crumb[];
  /** The section chip follows the crumbs (not for deleted pages or single-level paths). */
  showSection: boolean;
}

/**
 * ancestors = FolderEventGetViewAncestors: [workspace root, (space), …parents, view].
 * Index 0 is skipped; deep paths collapse to `a › ... › d › e`.
 */
export function buildBreadcrumbs(
  ancestors: ViewPB[],
  options: { isDeleted: boolean; isGuest: boolean; isEditable: boolean },
): Breadcrumbs {
  if (ancestors.length === 0) return { crumbs: [], showSection: false };
  if (options.isDeleted) {
    // The deleted title keeps ViewTitle's default (editable) behaviour.
    return {
      crumbs: [{ type: 'trash' }, { type: 'divider' }, { type: 'title', view: ancestors[ancestors.length - 1], editable: true }],
      showSection: false,
    };
  }
  if (ancestors.length <= 1) return { crumbs: [], showSection: false };

  const lowerBound = 2;
  // Computed before the guest filter, as in Flutter.
  const upperBound = ancestors.length - 2;
  const views = options.isGuest ? ancestors.filter((v) => !isSpace(v)) : ancestors;

  const crumbs: Crumb[] = [];
  let hasAddedEllipsis = false;
  for (let i = 1; i < views.length; i++) {
    const view = views[i];
    if (i >= lowerBound && i < upperBound) {
      if (!hasAddedEllipsis) {
        hasAddedEllipsis = true;
        crumbs.push({ type: 'ellipsis' }, { type: 'divider' });
      }
      continue;
    }
    const isLast = i === views.length - 1;
    crumbs.push({ type: 'title', view, editable: isLast && !viewIsLocked(view) && options.isEditable });
    if (!isLast) crumbs.push({ type: 'divider' });
  }
  return { crumbs, showSection: true };
}
