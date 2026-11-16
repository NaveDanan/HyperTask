// RawEmojiIconWidget (plugins/document/presentation/editor_plugins/header/emoji_icon_widget.dart).
import { useState } from 'react';
import type { EmojiIconData } from '@/features/view/view-ext';
import { dartColorToCss } from '../stores/types';
import { findSvgContent, parseIconsData, svgDataUrl, useIconGroups } from '../icon-picker/icon-groups';

const isUrl = (value: string) => /^https?:\/\//i.test(value);

/** Emoji text, a built-in icon (tinted), or a custom image. */
export function ViewIcon({ icon, size, lineHeight: _lineHeight }: { icon: EmojiIconData; size: number; lineHeight?: number }) {
  const groups = useIconGroups();
  const [failed, setFailed] = useState(false);
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
    case 'custom': {
      // Network images are loaded without the cloud auth header (the <img> element cannot send it).
      const src = isUrl(icon.emoji) ? icon.emoji : `file:///${icon.emoji.replace(/\\/g, '/').replace(/^\/+/, '')}`;
      if (failed) return isUrl(icon.emoji) ? <span style={{ width: size, height: size }} /> : fallback;
      return <img src={src} width={size} height={size} alt="" draggable={false} className="object-cover" onError={() => setFailed(true)} />;
    }
  }
}
