// Layout pieces of the Appearance settings page, ported from t3code (apps/web/src/components/settings/settingsLayout.tsx,
// SettingsGroup.tsx, AdvancedSettings.tsx, WorkspacePageContainer.tsx, and the slider markup of
// AppearanceSettingsPanel.tsx). Copyright (c) 2026 T3 Tools Inc., MIT License. See NOTICE.md in this folder.
// Left out: settings search targets, project and environment scopes, inheritance markers and managed-policy locks.

import { useState, type ComponentPropsWithoutRef, type CSSProperties, type ReactNode } from 'react';
import { ChevronRightIcon, Undo2Icon, XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Button,
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
  Tooltip,
  TooltipPopup,
  TooltipTrigger,
} from './HyperSettingsControls';

/**
 * The bar above t3code's settings pages (routes/_chat.settings.tsx): a SettingsBreadcrumb such as
 * "Settings / Appearance" and the AppRouteModalClose button.
 */
export function SettingsBreadcrumbBar({
  root,
  section,
  onClose,
}: {
  root: string;
  section: string;
  onClose: () => void;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b ps-5 pe-2">
      <nav aria-label="Settings breadcrumb" className="min-w-0">
        <ol className="m-0 flex min-w-0 list-none items-center gap-2 p-0 text-sm sm:gap-3">
          <li className="flex min-w-0 shrink-0 items-center font-medium text-muted-foreground">
            <span className="block min-w-0 truncate py-1.5">{root}</span>
          </li>
          <li aria-hidden="true" className="flex shrink-0 items-center text-muted-foreground">
            /
          </li>
          <li aria-current="page" className="flex min-w-0 items-center truncate font-medium text-foreground">
            <span className="block min-w-0 truncate py-1.5">{section}</span>
          </li>
        </ol>
      </nav>
      <div className="ms-auto flex shrink-0 items-center gap-1">
        <Tooltip>
          <TooltipTrigger render={<Button size="icon-sm" variant="ghost" aria-label="Close" onClick={onClose} />}>
            <XIcon />
          </TooltipTrigger>
          <TooltipPopup side="bottom">Close (Esc)</TooltipPopup>
        </Tooltip>
      </div>
    </header>
  );
}

/** WorkspacePageContainer at its "readable" width, with SettingsPageContainer's section gap. */
export function SettingsPageContainer({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="flex w-full flex-col gap-8" style={style}>
      {children}
    </div>
  );
}

export function SettingsGroup({
  variant = 'grouped',
  divided = true,
  className,
  ...props
}: ComponentPropsWithoutRef<'div'> & {
  variant?: 'grouped' | 'plain';
  divided?: boolean;
}) {
  return (
    <div
      data-slot="settings-group"
      {...props}
      className={cn(
        'relative overflow-visible text-foreground',
        variant === 'grouped' ? 'rounded-xl border border-border/60 bg-card/40 shadow-xs/5' : 'space-y-1',
        variant === 'grouped' &&
          divided &&
          '*:not-first:border-t *:not-first:border-border/50 [&>[data-slot=settings-row]]:rounded-none',
        className,
      )}
    />
  );
}

export function SettingsSection({
  title,
  hideTitle = false,
  icon,
  titleAction,
  headerAction,
  variant = 'grouped',
  children,
  className,
  ...sectionProps
}: ComponentPropsWithoutRef<'section'> & {
  title: string;
  hideTitle?: boolean;
  icon?: ReactNode;
  titleAction?: ReactNode;
  headerAction?: ReactNode;
  variant?: 'grouped' | 'plain';
  children: ReactNode;
}) {
  return (
    <section {...sectionProps} className={cn(!hideTitle && 'space-y-2.5', className)}>
      {hideTitle ? (
        <h2 className="sr-only">{title}</h2>
      ) : (
        <div className="flex min-h-7 flex-wrap items-start justify-between gap-x-4 gap-y-1 px-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-1">
            <h2 className="flex min-h-7 items-center gap-2 text-base font-semibold text-foreground">
              {icon}
              {title}
            </h2>
            {titleAction}
          </div>
          {headerAction ? <div className="flex min-h-7 min-w-7 items-center justify-end">{headerAction}</div> : null}
        </div>
      )}
      <SettingsGroup variant={variant}>{children}</SettingsGroup>
    </section>
  );
}

