// Local primitives for the sidebar (Flutter widgets the shared @/ui layer does not cover).
import { useRef, type CSSProperties, type MouseEvent, type ReactNode, type Ref } from 'react';
import type { FlowySvgName } from '@/icons/flowy-svgs';
import { CalendarDays, ChevronsDownUp, Copy, FileText, FolderInput, Info, Lock, LockOpen, MessageSquareText, PencilLine, Plus, SlidersHorizontal, SmilePlus, SquareArrowOutUpRight, SquareKanban, Star, Table2, Trash2, type LucideIcon } from 'lucide-react';
import { NavIconButton } from '@/components/app/nav';
import { floatingSurfaceClass, MenuRow, MenuSeparator } from '@/components/app/menu-row';
import { ShortcutKeys } from '@/components/app/shortcut';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import {
  AppFlowyPopover,
  Tooltip,
  showDialog,
  type PopoverController,
  type PopoverDirection,
  type PopoverMutex,
} from '@/ui';

export const isMac = navigator.userAgent.includes('Mac');

/** The label followed by keyboard caps, matching the app tooltip recipe. */
export function hintTooltip(label: string, shortcut: string): ReactNode {
  return (
    <span className="flex items-center gap-2">
      {label}
      <ShortcutKeys keys={shortcut} className="[&_kbd]:bg-background/20 [&_kbd]:text-background" />
    </span>
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

/** Compatibility wrapper for existing sidebar callers, using the shared nav control. */
export function SbIconButton({
  icon, onPressed, width, height, iconPadding, tooltip, preferBelow, isSelected,
  hoverColor: _hoverColor, radius: _radius, className, style,
}: SbIconButtonProps) {
  const button = (
    <NavIconButton
      className={cn(isSelected && 'bg-sidebar-accent text-sidebar-accent-foreground', className)}
      data-selected={isSelected ? 'true' : undefined}
      onClick={(event) => {
        event.stopPropagation();
        onPressed?.(event);
      }}
      style={{ ...(width === undefined ? null : { width, height: height ?? width }),
        ...(height === undefined ? null : { height }),
        ...(iconPadding === undefined ? null : { padding: iconPadding }), ...style }}
    >
      {icon}
    </NavIconButton>
  );
  return tooltip ? <Tooltip rich={tooltip} preferBelow={preferBelow}>{button}</Tooltip> : button;
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

// Legacy identifiers remain valid at the API boundary; chrome renders with lucide.
const hyperMenuIcons: Partial<Record<FlowySvgName, LucideIcon>> = {
  favorite_s: Star, unfavorite_s: Star, view_item_rename_s: PencilLine, rename_s: PencilLine,
  change_icon_s: SmilePlus, duplicate_s: Copy, copy_s: Copy, move_to_s: FolderInput,
  trash_s: Trash2, delete_s: Trash2, collapse_all_page_s: ChevronsDownUp,
  view_item_open_in_new_tab_s: SquareArrowOutUpRight, space_manage_s: SlidersHorizontal,
  space_add_s: Plus, add_s: Plus, icon_document_s: FileText, icon_grid_s: Table2,
  icon_board_s: SquareKanban, icon_calendar_s: CalendarDays, chat_ai_page_s: MessageSquareText,
  lock_page_s: Lock, unlock_page_s: LockOpen,
};

export function MenuItem({ icon, iconNode, name, onTap, danger, disabled, height: _height, margin: _margin, tooltip }: MenuItemProps) {
  const Icon = icon ? hyperMenuIcons[icon] ?? Info : undefined;
  const row = <MenuRow icon={iconNode ?? (Icon && <Icon />)} label={name}
    onClick={onTap} destructive={danger} disabled={disabled} />;
  return tooltip ? <Tooltip message={tooltip}>{row}</Tooltip> : row;
}

export const MenuDivider = () => <MenuSeparator />;

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
      plain
      margin={0}
      popup={(close) => (
        <div className={cn(floatingSurfaceClass, 'flex min-h-0 flex-col overflow-y-auto p-1')}
          style={constraints}>
          {popup(close)}
        </div>
      )}
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
  return showDialog(() => <Spinner className="size-4" />, { barrierColor: 'transparent', barrierDismissible: false });
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
    <Input
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
      className="h-8 text-sm"
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
      style={{ ...(enableBorderColor ? { borderColor: enableBorderColor } : null), ...style }}
    />
  );
}
