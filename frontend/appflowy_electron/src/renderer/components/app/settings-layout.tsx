import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/*
 * Settings page layout. A page is a SettingsPageHeader followed by SettingsSections; a
 * section holds one or more SettingsGroups (bordered card, rows divided by hairlines);
 * a group holds SettingsRows (label + description on the left, control on the right).
 *
 *   <SettingsPageHeader title="Workspace" description="…" />
 *   <SettingsSection title="Appearance">
 *     <SettingsGroup>
 *       <SettingsRow label="Theme" description="…" control={<Select …/>} />
 *     </SettingsGroup>
 *   </SettingsSection>
 */

export function SettingsPageHeader({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <header className={cn('flex items-start gap-4 pb-6', className)}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h2 className="text-xl font-semibold tracking-tight text-foreground">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export function SettingsSection({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('flex flex-col gap-3 pb-8', className)}>
      {(title || actions) && (
        <div className="flex items-end gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            {title && <h3 className="text-sm font-semibold text-foreground">{title}</h3>}
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function SettingsGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-col divide-y divide-border rounded-lg border bg-card text-card-foreground', className)}>{children}</div>;
}

export interface SettingsRowProps {
  label: ReactNode;
  description?: ReactNode;
  /** Right-aligned control (Switch, Select, Button…). */
  control?: ReactNode;
  /** Content below the label, full width (sliders, wide inputs, lists). */
  children?: ReactNode;
  /** Label in destructive color (delete account, remove workspace…). */
  destructive?: boolean;
  className?: string;
}

export function SettingsRow({ label, description, control, children, destructive, className }: SettingsRowProps) {
  return (
    <div className={cn('flex flex-col gap-3 px-4 py-3', className)}>
      <div className="flex min-h-8 items-center gap-6">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className={cn('text-sm font-medium', destructive ? 'text-destructive' : 'text-foreground')}>{label}</div>
          {description && <div className="text-xs leading-relaxed text-muted-foreground">{description}</div>}
        </div>
        {control && <div className="flex shrink-0 items-center gap-2">{control}</div>}
      </div>
      {children}
    </div>
  );
}
