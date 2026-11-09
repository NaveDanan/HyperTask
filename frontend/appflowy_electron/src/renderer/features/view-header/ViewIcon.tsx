import { useState, type CSSProperties } from 'react';
import { ViewIconTypePB, type ViewIconPB } from '@shared/protobuf/flowy-folder/icon_pb';
import type { ViewPB } from '@shared/protobuf/flowy-folder/view_pb';
import { argbToCss, findSvgContent, useIconGroups } from './icon-groups';

const isWindows = navigator.userAgent.includes('Windows');

/** The view's icon (ViewPB.icon), or undefined when it has none. */
export const viewIcon = (view: Pick<ViewPB, 'oneOfIcon'>): ViewIconPB | undefined =>
  view.oneOfIcon.case === 'icon' && view.oneOfIcon.value.value !== '' ? view.oneOfIcon.value : undefined;

/** FlowySvg.string: an inline SVG tinted with `color` (srcIn), as a CSS mask. */
export function SvgString({ svg, size, color, style }: { svg: string; size: number; color?: string; style?: CSSProperties }) {
  const url = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 bg-current [mask-size:100%_100%] [mask-repeat:no-repeat]"
      style={{
        width: size,
        height: size,
        backgroundColor: color,
        WebkitMaskImage: url,
        ...style,
      }}
    />
  );
}

/** FlowyText.emoji: emoji font, scaled ×0.9 on Windows. */
export function EmojiText({ emoji, size, lineHeight }: { emoji: string; size: number; lineHeight?: number }) {
  const fontSize = isWindows ? size * 0.9 : size;
  return (
    <span
      className="inline-flex shrink-0 items-center whitespace-nowrap font-['Segoe_UI_Emoji','Apple_Color_Emoji','Noto_Color_Emoji',sans-serif]"
      style={{
        fontSize: `calc(${fontSize}px * var(--text-scale, 1))`,
        lineHeight: lineHeight ? `${lineHeight * size}px` : 1,
      }}
    >
      {emoji}
    </span>
  );
}

function IconsDataIcon({ json, size, enableColor }: { json: string; size: number; enableColor: boolean }) {
  const groups = useIconGroups();
  let data: { groupName?: string; iconName?: string; color?: string } = {};
  try {
    data = JSON.parse(json);
  } catch {
    return <EmojiText emoji="❓" size={size} />;
  }
  if (!groups) return <span className="inline-block shrink-0" style={{ width: size, height: size }} />;
  const svg = findSvgContent(groups, data.groupName ?? '', data.iconName ?? '');
  if (!svg) return <EmojiText emoji="❓" size={size} />;
  return <SvgString svg={svg} size={size} color={(enableColor && argbToCss(data.color)) || undefined} />;
}

function CustomImageIcon({ url, size }: { url: string; size: number }) {
  const [failed, setFailed] = useState(false);
  const isUrl = /^https?:\/\//i.test(url);
  // A network image that fails renders nothing; a missing local file shows the ❓ fallback.
  if (failed) return isUrl ? <span className="shrink-0" style={{ width: size, height: size }} /> : <EmojiText emoji="❓" size={size} />;
  const src = isUrl ? url : `file:///${url.replace(/\\/g, '/').replace(/^\/+/, '')}`;
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt=""
      draggable={false}
      onError={() => setFailed(true)}
      className="shrink-0 object-cover"
    />
  );
}

/** RawEmojiIconWidget (plugins/document/presentation/editor_plugins/header/emoji_icon_widget.dart). */
export function RawEmojiIcon({
  icon,
  size,
  lineHeight,
  enableColor = true,
}: {
  icon: Pick<ViewIconPB, 'ty' | 'value'>;
  size: number;
  lineHeight?: number;
  enableColor?: boolean;
}) {
  switch (icon.ty) {
    case ViewIconTypePB.Emoji:
      return <EmojiText emoji={icon.value} size={size} lineHeight={lineHeight} />;
    case ViewIconTypePB.Icon:
      return <IconsDataIcon json={icon.value} size={size} enableColor={enableColor} />;
    default:
      return <CustomImageIcon url={icon.value} size={size} />;
  }
}
