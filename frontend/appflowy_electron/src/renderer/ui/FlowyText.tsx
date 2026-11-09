import type { CSSProperties, ReactNode } from 'react';
import { Tooltip } from './Tooltip';

export interface FlowyTextProps {
  children?: ReactNode;
  /** Default 14 (TT.bodyMedium); the `small` variant is fixed at 12. */
  fontSize?: number;
  fontWeight?: 400 | 500 | 600 | 700;
  color?: string;
  /** figmaLineHeight: line-height in px. */
  lineHeight?: number;
  /** 1 by default, as in Flutter; null = unlimited lines. */
  maxLines?: number | null;
  /** TextOverflow.ellipsis (default clip). */
  ellipsis?: boolean;
  textAlign?: CSSProperties['textAlign'];
  decoration?: CSSProperties['textDecoration'];
  fontFamily?: string;
  withTooltip?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** FlowyText (packages/flowy_infra_ui/lib/style_widget/text.dart). */
export function FlowyText({
  children,
  fontSize = 14,
  fontWeight = 400,
  color,
  lineHeight,
  maxLines = 1,
  ellipsis,
  textAlign,
  decoration,
  fontFamily,
  withTooltip,
  className,
  style,
}: FlowyTextProps) {
  const multiline = maxLines === null || maxLines > 1;
  const text = (
    <div
      className={`flowy-text${className ? ` ${className}` : ''}`}
      data-ellipsis={ellipsis ? 'true' : undefined}
      data-multiline={multiline ? 'true' : undefined}
      style={{
        fontSize: `calc(${fontSize}px * var(--text-scale, 1))`,
        fontWeight,
        color,
        lineHeight: lineHeight ? `${lineHeight}px` : undefined,
        textAlign,
        textDecoration: decoration,
        fontFamily,
        ...(multiline && maxLines
          ? { display: '-webkit-box', WebkitLineClamp: maxLines, WebkitBoxOrient: 'vertical', overflow: 'hidden' }
          : null),
        ...style,
      }}
    >
      {children}
    </div>
  );
  if (withTooltip && typeof children === 'string') return <Tooltip message={children}>{text}</Tooltip>;
  return text;
}

type Variant = Omit<FlowyTextProps, 'fontWeight'>;
FlowyText.regular = (props: Variant) => <FlowyText {...props} fontWeight={400} />;
FlowyText.medium = (props: Variant) => <FlowyText {...props} fontWeight={500} />;
FlowyText.semibold = (props: Variant) => <FlowyText {...props} fontWeight={600} />;
FlowyText.small = (props: Omit<Variant, 'fontSize'>) => <FlowyText {...props} fontSize={12} fontWeight={400} />;

export const VSpace = ({ size }: { size: number }) => <div style={{ height: size, flexShrink: 0 }} />;
export const HSpace = ({ size }: { size: number }) => <div style={{ width: size, flexShrink: 0 }} />;

/** FlowyDivider: 1px AFX.borderColor. */
export const FlowyDivider = ({ margin }: { margin?: CSSProperties['margin'] }) => (
  <div style={{ height: 1, background: 'var(--afx-border)', margin, flexShrink: 0 }} />
);

/** AFDivider: 1px AF.border.primary. */
export const AFDivider = ({ spacing = 0, vertical }: { spacing?: number; vertical?: boolean }) =>
  vertical ? (
    <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--af-border-primary)', margin: `0 ${spacing}px` }} />
  ) : (
    <div style={{ height: 1, background: 'var(--af-border-primary)', margin: `${spacing}px 0`, flexShrink: 0 }} />
  );

/** Material CircularProgressIndicator.adaptive (36px default). */
export function Spinner({ size = 36, stroke = 4, color }: { size?: number; stroke?: number; color?: string }) {
  return (
    <div
      className="flowy-spinner"
      style={{ width: size, height: size, borderWidth: stroke, ...(color ? { ['--spinner-color' as string]: color } : null) }}
    />
  );
}
