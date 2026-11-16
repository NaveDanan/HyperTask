// Ported from t3code (apps/web/src/components/ui/dialog.tsx, dialog-styles.ts, alert-dialog.tsx, alert.tsx,
// input-group.tsx, input.tsx, scroll-area.tsx, spinner.tsx and refresh-icon.tsx), Copyright (c) 2026 T3 Tools Inc.,
// MIT License. See NOTICE.md in this folder.
// The controls t3code's "Add a theme" dialog renders with. The class strings are t3code's. Left out: the media dialog
// variant (and its native titlebar inset), the virtualized scroll fade helper, Input's native and compact modes, and
// the visible-animation observer the spinners use to pause offscreen (they spin with Tailwind's animate-spin here).

import { AlertDialog as AlertDialogPrimitive } from '@base-ui/react/alert-dialog';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { Input as InputPrimitive } from '@base-ui/react/input';
import { ScrollArea as ScrollAreaPrimitive } from '@base-ui/react/scroll-area';
import { useRender } from '@base-ui/react/use-render';
import { cva, type VariantProps } from 'class-variance-authority';
import { LoaderCircleIcon, RefreshCwIcon, XIcon } from 'lucide-react';
import {
  Children,
  type ComponentProps,
  createContext,
  isValidElement,
  type ReactNode,
  use,
  useRef,
  useState,
} from 'react';
import type * as React from 'react';
import { cn } from '@/lib/utils';
import { Button } from './HyperSettingsControls';

// ---------------------------------------------------------------------------------------------------------------
// Dialog styles

const DIALOG_BACKDROP_BASE_CLASS =
  'fixed inset-0 z-50 transition-all duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0';

const DIALOG_BACKDROP_CLASS = `dialog-backdrop ${DIALOG_BACKDROP_BASE_CLASS}`;

const DIALOG_POPUP_BASE_CLASS =
  '-translate-y-[calc(1.25rem*var(--nested-dialogs))] relative flex min-h-0 w-full min-w-0 scale-[calc(1-0.1*var(--nested-dialogs))] flex-col opacity-[calc(1-0.1*var(--nested-dialogs))] outline-none transition-[scale,opacity,translate] duration-200 ease-in-out will-change-transform data-nested:data-ending-style:translate-y-8 data-nested:data-starting-style:translate-y-8 data-nested-dialog-open:origin-top data-ending-style:scale-98 data-starting-style:scale-98 data-ending-style:opacity-0 data-starting-style:opacity-0 [-webkit-app-region:no-drag]';

const DIALOG_POPUP_CLASS = `dialog-glass ${DIALOG_POPUP_BASE_CLASS} rounded-2xl border`;

const DIALOG_MOBILE_SHEET_CLASS =
  'max-sm:max-w-none max-sm:rounded-none max-sm:border-x-0 max-sm:border-t max-sm:border-b-0 max-sm:opacity-[calc(1-min(var(--nested-dialogs),1))] max-sm:data-ending-style:translate-y-4 max-sm:data-starting-style:translate-y-4';

// ---------------------------------------------------------------------------------------------------------------
// Scroll area

