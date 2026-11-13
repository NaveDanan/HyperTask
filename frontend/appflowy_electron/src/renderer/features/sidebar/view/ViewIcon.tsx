// RawEmojiIconWidget (plugins/document/presentation/editor_plugins/header/emoji_icon_widget.dart).
import type { EmojiIconData } from '@/features/view/view-ext';
import { dartColorToCss } from '../stores/types';
import { findSvgContent, parseIconsData, svgDataUrl, useIconGroups } from '../icon-picker/icon-groups';

import { HyperViewAppearanceImage } from '../../view-appearance/HyperViewAppearanceImage';

/** Emoji text, a built-in icon (tinted), or a custom image. */
export function ViewIcon({ icon, size, lineHeight: _lineHeight }: { icon: EmojiIconData; size: number; lineHeight?: number }) {
  const groups = useIconGroups();
  const fallback = (
    <span className="inline-flex shrink-0 items-center justify-center text-base leading-none" style={{ width: size }}>
      ❓
    </span>
  );
  switch (icon.type) {
    case 'emoji':
      return (
        <span className="text-base leading-none">
          {icon.emoji}
        </span>
      );
    case 'icon': {
      const data = parseIconsData(icon.emoji);
      if (!data) return fallback;
      if (!groups) return <span className="inline-block shrink-0" style={{ width: size, height: size }} />;
      const svg = findSvgContent(`${data.groupName}/${data.iconName}`, groups);
      if (!svg) return fallback;
      return (
        <span
          className="inline-block shrink-0 bg-current [mask-size:100%_100%] [mask-repeat:no-repeat]"
          style={{
            width: size,
            height: size,
            background: dartColorToCss(data.color) ?? undefined,
            WebkitMaskImage: `url("${svgDataUrl(svg)}")`,
          }}
        />
      );
    }
    case 'custom':
      return <HyperViewAppearanceImage value={icon.emoji} className="inline-block shrink-0 object-cover" style={{ width: size, height: size }} />;
  }
}
