import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { FlowyText } from './FlowyText';
import { Tooltip } from './Tooltip';

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

/** FlowyHover (style_widget/hover.dart). */
export function FlowyHover({
  children,
  isSelected,
  hoverColor,
  foregroundColorOnHover,
  keepForegroundOnHover,
  backgroundColor,
  borderRadius = 6,
  border,
  cursor,
  className,
  style,
  ...handlers
}: FlowyHoverProps) {
  return (
    <div
      className={`flowy-hover${className ? ` ${className}` : ''}`}
      data-selected={isSelected ? 'true' : undefined}
      data-keep-fg={keepForegroundOnHover ? 'true' : undefined}
      style={
        {
          '--hover-bg': hoverColor,
          '--hover-fg': foregroundColorOnHover,
          '--hover-base': backgroundColor,
          '--hover-radius': `${borderRadius}px`,
          border,
          cursor,
          ...style,
        } as CSSProperties
      }
      {...handlers}
    >
      {children}
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

/** FlowyButton (style_widget/button.dart): leftIcon 16×16, gap 6, padding 6/4, radius 6. */
export function FlowyButton({
  text,
  onTap,
  onSecondaryTap,
  leftIcon,
  leftIconSize = 16,
  rightIcon,
  margin = '4px 6px',
  iconPadding = 6,
  hoverColor,
  backgroundColor,
  borderColor,
  radius = 6,
  isSelected,
  disable,
  useIntrinsicWidth,
  expandText = true,
  height,
  tooltip,
  className,
  style,
}: FlowyButtonProps) {
  const content = (
    <FlowyHover
      className={className}
      isSelected={isSelected}
      hoverColor={hoverColor}
      backgroundColor={backgroundColor}
      borderRadius={radius}
      border={borderColor ? `1px solid ${borderColor}` : undefined}
      cursor={disable ? 'not-allowed' : undefined}
      onClick={disable ? undefined : onTap}
      onContextMenu={
        onSecondaryTap && !disable
          ? (event) => {
              event.preventDefault();
              onSecondaryTap(event);
            }
          : undefined
      }
      style={{
        display: useIntrinsicWidth ? 'inline-flex' : 'flex',
        alignItems: 'center',
        padding: margin,
        height,
        minWidth: 0,
        ...style,
      }}
    >
      {leftIcon && (
        <div
          style={{
            width: leftIconSize,
            height: leftIconSize,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: iconPadding,
            flexShrink: 0,
          }}
        >
          {leftIcon}
        </div>
      )}
      <div style={{ flex: expandText && !useIntrinsicWidth ? 1 : undefined, minWidth: 0, display: 'flex' }}>
        {typeof text === 'string' ? <FlowyText>{text}</FlowyText> : text}
      </div>
      {rightIcon && <div style={{ marginLeft: iconPadding, display: 'flex', flexShrink: 0 }}>{rightIcon}</div>}
    </FlowyHover>
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

/** FlowyIconButton (style_widget/icon_button.dart). The icon keeps its color on hover by default. */
export function FlowyIconButton({
  icon,
  onPressed,
  width = 30,
  height,
  fillColor = 'transparent',
  hoverColor,
  iconColorOnHover,
  iconPadding = 0,
  radius = 6,
  tooltip,
  preferBelow,
  isSelected,
  style,
}: FlowyIconButtonProps) {
  const button = (
    <FlowyHover
      isSelected={isSelected}
      hoverColor={hoverColor}
      foregroundColorOnHover={iconColorOnHover}
      keepForegroundOnHover={iconColorOnHover === undefined}
      backgroundColor={fillColor}
      borderRadius={radius}
      cursor={onPressed ? 'pointer' : 'default'}
      onClick={onPressed}
      style={{
        width,
        height: height ?? width,
        padding: iconPadding,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        ...style,
      }}
    >
      {icon}
    </FlowyHover>
  );
  return tooltip ? (
    <Tooltip rich={tooltip} preferBelow={preferBelow}>
      {button}
    </Tooltip>
  ) : (
    button
  );
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

/** FlowyTextButton (Material TextButton). */
export function FlowyTextButton({
  text,
  onPressed,
  fontSize = 14,
  fontWeight = 500,
  fontColor,
  fontHoverColor,
  fillColor,
  hoverColor,
  borderColor,
  padding = '6px 8px',
  radius = 6,
  minHeight,
  isDangerous,
  heading,
  tooltip,
  style,
}: FlowyTextButtonProps) {
  const button = (
    <button
      className="af-button"
      onClick={onPressed}
      style={
        {
          '--btn-bg': fillColor ?? (isDangerous ? 'transparent' : 'var(--cs-secondary-container)'),
          '--btn-bg-hover': hoverColor ?? (isDangerous ? 'var(--cs-error)' : 'var(--cs-secondary)'),
          '--btn-border': borderColor ?? (isDangerous ? 'var(--cs-error)' : 'transparent'),
          '--btn-fg': fontColor ?? 'var(--cs-on-surface)',
          '--btn-fg-hover': fontHoverColor ?? fontColor ?? 'var(--cs-on-surface)',
          '--btn-radius': `${radius}px`,
          padding,
          minHeight,
          fontSize: `calc(${fontSize}px * var(--text-scale, 1))`,
          fontWeight,
          lineHeight: 1.1,
          justifyContent: 'flex-start',
          cursor: onPressed ? 'pointer' : 'default',
          ...style,
        } as CSSProperties
      }
    >
      {heading && <span style={{ marginRight: 8, display: 'flex' }}>{heading}</span>}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'center' }}>{text}</span>
    </button>
  );
  return tooltip ? <Tooltip message={tooltip}>{button}</Tooltip> : button;
}

// ---- appflowy_ui buttons -------------------------------------------------------------

export type AFButtonSize = 's' | 'm' | 'l' | 'xl';

const SIZE: Record<AFButtonSize, { padding: string; radius: number; fontSize: number; lineHeight: number }> = {
  s: { padding: '4px 12px', radius: 8, fontSize: 14, lineHeight: 20 },
  m: { padding: '6px 16px', radius: 8, fontSize: 14, lineHeight: 20 },
  l: { padding: '10px 16px', radius: 10, fontSize: 14, lineHeight: 20 },
  xl: { padding: '14px 16px', radius: 16, fontSize: 20, lineHeight: 28 },
};

type Palette = {
  border?: string;
  borderHover?: string;
  borderDisabled?: string;
  bg?: string;
  bgHover?: string;
  bgDisabled?: string;
  fg?: string;
  fgHover?: string;
  fgDisabled?: string;
};

const PALETTES = {
  filledPrimary: {
    bg: 'var(--af-fill-theme-thick)',
    bgHover: 'var(--af-fill-theme-thick-hover)',
    bgDisabled: 'var(--af-fill-content-hover)',
    fg: 'var(--af-text-on-fill)',
    fgDisabled: 'var(--af-text-tertiary)',
  },
  filledDestructive: {
    bg: 'var(--af-fill-error-thick)',
    bgHover: 'var(--af-text-error-hover)',
    bgDisabled: 'var(--af-fill-content-hover)',
    fg: 'var(--af-text-on-fill)',
    fgDisabled: 'var(--af-text-tertiary)',
  },
  outlinedNormal: {
    border: 'var(--af-border-primary)',
    borderHover: 'var(--af-border-primary-hover)',
    borderDisabled: 'var(--af-border-primary)',
    bg: 'transparent',
    bgHover: 'var(--af-fill-content-hover)',
    bgDisabled: 'transparent',
    fg: 'var(--af-text-primary)',
    fgDisabled: 'var(--af-text-tertiary)',
  },
  outlinedDestructive: {
    border: 'var(--af-fill-error-thick)',
    borderHover: 'var(--af-text-error-hover)',
    bg: 'transparent',
    bgHover: 'var(--af-fill-error-select)',
    fg: 'var(--af-text-error)',
  },
  ghostPrimary: {
    bg: 'transparent',
    bgHover: 'var(--af-fill-content-hover)',
    fg: 'var(--af-text-primary)',
    fgDisabled: 'var(--af-text-tertiary)',
  },
} satisfies Record<string, Palette>;

export type AFButtonVariant = keyof typeof PALETTES;

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

/** AFFilledTextButton / AFOutlinedTextButton / AFGhostTextButton and their icon variants. */
export function AFButton({
  variant,
  text,
  children,
  onTap,
  size = 'm',
  padding,
  borderRadius,
  disabled,
  minWidth,
  fullWidth,
  icon,
  iconGap,
  textColor,
  justify = 'center',
  style,
  type = 'button',
}: AFButtonProps) {
  const s = SIZE[size];
  const p: Palette = PALETTES[variant];
  return (
    <button
      type={type}
      className="af-button"
      data-disabled={disabled ? 'true' : undefined}
      onClick={disabled ? undefined : onTap}
      style={
        {
          '--btn-border': p.border ?? 'transparent',
          '--btn-border-hover': p.borderHover,
          '--btn-border-disabled': p.borderDisabled,
          '--btn-bg': p.bg,
          '--btn-bg-hover': p.bgHover,
          '--btn-bg-disabled': p.bgDisabled,
          '--btn-fg': textColor ?? p.fg,
          '--btn-fg-hover': textColor ?? p.fgHover,
          '--btn-fg-disabled': p.fgDisabled,
          '--btn-radius': `${borderRadius ?? s.radius}px`,
          padding: padding ?? s.padding,
          fontSize: `calc(${s.fontSize}px * var(--text-scale, 1))`,
          lineHeight: `${s.lineHeight}px`,
          minWidth: minWidth ?? (text && !icon ? 76 : undefined),
          width: fullWidth ? '100%' : undefined,
          justifyContent: justify,
          gap: icon ? (iconGap ?? (variant.startsWith('ghost') ? 8 : 6)) : undefined,
          ...style,
        } as CSSProperties
      }
    >
      {icon}
      {text !== undefined ? <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{text}</span> : children}
    </button>
  );
}

// ---- PopoverActionList rows ------------------------------------------------------------

export interface ActionRowProps {
  name: string;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  textColor?: string;
  onTap?: (event: MouseEvent) => void;
}

/** HoverButton (pop_up_action.dart): 32px rows, padding 6/10, gaps 10. */
export function ActionRow({ name, leftIcon, rightIcon, textColor, onTap }: ActionRowProps) {
  return (
    <FlowyHover
      onClick={onTap}
      foregroundColorOnHover="var(--cs-on-surface)"
      style={{ padding: '6px 10px', display: 'flex', alignItems: 'center', height: 32 }}
    >
      {leftIcon && <div style={{ display: 'flex', marginRight: 10, ['--icon-color' as string]: 'var(--cs-on-surface)' }}>{leftIcon}</div>}
      <FlowyText color={textColor} lineHeight={16} style={{ overflow: 'visible', flex: 1 }}>
        {name}
      </FlowyText>
      {rightIcon && <div style={{ display: 'flex', marginLeft: 10 }}>{rightIcon}</div>}
    </FlowyHover>
  );
}
