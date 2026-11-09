// Local primitives for the sidebar (Flutter widgets the shared @/ui layer does not cover).
import { useRef, type CSSProperties, type MouseEvent, type ReactNode, type Ref } from 'react';
import type { FlowySvgName } from '@/icons/flowy-svgs';
import {
  AppFlowyPopover,
  FlowyDivider,
  FlowySvg,
  FlowyText,
  Spinner,
  Tooltip,
  showDialog,
  type PopoverController,
  type PopoverDirection,
  type PopoverMutex,
} from '@/ui';
import './sidebar.css';

export const isMac = navigator.userAgent.includes('Mac');

/** A rich tooltip: the label, then the shortcut in Theme.hintColor (sidebar tooltips). */
export function hintTooltip(label: string, shortcut: string): ReactNode {
  return (
    <>
      {label}
      {'\n'}
      <span style={{ color: 'var(--th-hint)' }}>{shortcut}</span>
    </>
  );
}

export interface SbIconButtonProps {
  icon: ReactNode;
  onPressed?: (event: MouseEvent) => void;
  /** FlowyIconButton default 30. */
  width?: number;
  height?: number;
  iconPadding?: CSSProperties['padding'];
  tooltip?: ReactNode;
  preferBelow?: boolean;
  isSelected?: boolean;
  hoverColor?: string;
  radius?: number;
  className?: string;
  style?: CSSProperties;
}

/** FlowyIconButton (style_widget/icon_button.dart): hover fill, the icon keeps its color. */
export function SbIconButton({
  icon,
  onPressed,
  width = 30,
  height,
  iconPadding = 0,
  tooltip,
  preferBelow,
  isSelected,
  hoverColor,
  radius = 6,
  className,
  style,
}: SbIconButtonProps) {
  const button = (
    <div
      className={`sb-icon-button${className ? ` ${className}` : ''}`}
      data-selected={isSelected ? 'true' : undefined}
      onClick={(event) => {
        event.stopPropagation();
        onPressed?.(event);
      }}
      style={
        {
          width,
          height: height ?? width,
          padding: iconPadding,
          borderRadius: radius,
          '--sb-hover-bg': hoverColor,
          ...style,
        } as CSSProperties
      }
    >
      {icon}
    </div>
  );
  return tooltip ? (
    <Tooltip rich={tooltip} preferBelow={preferBelow}>
      {button}
    </Tooltip>
  ) : (
    button
  );
}

export interface MenuItemProps {
  icon?: FlowySvgName;
  iconNode?: ReactNode;
  name: string;
  onTap?: () => void;
  /** delete/leave: icon and text turn colorScheme.error on hover. */
  danger?: boolean;
  disabled?: boolean;
  /** Item height including the 2px vertical padding (34 by default). */
  height?: number;
  margin?: CSSProperties['padding'];
  tooltip?: string;
}

/**
 * A FlowyIconTextButton row inside `Container(height: 34, padding: vertical 2)`: margin h6,
 * icon 16, gap 10, FlowyText.regular 14 / 18 (ViewMoreActionTypeWrapper, SpaceMoreActionTypeWrapper).
 */
