import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { MenuRow, menuRowClass } from '@/components/app/menu-row';
import { cn } from '@/lib/utils';
import { Tooltip } from './Tooltip';

// Legacy theme overrides yield to the new tokens; caller-provided colours still work.
const customColor = (color?: string) => color?.includes('var(') ? undefined : color;

export interface FlowyHoverProps {
  children: ReactNode;
  isSelected?: boolean;
  hoverColor?: string;
  foregroundColorOnHover?: string;
  /** Keep the text/icon colors on hover (e.g. FlowyIconButton's default iconColorOnHover). */
  keepForegroundOnHover?: boolean;
  backgroundColor?: string;
  borderRadius?: number;
  border?: string;
  cursor?: CSSProperties['cursor'];
  className?: string;
  style?: CSSProperties;
  onClick?: (event: MouseEvent) => void;
  onContextMenu?: (event: MouseEvent) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

/** Compatibility wrapper for hoverable layout and drag-and-drop content. */
export function FlowyHover(props: FlowyHoverProps) {
  const hoverColor = customColor(props.hoverColor);
  const foreground = customColor(props.foregroundColorOnHover);
  return (
    <div
      className={cn(
        'rounded-md cursor-pointer transition-colors hover:bg-accent',
        props.isSelected && 'bg-accent',
        hoverColor && 'hover:bg-(--hyper-hover-bg) data-[selected=true]:bg-(--hyper-hover-bg)',
        !props.keepForegroundOnHover && foreground && 'hover:text-(--hyper-hover-fg) data-[selected=true]:text-(--hyper-hover-fg)',
        props.className,
      )}
      data-selected={props.isSelected ? 'true' : undefined}
      data-keep-fg={props.keepForegroundOnHover ? 'true' : undefined}
      style={{
        '--hyper-hover-bg': hoverColor,
        '--hyper-hover-fg': foreground,
        backgroundColor: customColor(props.backgroundColor),
        borderRadius: props.borderRadius,
        border: customColor(props.border),
        cursor: props.cursor,
        ...props.style,
      } as CSSProperties}
      onClick={props.onClick}
      onContextMenu={props.onContextMenu}
      onMouseEnter={props.onMouseEnter}
      onMouseLeave={props.onMouseLeave}
    >
      {props.children}
    </div>
  );
}

export interface FlowyButtonProps {
  text: ReactNode;
  onTap?: (event: MouseEvent) => void;
  onSecondaryTap?: (event: MouseEvent) => void;
  leftIcon?: ReactNode;
  leftIconSize?: number;
  rightIcon?: ReactNode;
  /** Inner padding, default 4px 6px. */
  margin?: CSSProperties['padding'];
  iconPadding?: number;
  hoverColor?: string;
  backgroundColor?: string;
  borderColor?: string;
  radius?: number;
  isSelected?: boolean;
  disable?: boolean;
  /** useIntrinsicWidth: shrink to content. */
  useIntrinsicWidth?: boolean;
  expandText?: boolean;
  height?: number;
  tooltip?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function FlowyButton({
  text, onTap, onSecondaryTap, leftIcon, leftIconSize = 16, rightIcon,
  margin, iconPadding, hoverColor, backgroundColor, borderColor, radius,
  isSelected, disable, useIntrinsicWidth, expandText = true, height, tooltip, className, style,
}: FlowyButtonProps) {
  const hover = customColor(hoverColor);
  const border = customColor(borderColor);
  const content = (
    <button
      type="button"
      className={cn(menuRowClass, 'transition-colors', useIntrinsicWidth && 'inline-flex w-auto', hover && 'hover:bg-(--hyper-hover-bg)', className)}
      data-highlighted={isSelected ? 'true' : undefined}
      data-selected={isSelected ? 'true' : undefined}
      data-disabled={disable ? 'true' : undefined}
      disabled={disable}
      onClick={disable ? undefined : onTap}
      onContextMenu={onSecondaryTap && !disable ? (event) => { event.preventDefault(); onSecondaryTap(event); } : undefined}
      style={{
        '--hyper-hover-bg': hover,
        backgroundColor: customColor(backgroundColor),
        border: border ? '1px solid ' + border : undefined,
        borderRadius: radius, padding: margin, height, gap: iconPadding,
        ...style,
      } as CSSProperties}
    >
      {leftIcon && <span className="flex shrink-0 items-center justify-center text-muted-foreground" style={{ width: leftIconSize, height: leftIconSize }}>{leftIcon}</span>}
      <span className={cn('flex min-w-0', expandText && !useIntrinsicWidth && 'flex-1')}>
        {typeof text === 'string' ? <span className="truncate">{text}</span> : text}
      </span>
      {rightIcon && <span className="flex shrink-0">{rightIcon}</span>}
    </button>
  );
  return tooltip ? <Tooltip rich={tooltip}>{content}</Tooltip> : content;
}

export interface FlowyIconButtonProps {
  icon: ReactNode;
  onPressed?: (event: MouseEvent) => void;
  /** Default 30 (square unless height is given). */
  width?: number;
  height?: number;
  fillColor?: string;
  hoverColor?: string;
  iconColorOnHover?: string;
  iconPadding?: CSSProperties['padding'];
  radius?: number;
  tooltip?: ReactNode;
  preferBelow?: boolean;
  isSelected?: boolean;
  style?: CSSProperties;
}

export function FlowyIconButton({
  icon, onPressed, width = 30, height, fillColor, hoverColor, iconColorOnHover,
  iconPadding, radius, tooltip, preferBelow, isSelected, style,
}: FlowyIconButtonProps) {
  const hover = customColor(hoverColor);
  const foreground = customColor(iconColorOnHover);
  const button = (
    <button
      type="button"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg:not([class*=size-])]:size-4',
        isSelected && 'bg-accent text-foreground',
        hover && 'hover:bg-(--hyper-hover-bg)',
        foreground && 'hover:text-(--hyper-hover-fg)',
      )}
      data-selected={isSelected ? 'true' : undefined}
      data-keep-fg={iconColorOnHover === undefined ? 'true' : undefined}
      onClick={onPressed}
      style={{
        '--hyper-hover-bg': hover,
        '--hyper-hover-fg': foreground,
        backgroundColor: customColor(fillColor),
        width, height: height ?? width, padding: iconPadding, borderRadius: radius,
        ...style,
      } as CSSProperties}
    >
      {icon}
    </button>
  );
  return tooltip ? <Tooltip rich={tooltip} preferBelow={preferBelow}>{button}</Tooltip> : button;
}

