// Ported from t3code (apps/web/src/components/ui/alert-dialog.tsx, dialog.tsx and dialog-styles.ts), Copyright (c) 2026
// T3 Tools Inc., MIT License. See NOTICE.md in this folder.
// The alert dialog of t3code's theme library (theme removal). Left out: DialogAction and its initial-focus hook.

import { AlertDialog as AlertDialogPrimitive } from '@base-ui/react/alert-dialog';
import { createContext, use, useState, type ComponentProps, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

const DIALOG_BACKDROP_CLASS =
  'dialog-backdrop fixed inset-0 z-50 transition-all duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0';

const DIALOG_POPUP_CLASS =
  'dialog-glass -translate-y-[calc(1.25rem*var(--nested-dialogs))] relative flex min-h-0 w-full min-w-0 scale-[calc(1-0.1*var(--nested-dialogs))] flex-col opacity-[calc(1-0.1*var(--nested-dialogs))] outline-none transition-[scale,opacity,translate] duration-200 ease-in-out will-change-transform data-nested:data-ending-style:translate-y-8 data-nested:data-starting-style:translate-y-8 data-nested-dialog-open:origin-top data-ending-style:scale-98 data-starting-style:scale-98 data-ending-style:opacity-0 data-starting-style:opacity-0 [-webkit-app-region:no-drag] rounded-2xl border';

const ControlledOpenContext = createContext<boolean | undefined>(undefined);

/** Keeps the last open content on screen while the popup animates out. */
function RetainedWhileClosed({ open, children }: { open: boolean; children: ReactNode }) {
  const controlledOpen = use(ControlledOpenContext);
  const isOpen = open && controlledOpen !== false;
  const [retained, setRetained] = useState(children);
  if (isOpen && retained !== children) setRetained(children);
  return isOpen ? children : retained;
}

function renderRetainedPopup(props: ComponentProps<'div'>, state: { open: boolean }) {
  return (
    <div {...props}>
      <RetainedWhileClosed open={state.open}>{props.children}</RetainedWhileClosed>
    </div>
  );
}

export function AlertDialog<Payload>(props: AlertDialogPrimitive.Root.Props<Payload>) {
  return (
    <ControlledOpenContext value={props.open}>
      <AlertDialogPrimitive.Root {...props} />
    </ControlledOpenContext>
  );
}

export function AlertDialogPopup({ className, ...props }: AlertDialogPrimitive.Popup.Props) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Backdrop forceRender className={DIALOG_BACKDROP_CLASS} data-slot="alert-dialog-backdrop" />
      <AlertDialogPrimitive.Viewport
        className="fixed inset-0 z-50 grid grid-rows-[1fr_auto_1fr] justify-items-center p-4"
        data-slot="alert-dialog-viewport"
      >
        <AlertDialogPrimitive.Popup
          className={cn(DIALOG_POPUP_CLASS, 'row-start-2 max-h-full max-w-lg text-popover-foreground', className)}
          data-slot="alert-dialog-popup"
          render={renderRetainedPopup}
          {...props}
        />
      </AlertDialogPrimitive.Viewport>
    </AlertDialogPrimitive.Portal>
  );
}

export function AlertDialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex min-h-0 flex-col gap-2 p-6 text-center max-sm:pb-4 sm:text-left', className)}
      data-slot="alert-dialog-header"
      {...props}
    />
  );
}

export function AlertDialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex flex-col-reverse gap-2 px-6 sm:flex-row sm:justify-end sm:rounded-b-[calc(var(--radius-2xl)-1px)] border-t bg-muted/72 py-4',
        className,
      )}
      data-slot="alert-dialog-footer"
      {...props}
    />
  );
}

export function AlertDialogTitle({ className, ...props }: AlertDialogPrimitive.Title.Props) {
  return (
    <AlertDialogPrimitive.Title
      className={cn('wrap-anywhere shrink-0 font-semibold text-xl leading-snug', className)}
      data-slot="alert-dialog-title"
      {...props}
    />
  );
}

export function AlertDialogDescription({ className, ...props }: AlertDialogPrimitive.Description.Props) {
  return (
    <AlertDialogPrimitive.Description
      className={cn(
        'wrap-anywhere max-h-[min(24rem,60dvh)] min-h-0 overflow-y-auto overscroll-contain text-muted-foreground text-sm select-text',
        className,
      )}
      data-slot="alert-dialog-description"
      {...props}
    />
  );
}

export function AlertDialogClose(props: AlertDialogPrimitive.Close.Props) {
  return <AlertDialogPrimitive.Close data-slot="alert-dialog-close" {...props} />;
}