export function MenuItem({ icon, iconNode, name, onTap, danger, disabled, height = 34, margin = '0 6px', tooltip }: MenuItemProps) {
  const row = (
    <div style={{ height, padding: '2px 0', flexShrink: 0, opacity: disabled ? 0.3 : 1 }}>
      <div
        className={disabled ? undefined : `flowy-hover${danger ? ' sb-danger' : ''}`}
        onClick={disabled ? undefined : onTap}
        style={{
          height: '100%',
          padding: margin,
          display: 'flex',
          alignItems: 'center',
          borderRadius: 6,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        <div style={{ width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {iconNode ?? (icon && <FlowySvg svg={icon} />)}
        </div>
        <div style={{ width: 10, flexShrink: 0 }} />
        <FlowyText lineHeight={18} style={{ flex: 1 }}>
          {name}
        </FlowyText>
      </div>
    </div>
  );
  return tooltip ? <Tooltip message={tooltip}>{row}</Tooltip> : row;
}

/** `Padding(all 8) > FlowyDivider` between menu groups. */
export const MenuDivider = () => (
  <div style={{ padding: 8, flexShrink: 0 }}>
    <FlowyDivider />
  </div>
);

export interface ActionListPopoverProps {
  children: ReactNode;
  popup: (close: () => void) => ReactNode;
  controllerRef?: Ref<PopoverController>;
  direction?: PopoverDirection;
  offset?: { x: number; y: number };
  constraints?: { minWidth?: number; maxWidth?: number; maxHeight?: number };
  mutex?: PopoverMutex;
  asBarrier?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
  triggerStyle?: CSSProperties;
}

/**
 * PopoverActionList: an AppFlowyPopover opened through its controller, items in a column.
 * Given constraints replace the default ones (BoxConstraints(minWidth: 260) has no max).
 */
export function ActionListPopover({
  children,
  popup,
  controllerRef,
  direction = 'rightWithTopAligned',
  offset,
  constraints = { minWidth: 120, maxWidth: 460, maxHeight: 300 },
  mutex,
  asBarrier,
  onOpen,
  onClose,
  triggerStyle,
}: ActionListPopoverProps) {
  return (
    <AppFlowyPopover
      controllerRef={controllerRef}
      trigger="none"
      direction={direction}
      offset={offset}
      constraints={constraints}
      mutex={mutex}
      asBarrier={asBarrier}
      onOpen={onOpen}
      onClose={onClose}
      triggerStyle={triggerStyle}
      popup={popup}
    >
      {children}
    </AppFlowyPopover>
  );
}

/** A PopoverController ref with show/close helpers. */
export function usePopoverController() {
  return useRef<PopoverController>(null);
}

/** Loading(context): a non-dismissible transparent dialog with a centered spinner. */
export function showLoading(): () => void {
  return showDialog(() => <Spinner />, { barrierColor: 'transparent', barrierDismissible: false });
}

/** FlowyTextField: 32px max, padding h12, outline border (primary when focused). */
export function FlowyTextField({
  value,
  defaultValue,
  hintText,
  autoFocus = true,
  maxLength,
  selectAll,
  enableBorderColor,
  onChanged,
  onSubmitted,
  onCanceled,
  inputRef,
  style,
}: {
  value?: string;
  defaultValue?: string;
  hintText?: string;
  autoFocus?: boolean;
  maxLength?: number;
  selectAll?: boolean;
  enableBorderColor?: string;
  onChanged?: (value: string) => void;
  onSubmitted?: (value: string) => void;
  /** Focus lost without submitting (FlowyTextField.onCanceled). */
  onCanceled?: (value: string) => void;
  inputRef?: Ref<HTMLInputElement>;
  style?: CSSProperties;
}) {
  return (
    <input
      ref={(el) => {
        if (typeof inputRef === 'function') inputRef(el);
        else if (inputRef) (inputRef as { current: HTMLInputElement | null }).current = el;
        if (el && autoFocus && !el.dataset.focused) {
          el.dataset.focused = 'true';
          requestAnimationFrame(() => {
            el.focus();
            if (selectAll) el.select();
            else el.setSelectionRange(el.value.length, el.value.length);
          });
        }
      }}
      className="sb-text-field"
      value={value}
      defaultValue={defaultValue}
      placeholder={hintText}
      maxLength={maxLength}
      spellCheck={false}
      onChange={(event) => onChanged?.(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onSubmitted?.(event.currentTarget.value);
      }}
      onBlur={(event) => onCanceled?.(event.currentTarget.value)}
      style={{ ...(enableBorderColor ? ({ '--sb-field-border': enableBorderColor } as CSSProperties) : null), ...style }}
    />
  );
}