function ScrollArea({
  className,
  children,
  scrollFade = false,
  scrollFadePadding = true,
  scrollbarGutter = false,
  hideScrollbars = false,
  chainVerticalScroll = false,
  radius = 'inherit',
  viewportTabIndex,
  ...props
}: ScrollAreaPrimitive.Root.Props & {
  scrollFade?: boolean;
  scrollFadePadding?: boolean;
  scrollbarGutter?: boolean;
  hideScrollbars?: boolean;
  chainVerticalScroll?: boolean;
  radius?: 'inherit' | 'none';
  viewportTabIndex?: number;
}) {
  return (
    <ScrollAreaPrimitive.Root
      className={cn(
        'relative size-full min-h-0 overflow-hidden',
        radius === 'none' ? 'rounded-none' : 'rounded-[inherit]',
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        {...(viewportTabIndex === undefined ? {} : { tabIndex: viewportTabIndex })}
        className={cn(
          'h-full max-h-[inherit] overflow-auto overscroll-contain rounded-[inherit] outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background data-has-overflow-x:overscroll-x-contain',
          chainVerticalScroll && 'overscroll-y-auto',
          scrollFade &&
            'mask-t-from-[calc(100%-min(var(--fade-size),var(--scroll-area-overflow-y-start)))] mask-b-from-[calc(100%-min(var(--fade-size),var(--scroll-area-overflow-y-end)))] mask-l-from-[calc(100%-min(var(--fade-size),var(--scroll-area-overflow-x-start)))] mask-r-from-[calc(100%-min(var(--fade-size),var(--scroll-area-overflow-x-end)))] focus-visible:mask-none [--fade-size:1.5rem]',
          scrollFade && scrollFadePadding && 'scroll-p-[var(--fade-size)]',
          scrollFade && !scrollFadePadding && 'has-focus-visible:mask-none',
          scrollbarGutter && 'scrollbar-gutter-stable',
          hideScrollbars && '[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        )}
        data-slot="scroll-area-viewport"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      {!hideScrollbars && (
        <>
          <ScrollBar orientation="vertical" />
          <ScrollBar orientation="horizontal" />
          <ScrollAreaPrimitive.Corner data-slot="scroll-area-corner" />
        </>
      )}
    </ScrollAreaPrimitive.Root>
  );
}

// t3code's --app-scrollbar-thumb tokens are HyperTask's ::-webkit-scrollbar-thumb colors (styles/app.css).
function ScrollBar({ className, orientation = 'vertical', ...props }: ScrollAreaPrimitive.Scrollbar.Props) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      className={cn(
        'flex opacity-0 transition-opacity delay-300 data-[orientation=horizontal]:mx-1 data-[orientation=horizontal]:mb-px data-[orientation=horizontal]:h-1.5 data-[orientation=vertical]:my-1 data-[orientation=vertical]:mr-px data-[orientation=vertical]:w-1.5 data-[orientation=horizontal]:flex-col data-hovering:opacity-100 data-scrolling:opacity-100 data-hovering:delay-0 data-scrolling:delay-0 data-hovering:duration-100 data-scrolling:duration-100',
        className,
      )}
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        className="relative flex-1 rounded-full bg-[color-mix(in_oklch,var(--foreground)_16%,transparent)] transition-colors hover:bg-[color-mix(in_oklch,var(--foreground)_28%,transparent)]"
        data-slot="scroll-area-thumb"
      />
    </ScrollAreaPrimitive.Scrollbar>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Dialog

const ControlledOpenContext = createContext<boolean | undefined>(undefined);

function RetainedWhileClosed({ open, children }: { open: boolean; children: ReactNode }) {
  const controlledOpen = use(ControlledOpenContext);
  const isOpen = open && controlledOpen !== false;
  const [retained, setRetained] = useState(children);
  if (isOpen && retained !== children) {
    setRetained(children);
  }
  return isOpen ? children : retained;
}

function renderRetainedPopup(props: ComponentProps<'div'>, state: { open: boolean }) {
  return (
    <div {...props}>
      <RetainedWhileClosed open={state.open}>{props.children}</RetainedWhileClosed>
    </div>
  );
}

function Dialog<Payload>(props: DialogPrimitive.Root.Props<Payload>) {
  return (
    <ControlledOpenContext value={props.open}>
      <DialogPrimitive.Root {...props} />
    </ControlledOpenContext>
  );
}

function useDialogActionInitialFocus() {
  const popupRef = useRef<HTMLDivElement>(null);
  const initialFocus = (openType: string) => {
    // Match Base UI: touch opens focus the popup to avoid opening the virtual keyboard.
    if (openType === 'touch') return popupRef.current;
    return (
      popupRef.current?.querySelector<HTMLElement>(
        '[data-slot="dialog-action"]:not(:disabled):not([aria-disabled="true"])',
      ) ?? true
    );
  };
  return { popupRef, initialFocus };
}

const DialogPortal = DialogPrimitive.Portal;

function DialogClose(props: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogBackdrop({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      forceRender
      className={cn(DIALOG_BACKDROP_CLASS, className)}
      data-slot="dialog-backdrop"
      {...props}
    />
  );
}

function DialogViewport({ className, ...props }: DialogPrimitive.Viewport.Props) {
  return (
    <DialogPrimitive.Viewport
      // Electron drag regions ignore z-index, so without no-drag a click over a header drag strip never reaches the page.
      className={cn(
        'fixed inset-0 z-50 grid grid-rows-[1fr_auto_1fr] justify-items-center p-4 [-webkit-app-region:no-drag]',
        className,
      )}
      data-slot="dialog-viewport"
      {...props}
    />
  );
}

function DialogPopup({
  className,
  children,
  showCloseButton = true,
  bottomStickOnMobile = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean;
  bottomStickOnMobile?: boolean;
}) {
  const { popupRef, initialFocus } = useDialogActionInitialFocus();
  const popup = useRender({
    ref: popupRef,
    render: (
      <DialogPrimitive.Popup
        className={cn(
          DIALOG_POPUP_CLASS,
          'row-start-2 text-popover-foreground',
          'max-h-full max-w-lg',
          bottomStickOnMobile && DIALOG_MOBILE_SHEET_CLASS,
          className,
        )}
        data-slot="dialog-popup"
        initialFocus={initialFocus}
        render={renderRetainedPopup}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            aria-label="Close"
            className="absolute end-2 top-2"
            // t3code's "icon" button size (size-9 sm:size-8); the settings Button has no such size.
            render={<Button className="size-9 sm:size-8" size="icon-sm" variant="ghost" />}
          >
            <XIcon />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    ),
  });
  return (
    <DialogPortal>
      <DialogBackdrop />
      <DialogViewport className={cn(bottomStickOnMobile && 'max-sm:grid-rows-[1fr_auto] max-sm:p-0 max-sm:pt-12')}>
        {popup}
      </DialogViewport>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 p-6 in-[[data-slot=dialog-popup]:has([data-slot=dialog-panel])]:pb-3 max-sm:pb-4',
        className,
      )}
      data-slot="dialog-header"
      {...props}
    />
  );
}

function DialogFooter({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<'div'> & {
  variant?: 'default' | 'bare';
}) {
  return (
    <div
      className={cn(
        'flex flex-col-reverse gap-2 px-6 sm:flex-row sm:justify-end sm:rounded-b-[calc(var(--radius-2xl)-1px)]',
        variant === 'default' && 'border-t bg-muted/72 py-4',
        variant === 'bare' && 'py-4',
        className,
      )}
      data-slot="dialog-footer"
      {...props}
    />
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      className={cn('wrap-anywhere font-semibold text-xl leading-snug', className)}
      data-slot="dialog-title"
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      className={cn('text-muted-foreground text-sm', className)}
      data-slot="dialog-description"
      {...props}
    />
  );
}

function DialogPanel({
  className,
  scrollFade = true,
  ...props
}: React.ComponentProps<'div'> & { scrollFade?: boolean }) {
  return (
    <ScrollArea scrollFade={scrollFade}>
      <div
        className={cn(
          'space-y-4 p-6 in-[[data-slot=dialog-popup]:has([data-slot=dialog-header])]:pt-1 in-[[data-slot=dialog-popup]:has([data-slot=dialog-footer]:not(.border-t))]:pb-1',
          className,
        )}
        data-slot="dialog-panel"
        {...props}
      />
    </ScrollArea>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Alert dialog

function AlertDialog<Payload>(props: AlertDialogPrimitive.Root.Props<Payload>) {
  return (
    <ControlledOpenContext value={props.open}>
      <AlertDialogPrimitive.Root {...props} />
    </ControlledOpenContext>
  );
}

const AlertDialogPortal = AlertDialogPrimitive.Portal;

function AlertDialogBackdrop({ className, ...props }: AlertDialogPrimitive.Backdrop.Props) {
  return (
    <AlertDialogPrimitive.Backdrop
      forceRender
      className={cn(DIALOG_BACKDROP_CLASS, className)}
      data-slot="alert-dialog-backdrop"
      {...props}
    />
  );
}

function AlertDialogViewport({ className, ...props }: AlertDialogPrimitive.Viewport.Props) {
  return (
    <AlertDialogPrimitive.Viewport
      className={cn('fixed inset-0 z-50 grid grid-rows-[1fr_auto_1fr] justify-items-center p-4', className)}
      data-slot="alert-dialog-viewport"
      {...props}
    />
  );
}

function AlertDialogPopup({
  className,
  bottomStickOnMobile = true,
  portalContainer,
  ...props
}: AlertDialogPrimitive.Popup.Props & {
  bottomStickOnMobile?: boolean;
  portalContainer?: AlertDialogPrimitive.Portal.Props['container'];
}) {
  const { popupRef, initialFocus } = useDialogActionInitialFocus();
  const popup = useRender({
    ref: popupRef,
    render: (
      <AlertDialogPrimitive.Popup
        className={cn(
          DIALOG_POPUP_CLASS,
          'row-start-2 max-h-full max-w-lg text-popover-foreground',
          bottomStickOnMobile && DIALOG_MOBILE_SHEET_CLASS,
          className,
        )}
        data-slot="alert-dialog-popup"
        initialFocus={initialFocus}
        render={renderRetainedPopup}
        {...props}
      />
    ),
  });
  return (
    <AlertDialogPortal container={portalContainer}>
      <AlertDialogBackdrop />
      <AlertDialogViewport className={cn(bottomStickOnMobile && 'max-sm:grid-rows-[1fr_auto] max-sm:p-0 max-sm:pt-12')}>
        {popup}
      </AlertDialogViewport>
    </AlertDialogPortal>
  );
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex min-h-0 flex-col gap-2 p-6 text-center max-sm:pb-4 sm:text-left', className)}
      data-slot="alert-dialog-header"
      {...props}
    />
  );
}

function AlertDialogFooter({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<'div'> & {
  variant?: 'default' | 'bare';
}) {
  return (
    <div
      className={cn(
        'flex flex-col-reverse gap-2 px-6 sm:flex-row sm:justify-end sm:rounded-b-[calc(var(--radius-2xl)-1px)]',
        variant === 'default' && 'border-t bg-muted/72 py-4',
        variant === 'bare' && 'pb-6',
        className,
      )}
      data-slot="alert-dialog-footer"
      {...props}
    />
  );
}

function AlertDialogTitle({ className, ...props }: AlertDialogPrimitive.Title.Props) {
  return (
    <AlertDialogPrimitive.Title
      className={cn('wrap-anywhere shrink-0 font-semibold text-xl leading-snug', className)}
      data-slot="alert-dialog-title"
      {...props}
    />
  );
}

function AlertDialogDescription({ className, ...props }: AlertDialogPrimitive.Description.Props) {
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

function AlertDialogClose(props: AlertDialogPrimitive.Close.Props) {
  return <AlertDialogPrimitive.Close data-slot="alert-dialog-close" {...props} />;
}

// ---------------------------------------------------------------------------------------------------------------
// Alert

const alertVariants = cva('relative rounded-xl border px-3.5 py-3 text-card-foreground text-sm', {
  defaultVariants: {
    surface: 'default',
    variant: 'default',
  },
  variants: {
    surface: {
      default: '',
      glass: 'alert-glass',
    },
    variant: {
      default: 'bg-transparent dark:bg-input/32 [&_svg]:text-muted-foreground',
      sidebar:
        'rounded-lg border-sidebar-border bg-sidebar-control-surface px-2 py-1.5 text-[11px] leading-4 [&_[data-slot=alert-description]]:block [&_[data-slot=alert-description]]:text-sidebar-muted-foreground',
      error:
        'border-error/32 bg-error-surface text-error-foreground [&_[data-slot=alert-description]]:text-error-foreground/80 [&_svg]:text-error',
      info: 'border-info/32 bg-info/4 [&_svg]:text-info',
      success: 'border-success/32 bg-success/4 [&_svg]:text-success',
      warning:
        'border-warning/32 bg-warning-surface text-warning-foreground [&_[data-slot=alert-description]]:text-warning-foreground/80 [&_svg]:text-warning',
    },
  },
});

function alertChildSlot(child: React.ReactElement): string | undefined {
  const propsSlot = (child.props as Record<string, string | undefined>)['data-slot'];
  if (propsSlot) {
    return propsSlot;
  }

  const type = child.type as { displayName?: string; name?: string };
  switch (type.displayName ?? type.name) {
    case 'AlertAction':
      return 'alert-action';
    case 'AlertTitle':
      return 'alert-title';
    case 'AlertDescription':
      return 'alert-description';
    default:
      return undefined;
  }
}

function Alert({
  className,
  variant,
  surface,
  controlAlignment = 'center',
  children,
  ...props
}: React.ComponentProps<'div'> &
  VariantProps<typeof alertVariants> & {
    controlAlignment?: 'center' | 'first-line';
  }) {
  const icon: React.ReactNode[] = [];
  const content: React.ReactNode[] = [];
  const action: React.ReactNode[] = [];

  Children.forEach(children, (child) => {
    if (!isValidElement(child)) {
      content.push(child);
      return;
    }
    const slot = alertChildSlot(child);
    if (slot === 'alert-action') {
      action.push(child);
    } else if (slot === 'alert-title' || slot === 'alert-description') {
      content.push(child);
    } else {
      icon.push(child);
    }
  });

  return (
    <div
      className={cn(alertVariants({ surface, variant }), className)}
      data-slot="alert"
      data-variant={variant ?? 'default'}
      role="alert"
      {...props}
    >
      <div
        className={cn(
          'flex gap-2',
          controlAlignment === 'first-line' ? 'items-start' : 'items-center',
          controlAlignment === 'first-line' && action.length > 0 && 'min-h-7 pt-1 sm:min-h-6 sm:pt-0.5',
        )}
      >
        {icon.length > 0 && (
          <div
            className={cn(
              'flex shrink-0 items-center justify-center',
              controlAlignment === 'first-line' ? 'h-lh w-4 [&>svg]:size-4' : 'size-4 [&>svg]:size-full',
            )}
          >
            {icon}
          </div>
        )}
        {content.length > 0 && <div className="flex min-w-0 flex-1 flex-col gap-0.5">{content}</div>}
        {action.length > 0 && (
          <div
            className={cn(
              'flex shrink-0 items-center',
              controlAlignment === 'first-line' ? 'h-lh self-start' : 'self-center',
            )}
          >
            {action}
          </div>
        )}
      </div>
    </div>
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('font-medium', className)} data-slot="alert-title" {...props} />;
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex flex-col gap-2.5 text-muted-foreground', className)}
      data-slot="alert-description"
      {...props}
    />
  );
}

function AlertAction({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex gap-1', className)} data-slot="alert-action" {...props} />;
}

AlertTitle.displayName = 'AlertTitle';
AlertDescription.displayName = 'AlertDescription';
AlertAction.displayName = 'AlertAction';

// ---------------------------------------------------------------------------------------------------------------
// Input group

const inputGroupVariants = cva(
  'relative inline-flex w-full min-w-0 items-center rounded-[var(--control-radius)] border text-base text-foreground ring-ring/24 transition-shadow has-[input:focus-visible,textarea:focus-visible]:has-[input[aria-invalid],textarea[aria-invalid]]:border-destructive/64 has-[input:focus-visible,textarea:focus-visible]:has-[input[aria-invalid],textarea[aria-invalid]]:ring-destructive/16 has-[textarea]:h-auto has-data-[align=block-end]:h-auto has-data-[align=block-start]:h-auto has-data-[align=block-end]:flex-col has-data-[align=block-start]:flex-col has-[input:focus-visible,textarea:focus-visible]:border-ring has-[input[aria-invalid],textarea[aria-invalid]]:border-destructive/36 has-autofill:bg-foreground/4 has-[input:disabled,textarea:disabled]:opacity-64 has-[input:disabled,textarea:disabled,input:focus-visible,textarea:focus-visible,input[aria-invalid],textarea[aria-invalid]]:shadow-none has-[input:focus-visible,textarea:focus-visible]:ring-[3px] has-[input:focus-visible,textarea:focus-visible]:ring-inset sm:text-sm dark:has-autofill:bg-foreground/8 dark:has-[input[aria-invalid],textarea[aria-invalid]]:ring-destructive/24 has-data-[align=inline-start]:**:[[data-size=sm]_input]:ps-1.5 has-data-[align=inline-end]:**:[[data-size=sm]_input]:pe-1.5 *:[[data-slot=input-control],[data-slot=textarea-control]]:contents *:[[data-slot=input-control],[data-slot=textarea-control]]:before:hidden has-[[data-align=block-start],[data-align=block-end]]:**:[input]:h-auto has-data-[align=inline-start]:**:[input]:ps-2 has-data-[align=inline-end]:**:[input]:pe-2 has-data-[align=block-end]:**:[input]:pt-1.5 has-data-[align=block-start]:**:[input]:pb-1.5 **:[textarea]:min-h-20.5 **:[textarea]:resize-none **:[textarea]:py-[calc(--spacing(3)-1px)] **:[textarea]:max-sm:min-h-23.5 **:[textarea_button]:rounded-[calc(var(--control-radius)-1px)]',
  {
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
    variants: {
      size: {
        default: null,
        lg: 'h-9',
      },
      variant: {
        default:
          'border-input bg-background not-dark:bg-clip-padding shadow-xs/5 before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--control-radius)-1px)] not-has-[input:disabled,textarea:disabled]:not-has-[input:focus-visible,textarea:focus-visible]:not-has-[input[aria-invalid],textarea[aria-invalid]]:before:shadow-[0_1px_--theme(--color-black/4%)] dark:bg-input/32 dark:not-has-[input:disabled,textarea:disabled]:not-has-[input:focus-visible,textarea:focus-visible]:not-has-[input[aria-invalid],textarea[aria-invalid]]:before:shadow-[0_-1px_--theme(--color-white/6%)]',
        popover:
          'dropdown-glass rounded-2xl has-[input:focus-visible,textarea:focus-visible]:ring-0 has-[input:focus-visible,textarea:focus-visible]:border-[color-mix(in_srgb,var(--contrast-foreground)_18%,transparent)]',
        ghost:
          'border-transparent bg-transparent shadow-none hover:bg-muted/40 has-[input:focus-visible,textarea:focus-visible]:bg-background',
      },
    },
  },
);

function InputGroup({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof inputGroupVariants>) {
  return (
    <div
      className={cn(inputGroupVariants({ variant, size }), className)}
      data-slot="input-group"
      role="group"
      {...props}
    />
  );
}

const inputGroupAddonVariants = cva(
  "[&_svg]:-mx-0.5 flex h-auto cursor-text select-none items-center justify-center gap-2 leading-none [&>kbd]:rounded-[calc(var(--radius)-5px)] in-[[data-slot=input-group]:has([data-slot=input-control],[data-slot=textarea-control])]:[&_svg:not([class*='size-'])]:size-4.5 sm:in-[[data-slot=input-group]:has([data-slot=input-control],[data-slot=textarea-control])]:[&_svg:not([class*='size-'])]:size-4 not-has-[button]:**:[svg:not([class*='opacity-'])]:opacity-80",
  {
    defaultVariants: {
      align: 'inline-start',
    },
    compoundVariants: [
      {
        align: 'inline-end',
        inset: 'pill',
        className: 'has-[>button]:me-0 pe-1 [[data-size=sm]+&]:pe-1 gap-0.5',
      },
      {
        align: 'inline-start',
        inset: 'pill',
        className: 'has-[>button]:ms-0 ps-1 [[data-size=sm]+&]:ps-1 gap-0.5',
      },
    ],
    variants: {
      inset: {
        default: null,
        pill: '[&_button]:rounded-full',
      },
      align: {
        'block-end':
          'order-last w-full justify-start px-[calc(--spacing(3)-1px)] pb-[calc(--spacing(3)-1px)] [.border-t]:pt-[calc(--spacing(3)-1px)] [[data-size=sm]+&]:px-[calc(--spacing(2.5)-1px)]',
        'block-start':
          'order-first w-full justify-start px-[calc(--spacing(3)-1px)] pt-[calc(--spacing(3)-1px)] [.border-b]:pb-[calc(--spacing(3)-1px)] [[data-size=sm]+&]:px-[calc(--spacing(2.5)-1px)]',
        'inline-end':
          'has-[>:last-child[data-slot=badge]]:-me-1.5 has-[>button]:-me-2 order-last pe-[calc(--spacing(3)-1px)] has-[>kbd:last-child]:me-[-0.35rem] [[data-size=sm]+&]:pe-[calc(--spacing(2.5)-1px)]',
        'inline-start':
          'has-[>:last-child[data-slot=badge]]:-ms-1.5 has-[>button]:-ms-2 order-first ps-[calc(--spacing(3)-1px)] has-[>kbd:last-child]:ms-[-0.35rem] [[data-size=sm]+&]:ps-[calc(--spacing(2.5)-1px)]',
      },
    },
  },
);

function InputGroupAddon({
  className,
  align = 'inline-start',
  inset,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof inputGroupAddonVariants>) {
  return (
    <div
      className={cn(inputGroupAddonVariants({ align, inset }), className)}
      data-align={align}
      data-slot="input-group-addon"
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        const target = e.target as HTMLElement;
        const isInteractive = target.closest(
          "button, a, input, select, textarea, [role='button'], [role='combobox'], [role='listbox'], [data-slot='select-trigger']",
        );
        if (isInteractive) return;
        e.preventDefault();
        const parent = e.currentTarget.parentElement;
        const input = parent?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
        if (input && !parent?.querySelector('input:focus, textarea:focus')) {
          input.focus();
        }
      }}
      {...props}
    />
  );
}

type InputGroupInputProps = Omit<InputPrimitive.Props & React.RefAttributes<HTMLInputElement>, 'size' | 'className'> & {
  className?: string;
  size?: 'sm' | 'default' | 'lg';
};

/** t3code's Input in its unstyled mode: the group draws the frame, the span is display:contents. */
function InputGroupInput({ className, size = 'default', ...props }: InputGroupInputProps) {
  return (
    <span className={className || undefined} data-size={size} data-slot="input-control">
      <InputPrimitive
        className={cn(
          'h-8.5 w-full min-w-0 rounded-[inherit] px-[calc(--spacing(3)-1px)] leading-8.5 outline-none placeholder:text-placeholder sm:h-7.5 sm:leading-7.5 [transition:background-color_5000000s_ease-in-out_0s]',
          size === 'sm' && 'h-7.5 px-[calc(--spacing(2.5)-1px)] leading-7.5 sm:h-6.5 sm:leading-6.5',
          size === 'lg' && 'h-9.5 leading-9.5 sm:h-8.5 sm:leading-8.5',
          props.type === 'search' &&
            '[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none [&::-webkit-search-results-button]:appearance-none [&::-webkit-search-results-decoration]:appearance-none',
        )}
        data-slot="input"
        {...props}
      />
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Spinner and refresh icon

// No default size: inside a Button the parent's svg rule sizes the glyph.
const spinnerVariants = cva('motion-safe:animate-spin', {
  variants: {
    size: {
      xs: 'size-3',
      sm: 'size-3.5',
      md: 'size-4',
      lg: 'size-5',
    },
    tone: {
      current: '',
      muted: 'text-muted-foreground',
    },
  },
  defaultVariants: { tone: 'current' },
});

function Spinner({
  className,
  size,
  tone,
  ...props
}: React.ComponentPropsWithoutRef<typeof LoaderCircleIcon> & VariantProps<typeof spinnerVariants>) {
  return (
    <LoaderCircleIcon
      aria-label="Loading"
      className={cn(spinnerVariants({ size, tone }), className)}
      role="status"
      {...props}
    />
  );
}

// No default size: inside a Button the parent's svg rule sizes the glyph.
const refreshIconVariants = cva('', {
  variants: {
    size: {
      xs: 'size-3',
      sm: 'size-3.5',
      md: 'size-4',
      lg: 'size-5',
    },
  },
});

function RefreshIcon({
  refreshing = false,
  className,
  size,
  ...props
}: React.ComponentPropsWithoutRef<typeof RefreshCwIcon> &
  VariantProps<typeof refreshIconVariants> & { refreshing?: boolean }) {
  return (
    <RefreshCwIcon
      aria-hidden
      className={cn(refreshIconVariants({ size }), refreshing && 'motion-safe:animate-spin', className)}
      {...props}
    />
  );
}

export {
  Alert,
  AlertAction,
  AlertDescription,
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertTitle,
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  RefreshIcon,
  ScrollArea,
  Spinner,
};
