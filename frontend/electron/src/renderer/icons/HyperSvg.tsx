import type { CSSProperties } from 'react';
import { HyperSvgs, type HyperSvgName } from './hyper-svgs';

const urls = import.meta.glob('@resources/hyper_icons/**/*.svg', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const urlByPath = new Map<string, string>();
for (const [key, url] of Object.entries(urls)) {
  const index = key.lastIndexOf('hyper_icons/');
  urlByPath.set(key.slice(index + 'hyper_icons/'.length), url);
}

export function hyperSvgUrl(name: HyperSvgName): string {
  return urlByPath.get(HyperSvgs[name].path) ?? '';
}

export interface HyperSvgProps {
  svg: HyperSvgName;
  /** Square size, or explicit width/height. Defaults to the SVG's intrinsic size. */
  size?: number | { width: number; height: number };
  /** Tint color; defaults to the theme icon color, as Flutter's IconTheme does. */
  color?: string;
  /**
   * 'srcIn' tints the icon with `color` (Flutter's default BlendMode.srcIn).
   * null renders the SVG's own colors.
   */
  blendMode?: 'srcIn' | null;
  opacity?: number;
  className?: string;
  style?: CSSProperties;
}

/** Counterpart of HyperSvg in packages/hyper_svg. */
export function HyperSvg({ svg, size, color, blendMode = 'srcIn', opacity, className, style }: HyperSvgProps) {
  const data = HyperSvgs[svg];
  const url = hyperSvgUrl(svg);
  const width = typeof size === 'number' ? size : (size?.width ?? data.width);
  const height = typeof size === 'number' ? size : (size?.height ?? data.height);

  if (blendMode === null) {
    return (
      <img
        src={url}
        width={width}
        height={height}
        alt=""
        draggable={false}
        className={className}
        style={{ flexShrink: 0, opacity, ...style }}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={className}
      style={{
        display: 'inline-block',
        flexShrink: 0,
        width,
        height,
        backgroundColor: color ?? 'var(--icon-color)',
        WebkitMaskImage: `url("${url}")`,
        WebkitMaskSize: '100% 100%',
        WebkitMaskRepeat: 'no-repeat',
        opacity,
        ...style,
      }}
    />
  );
}