/** One setting: title with its reset button, description, the control beside it, and an optional body below. */
export function SettingsRow({
  title,
  description,
  status,
  resetAction,
  control,
  children,
  className,
  ...rowProps
}: Omit<ComponentPropsWithoutRef<'div'>, 'title'> & {
  title: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
  /** SettingResetButton, shown only while the value differs from its default. */
  resetAction?: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      {...rowProps}
      data-slot="settings-row"
      className={cn(
        'group/settings-row @container/settings-row rounded-xl px-3 sm:px-4 aria-disabled:opacity-64 aria-disabled:[&_*]:text-muted-foreground',
        children ? 'pt-3 pb-1' : 'py-3',
        className,
      )}
    >
      <div className="flex flex-col gap-3 @min-[32rem]/settings-row:grid @min-[32rem]/settings-row:grid-cols-[minmax(0,1fr)_auto] @min-[32rem]/settings-row:items-center @min-[32rem]/settings-row:gap-8">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-h-5 items-center gap-1.5">
            <h3 className="text-sm font-medium text-foreground">{title}</h3>
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">{resetAction}</span>
          </div>
          {description ? (
            <p className="max-w-2xl text-pretty text-xs leading-normal text-muted-foreground">{description}</p>
          ) : null}
          {status ? <div className="pt-0.5 text-xs text-muted-foreground">{status}</div> : null}
        </div>
        {control ? (
          <div className="flex w-full min-w-0 shrink-0 items-center gap-2 @min-[32rem]/settings-row:w-auto @min-[32rem]/settings-row:justify-end @min-[32rem]/settings-row:[&_[data-slot=select-trigger]]:min-w-40">
            {control}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function SettingResetButton({
  label,
  tooltip = 'Reset to default',
  onClick,
}: {
  label: string;
  tooltip?: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-micro"
            variant="ghost-muted"
            aria-label={`Reset ${label} to default`}
            onClick={(event) => {
              event.stopPropagation();
              onClick();
            }}
          >
            <Undo2Icon className="size-3" />
          </Button>
        }
      />
      <TooltipPopup side="top">{tooltip}</TooltipPopup>
    </Tooltip>
  );
}

/** A range slider with its value in a badge, styled by `.settings-slider` in appearance-motion.css. */
export function SettingsSlider({
  label,
  id,
  value,
  min,
  max,
  step,
  unit = '',
  badgeClassName = 'min-w-12',
  className = 'sm:w-52',
  onChange,
}: {
  label: string;
  id: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  badgeClassName?: string;
  className?: string;
  onChange: (value: number) => void;
}) {
  const ratio = (value - min) / (max - min);
  const style = {
    '--settings-slider-progress': `${ratio * 100}%`,
    '--settings-slider-fill-offset': `${0.5 - ratio}rem`,
  } as CSSProperties;
  return (
    <div className={cn('flex w-full items-center gap-3', className)}>
      <output
        className={cn(
          'rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground',
          badgeClassName,
        )}
        htmlFor={id}
      >
        {value}
        {unit}
      </output>
      <input
        aria-label={label}
        className="settings-slider min-w-0 flex-1"
        id={id}
        max={max}
        min={min}
        onChange={(event) => {
          const next = Number(event.currentTarget.value);
          if (Number.isInteger(next) && next >= min && next <= max) onChange(next);
        }}
        step={step}
        style={style}
        type="range"
        value={value}
      />
    </div>
  );
}

/** Folds power-user rows at the end of a section. */
export function AdvancedSettings({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="group flex min-h-10 w-full items-center gap-1.5 rounded-b-xl px-3 text-left text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-panel-open:rounded-none sm:px-4">
        <ChevronRightIcon
          aria-hidden
          className="size-3.5 shrink-0 transition-transform duration-150 group-data-panel-open:rotate-90 motion-reduce:transition-none"
        />
        Advanced
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="border-t border-border/50 *:not-first:border-t *:not-first:border-border/50">{children}</div>
      </CollapsiblePanel>
    </Collapsible>
  );
}
