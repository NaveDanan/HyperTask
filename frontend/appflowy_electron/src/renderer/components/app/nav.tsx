import { forwardRef, type ComponentProps, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/*
 * Sidebar building blocks. Every sidebar row is one of these so spacing, hover and
 * selection read the same everywhere:
 *   NavItem          32px action row (Search, Inbox, New page, Trash, tools)
 *   NavSectionHeader 28px group label with a collapse chevron and hover actions
 *   TreeRow          28px page-tree row with indent, disclosure, icon and hover actions
 *   NavIconButton    24px icon button for row/section actions
 *   NavCount         unread/count pill
 */

export const navItemClass =
  'group/nav flex h-8 w-full min-w-0 cursor-default items-center gap-2 rounded-md px-2 text-left text-sm text-sidebar-foreground outline-none transition-colors ' +
  'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring ' +
  'data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground ' +
  'disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4';

export interface NavItemProps extends Omit<ComponentProps<'button'>, 'children'> {
  icon?: ReactNode;
  label: ReactNode;
  /** Right-aligned content: a <Kbd>, <NavCount> or an icon. */
  trailing?: ReactNode;
  active?: boolean;
}

export const NavItem = forwardRef<HTMLButtonElement, NavItemProps>(function NavItem(
  { icon, label, trailing, active, className, ...props },
  ref,
) {
  return (
    <button ref={ref} type="button" data-active={active ? 'true' : undefined} className={cn(navItemClass, className)} {...props}>
      {icon && <span className="flex size-4 items-center justify-center text-sidebar-foreground/70 group-hover/nav:text-sidebar-accent-foreground">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing && <span className="ml-auto flex shrink-0 items-center gap-1 text-sidebar-foreground/60">{trailing}</span>}
    </button>
  );
});

export const NavIconButton = forwardRef<HTMLButtonElement, ComponentProps<'button'>>(function NavIconButton(
  { className, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex size-6 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/70 outline-none transition-colors',
        'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring',
        'aria-expanded:bg-sidebar-accent aria-expanded:text-sidebar-accent-foreground [&_svg]:pointer-events-none [&_svg:not([class*=size-])]:size-4',
        className,
      )}
      {...props}
    />
  );
});

export function NavCount({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        'inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-destructive px-1 text-2xs font-semibold text-white tabular-nums',
        className,
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

export interface NavSectionHeaderProps {
  label: ReactNode;
  collapsed?: boolean;
  onToggle?: () => void;
  /** NavIconButtons shown on hover (and while one of their menus is open). */
  actions?: ReactNode;
  className?: string;
}

export function NavSectionHeader({ label, collapsed, onToggle, actions, className }: NavSectionHeaderProps) {
  return (
    <div
      data-collapsed={collapsed ? 'true' : undefined}
      className={cn(
        'group/section flex h-7 items-center gap-1 rounded-md pr-1 pl-2 text-xs font-medium text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent/60',
        className,
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex h-full min-w-0 flex-1 cursor-default items-center gap-1 text-left outline-none hover:text-sidebar-foreground focus-visible:underline"
      >
        <span className="truncate">{label}</span>
        <ChevronRight
          className={cn(
            'size-3 shrink-0 opacity-0 transition-[transform,opacity] group-hover/section:opacity-100',
            collapsed ? 'rotate-0' : 'rotate-90',
          )}
        />
      </button>
      {actions && (
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/section:opacity-100 has-aria-expanded:opacity-100 has-focus-visible:opacity-100">
          {actions}
        </div>
      )}
    </div>
  );
}

/** Indent of a page-tree row in px for its depth (root = 0). */
export const treeIndent = (depth: number) => 4 + depth * 14;

export const treeRowClass =
  'group/row relative flex h-7 w-full min-w-0 cursor-default items-center gap-1 rounded-md pr-1 text-sm text-sidebar-foreground outline-none transition-colors ' +
  'hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground has-aria-expanded:bg-sidebar-accent/70 ' +
  'data-[selected=true]:bg-sidebar-accent data-[selected=true]:font-medium data-[selected=true]:text-sidebar-accent-foreground ' +
  'data-[drop=into]:bg-sidebar-primary/10 data-[drop=into]:ring-1 data-[drop=into]:ring-sidebar-primary/40';

/** Disclosure button of a tree row; invisible (but keeps its slot) when the row has no children. */
export function TreeDisclosure({ expanded, hasChildren, onToggle, className }: { expanded: boolean; hasChildren: boolean; onToggle: () => void; className?: string }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={expanded ? 'Collapse' : 'Expand'}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded-sm text-sidebar-foreground/50 outline-none transition-colors hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground',
        !hasChildren && 'invisible',
        className,
      )}
    >
      <ChevronRight className={cn('size-3.5 transition-transform duration-150', expanded && 'rotate-90')} />
    </button>
  );
}

/** Hover actions slot at the right edge of a TreeRow. */
export function TreeRowActions({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100 has-aria-expanded:opacity-100 [&_button]:size-5 [&_svg:not([class*=size-])]:size-3.5',
        className,
      )}
    >
      {children}
    </div>
  );
}
