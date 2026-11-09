// ViewExtension (workspace/application/view/view_ext.dart): values stored in ViewPB.extra.
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { tr } from '@/i18n';

export const ViewExtKeys = {
  font: 'font',
  fontLayout: 'font_layout',
  lineHeightLayout: 'line_height_layout',
  cover: 'cover',
  coverType: 'type',
  coverValue: 'value',
  isPinned: 'is_pinned',
  isSpace: 'is_space',
  spaceCreator: 'space_creator',
  spaceCreatedAt: 'space_created_at',
  spaceIcon: 'space_icon',
  spaceIconColor: 'space_icon_color',
  spacePermission: 'space_permission',
} as const;

/** SpacePermission: index 0 = public, 1 = private. */
export enum SpacePermission {
  publicToAll = 0,
  private = 1,
}

/** ViewPB.extra (a protobuf oneof); '' when unset. */
export const extraString = (view: Pick<ViewPB, 'oneOfExtra'>) => (view.oneOfExtra.case === 'extra' ? view.oneOfExtra.value : '');

export function viewExtra(view: Pick<ViewPB, 'oneOfExtra'>): Record<string, unknown> | null {
  const extra = extraString(view);
  if (!extra) return null;
  try {
    const parsed = JSON.parse(extra);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export const isSpace = (view: Pick<ViewPB, 'oneOfExtra'>) => viewExtra(view)?.[ViewExtKeys.isSpace] === true;
export const isPinnedView = (view: Pick<ViewPB, 'oneOfExtra'>) => viewExtra(view)?.[ViewExtKeys.isPinned] === true;
export const spaceIcon = (view: Pick<ViewPB, 'oneOfExtra'>) => viewExtra(view)?.[ViewExtKeys.spaceIcon] as string | undefined;
export const spaceIconColor = (view: Pick<ViewPB, 'oneOfExtra'>) => viewExtra(view)?.[ViewExtKeys.spaceIconColor] as string | undefined;

export function spacePermission(view: Pick<ViewPB, 'oneOfExtra'>): SpacePermission {
  const extra = viewExtra(view);
  if (!extra) return SpacePermission.private;
  const value = extra[ViewExtKeys.spacePermission];
  return value === 0 ? SpacePermission.publicToAll : SpacePermission.private;
}

/** nameOrDefault: an empty name shows as "Untitled". */
export const nameOrDefault = (view: Pick<ViewPB, 'name'>) => view.name || tr('menuAppHeader.defaultNewPageName');

// ---- Sidebar additions (view_ext.dart, flowy_icon_emoji_picker.dart) ----

/** FlowyIconType: how a ViewIconPB value is interpreted. */
export type FlowyIconType = 'emoji' | 'icon' | 'custom';

/** EmojiIconData: `emoji` holds the emoji, the icon JSON or the custom URL/path. */
export interface EmojiIconData {
  type: FlowyIconType;
  emoji: string;
}

/** EmojiIconData.none(): an icon with an empty value removes the view icon. */
export const emptyEmojiIcon = (): EmojiIconData => ({ type: 'icon', emoji: '' });

/** ViewIconPB.toEmojiIconData(): Emoji→emoji, Icon→icon, Url→custom; an unset icon is an empty emoji. */
export function viewIconData(view: Pick<ViewPB, 'oneOfIcon'>): EmojiIconData {
  if (view.oneOfIcon.case !== 'icon') return { type: 'emoji', emoji: '' };
  const { ty, value } = view.oneOfIcon.value;
  // ViewIconTypePB: Emoji = 0, Url = 1, Icon = 2.
  const type: FlowyIconType = ty === 0 ? 'emoji' : ty === 2 ? 'icon' : 'custom';
  return { type, emoji: value };
}

/** FlowyIconType.toProto(): the ViewIconTypePB value. */
export const iconTypeToProto = (type: FlowyIconType) => (type === 'emoji' ? 0 : type === 'icon' ? 2 : 1);

/** view.isLocked (proto3 optional, false when unset). */
export const isViewLocked = (view: Pick<ViewPB, 'oneOfIsLocked'>) =>
  view.oneOfIsLocked.case === 'isLocked' && view.oneOfIsLocked.value;

/** view.createdBy (0 when unset, as protobuf getters return). */
export const viewCreatedBy = (view: Pick<ViewPB, 'oneOfCreatedBy'>) =>
  view.oneOfCreatedBy.case === 'createdBy' ? view.oneOfCreatedBy.value : 0n;

/** ViewLayoutPB.isDatabaseView: Grid (1), Board (2), Calendar (3). */
export const isDatabaseLayout = (layout: number) => layout === 1 || layout === 2 || layout === 3;

/** isReferencedDatabaseView: a database view inside a database view (a linked view). */
export const isReferencedDatabaseView = (view: Pick<ViewPB, 'layout'>, parentView?: Pick<ViewPB, 'layout'> | null) =>
  !!parentView && isDatabaseLayout(view.layout) && isDatabaseLayout(parentView.layout);

/** jsonDecode(view.extra) merged with `patch`, re-encoded (mergeMaps). Throws on invalid JSON, as Dart does. */
export function mergeViewExtra(view: Pick<ViewPB, 'oneOfExtra'>, patch: Record<string, unknown>): string {
  const extra = extraString(view);
  const current = extra ? (JSON.parse(extra) as Record<string, unknown>) : {};
  return JSON.stringify({ ...current, ...patch });
}

/** ViewPB.containsView: the view itself or anything in its loaded subtree. */
export function containsView(view: Pick<ViewPB, 'id' | 'childViews'>, target: Pick<ViewPB, 'id'>): boolean {
  if (view.id === target.id) return true;
  return view.childViews.some((child) => containsView(child, target));
}
