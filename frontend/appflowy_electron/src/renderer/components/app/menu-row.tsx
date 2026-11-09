import { forwardRef, type ComponentProps, type ReactNode } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/*
 * Menu rows for content rendered inside the app's anchored popovers (ui/Popover,
 * AppFlowyPopover). They match shadcn's DropdownMenuItem exactly, so a hand-positioned
 * menu and a Base UI DropdownMenu look the same. Prefer <DropdownMenu> from
 * @/components/ui/dropdown-menu for simple trigger → actions menus.
 */

/** Surface of every floating panel (menus, pickers, popovers). Width/padding are added per use. */
export const floatingSurfaceClass =
  'rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none';

/** Same classes as shadcn DropdownMenuItem (base-nova), with hover instead of focus. */
export const menuRowClass =
  'group/menu-row relative flex w-full min-w-0 cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm outline-none select-none ' +
  'hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground ' +
  'data-[highlighted=true]:bg-accent data-[highlighted=true]:text-accent-foreground ' +
  'data-[variant=destructive]:text-destructive data-[variant=destructive]:hover:bg-destructive/10 dark:data-[variant=destructive]:hover:bg-destructive/20 ' +
  'disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 ' +
  '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4 [&>svg:first-child]:text-muted-foreground data-[variant=destructive]:[&>svg:first-child]:text-destructive';

export interface MenuRowProps extends Omit<ComponentProps<'button'>, 'children'> {
  icon?: ReactNode;
  label: ReactNode;
  /** Secondary line under the label. */
  description?: ReactNode;
  /** Right side: a shortcut string, a <Switch>, a chevron… */
  trailing?: ReactNode;
  shortcut?: string;
  destructive?: boolean;
  checked?: boolean;
  submenu?: boolean;
  highlighted?: boolean;
}

export const MenuRow = forwardRef<HTMLButtonElement, MenuRowProps>(function MenuRow(
  { icon, label, description, trailing, shortcut, destructive, checked, submenu, highlighted, className, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      data-variant={destructive ? 'destructive' : undefined}
      data-highlighted={highlighted ? 'true' : undefined}
      className={cn(menuRowClass, description && 'items-start py-1.5', className)}
      {...props}
    >
      {icon}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{label}</span>
        {description && <span className="text-xs leading-snug text-muted-foreground">{description}</span>}
      </span>
      {shortcut && <span className="ml-auto pl-3 text-xs tracking-widest text-muted-foreground">{shortcut}</span>}
      {trailing}
      {checked && <Check className="ml-auto text-foreground" />}
      {submenu && <ChevronRight className="ml-auto text-muted-foreground" />}
    </button>
  );
});

export function MenuSeparator({ className }: { className?: string }) {
  return <div role="separator" className={cn('-mx-1 my-1 h-px bg-border', className)} />;
}

export function MenuLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('px-1.5 py-1 text-xs font-medium text-muted-foreground', className)}>{children}</div>;
}

/** Footnote line at the bottom of a menu (e.g. "Created Nov 09, 2026"). */
export function MenuFootnote({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('px-1.5 pt-1.5 pb-1 text-xs text-muted-foreground', className)}>{children}</div>;
}
