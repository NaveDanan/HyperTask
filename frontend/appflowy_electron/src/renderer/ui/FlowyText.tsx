import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { Spinner as HyperSpinner } from '@/components/ui/spinner';
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
  fontSize,
  fontWeight,
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
      className={cn('min-w-0 overflow-hidden text-sm font-normal text-foreground', multiline ? 'whitespace-pre-wrap wrap-anywhere' : 'whitespace-nowrap', ellipsis ? 'text-ellipsis' : 'text-clip', color?.includes('var(') && /secondary|tertiary|hint|muted/.test(color) && 'text-muted-foreground', className)}
      data-ellipsis={ellipsis ? 'true' : undefined}
      data-multiline={multiline ? 'true' : undefined}
      style={{
        fontSize,
        fontWeight,
        color: color?.includes('var(') ? undefined : color,
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
FlowyText.small = (props: Omit<Variant, 'fontSize'>) => <FlowyText {...props} className={cn('text-xs', props.className)} fontWeight={400} />;

export const VSpace = ({ size }: { size: number }) => <div className="shrink-0" style={{ height: size }} />;
export const HSpace = ({ size }: { size: number }) => <div className="shrink-0" style={{ width: size }} />;

export const FlowyDivider = ({ margin }: { margin?: CSSProperties['margin'] }) => <Separator style={{ margin }} />;

export const AFDivider = ({ spacing = 0, vertical }: { spacing?: number; vertical?: boolean }) => (
  <Separator orientation={vertical ? 'vertical' : 'horizontal'} style={{ margin: vertical ? '0 ' + spacing + 'px' : spacing + 'px 0' }} />
);

export function Spinner({ size = 36, stroke = 4, color }: { size?: number; stroke?: number; color?: string }) {
  return <HyperSpinner className="text-primary" strokeWidth={stroke} style={{ width: size, height: size, color: color?.includes('var(') ? undefined : color }} />;
}