export interface FlowyTextButtonProps {
  text: string;
  onPressed?: () => void;
  fontSize?: number;
  fontWeight?: 400 | 500 | 600;
  fontColor?: string;
  fontHoverColor?: string;
  fillColor?: string;
  hoverColor?: string;
  borderColor?: string;
  padding?: CSSProperties['padding'];
  radius?: number;
  minHeight?: number;
  isDangerous?: boolean;
  heading?: ReactNode;
  tooltip?: string;
  style?: CSSProperties;
}

export function FlowyTextButton({
  text, onPressed, fontSize, fontWeight, fontColor, fontHoverColor, fillColor,
  hoverColor, borderColor, padding, radius, minHeight, isDangerous, heading, tooltip, style,
}: FlowyTextButtonProps) {
  const hover = customColor(hoverColor);
  const foreground = customColor(fontHoverColor);
  const border = customColor(borderColor);
  const button = (
    <Button
      type="button"
      variant="ghost"
      className={cn('justify-start gap-2 transition-colors', isDangerous && 'text-destructive hover:bg-destructive/10 hover:text-destructive', hover && 'hover:bg-(--hyper-hover-bg)', foreground && 'hover:text-(--hyper-hover-fg)')}
      onClick={onPressed}
      style={{
        '--hyper-hover-bg': hover,
        '--hyper-hover-fg': foreground,
        color: customColor(fontColor), backgroundColor: customColor(fillColor),
        border: border ? '1px solid ' + border : undefined,
        padding, borderRadius: radius, minHeight, fontSize, fontWeight,
        ...style,
      } as CSSProperties}
    >
      {heading && <span className="flex">{heading}</span>}
      <span className="truncate text-center">{text}</span>
    </Button>
  );
  return tooltip ? <Tooltip message={tooltip}>{button}</Tooltip> : button;
}

export type AFButtonSize = 's' | 'm' | 'l' | 'xl';
export type AFButtonVariant = 'filledPrimary' | 'filledDestructive' | 'outlinedNormal' | 'outlinedDestructive' | 'ghostPrimary';

export interface AFButtonProps {
  variant: AFButtonVariant;
  text?: string;
  children?: ReactNode;
  onTap?: () => void;
  size?: AFButtonSize;
  padding?: CSSProperties['padding'];
  borderRadius?: number;
  disabled?: boolean;
  /** The *TextButton variants have a min width of 76. */
  minWidth?: number;
  fullWidth?: boolean;
  icon?: ReactNode;
  /** Gap between icon and text: 6 (filled/outlined) or 8 (ghost). */
  iconGap?: number;
  textColor?: string;
  justify?: CSSProperties['justifyContent'];
  style?: CSSProperties;
  type?: 'button' | 'submit';
}

export function AFButton({
  variant, text, children, onTap, size = 'm', padding, borderRadius, disabled,
  minWidth, fullWidth, icon, iconGap, textColor, justify, style, type = 'button',
}: AFButtonProps) {
  const destructive = variant.endsWith('Destructive');
  const mappedVariant = destructive ? 'destructive' : variant.startsWith('outlined') ? 'outline' : variant.startsWith('ghost') ? 'ghost' : 'default';
  return (
    <Button
      type={type}
      variant={mappedVariant}
      size={size === 's' ? 'sm' : size === 'l' || size === 'xl' ? 'lg' : 'default'}
      className={cn(
        'transition-colors', size === 's' && 'rounded-lg text-sm', (size === 'l' || size === 'xl') && 'h-10',
        fullWidth && 'w-full', icon && variant.startsWith('ghost') && 'gap-2',
        destructive && 'bg-destructive text-white hover:bg-destructive/90 dark:bg-destructive dark:hover:bg-destructive/90',
      )}
      data-disabled={disabled ? 'true' : undefined}
      disabled={disabled}
      onClick={disabled ? undefined : onTap}
      style={{
        padding, borderRadius, minWidth: minWidth ?? (text && !icon ? 76 : undefined),
        color: customColor(textColor), justifyContent: justify, gap: iconGap,
        ...style,
      }}
    >
      {icon}
      {text !== undefined ? <span className="truncate">{text}</span> : children}
    </Button>
  );
}

export interface ActionRowProps {
  name: string;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  textColor?: string;
  onTap?: (event: MouseEvent) => void;
}

export function ActionRow({ name, leftIcon, rightIcon, textColor, onTap }: ActionRowProps) {
  return <MenuRow label={name} icon={leftIcon} trailing={rightIcon} onClick={onTap} style={{ color: customColor(textColor) }} />;
}
