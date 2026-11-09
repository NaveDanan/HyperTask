import { ViewSectionPB } from '@shared/protobuf/flowy-folder/view_pb';

/** FolderSpaceType (workspace/application/sidebar/folder/folder_bloc.dart). */
export type FolderSpaceType = 'favorite' | 'private' | 'public' | 'unknown';

/** FolderSpaceType.toViewSectionPB: favorite/unknown throw in Dart; null here. */
export function toViewSectionPB(type: FolderSpaceType): ViewSectionPB | undefined {
  if (type === 'private') return ViewSectionPB.Private;
  if (type === 'public') return ViewSectionPB.Public;
  return undefined;
}

/** IgnoreViewType (view_item.dart). */
export type IgnoreViewType = 'none' | 'hide' | 'disable';

/** SpacePermission colors/icons (space_icon_popup.dart): index order matters, first = default. */
export const builtInSpaceColors = [
  '0xFFA34AFD',
  '0xFFFB006D',
  '0xFF00C8FF',
  '0xFFFFBA00',
  '0xFFF254BC',
  '0xFF2AC985',
  '0xFFAAD93D',
  '0xFF535CE4',
  '0xFF808080',
  '0xFFD2515F',
  '0xFF409BF8',
  '0xFFFF8933',
];

/** Legacy (< 0.6.7) space icons: assets/flowy_icons/16x/space_icon_N.svg. */
export const builtInSpaceIcons = Array.from({ length: 15 }, (_, i) => `space_icon_${i + 1}`);

export const kDefaultSpaceIconId = 'interface_essential/home-3';

/** Color(int.parse("0xAARRGGBB")) as a CSS color, or null when the value does not parse. */
export function dartColorToCss(value: string | null | undefined): string | null {
  if (!value) return null;
  const n = value.trim().toLowerCase().startsWith('0x') ? Number.parseInt(value.trim().slice(2), 16) : Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return null;
  const a = ((n >>> 24) & 0xff) / 255;
  const r = (n >>> 16) & 0xff;
  const g = (n >>> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${Math.round(a * 1000) / 1000})`;
}

export const uniqueById = <T extends { id: string }>(items: T[]): T[] => {
  const seen = new Set<string>();
  return items.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));
};
