// RawEmojiIconWidget (plugins/document/presentation/editor_plugins/header/emoji_icon_widget.dart).
import { useState } from 'react';
import type { EmojiIconData } from '@/features/view/view-ext';
import { dartColorToCss } from '../stores/types';
import { findSvgContent, parseIconsData, svgDataUrl, useIconGroups } from '../icon-picker/icon-groups';

const isUrl = (value: string) => /^https?:\/\//i.test(value);

/** Emoji text (×0.9 on Windows, as FlowyText.emoji), a built-in icon (tinted), or a custom image. */
export function ViewIcon({ icon, size, lineHeight }: { icon: EmojiIconData; size: number; lineHeight?: number }) {
  const groups = useIconGroups();
  const [failed, setFailed] = useState(false);
  const fallback = (
    <span className="sb-emoji" style={{ fontSize: size * 0.9, width: size, textAlign: 'center' }}>
      ❓
    </span>
  );
  switch (icon.type) {
    case 'emoji':
      return (
        <span className="sb-emoji" style={{ fontSize: size * 0.9, lineHeight: lineHeight ? `${lineHeight}px` : 1 }}>
          {icon.emoji}
        </span>
      );
    case 'icon': {
      const data = parseIconsData(icon.emoji);
      if (!data) return fallback;
      if (!groups) return <span style={{ width: size, height: size, display: 'inline-block' }} />;
      const svg = findSvgContent(`${data.groupName}/${data.iconName}`, groups);
      if (!svg) return fallback;
      return (
        <span
          style={{
            display: 'inline-block',
            flexShrink: 0,
            width: size,
            height: size,
            background: dartColorToCss(data.color) ?? 'var(--icon-color)',
            WebkitMaskImage: `url("${svgDataUrl(svg)}")`,
            WebkitMaskSize: '100% 100%',
            WebkitMaskRepeat: 'no-repeat',
          }}
        />
      );
    }
    case 'custom': {
      // Network images are loaded without the cloud auth header (the <img> element cannot send it).
      const src = isUrl(icon.emoji) ? icon.emoji : `file:///${icon.emoji.replace(/\\/g, '/').replace(/^\/+/, '')}`;
      if (failed) return isUrl(icon.emoji) ? <span style={{ width: size, height: size }} /> : fallback;
      return <img src={src} width={size} height={size} alt="" draggable={false} style={{ objectFit: 'cover' }} onError={() => setFailed(true)} />;
    }
  }
}
