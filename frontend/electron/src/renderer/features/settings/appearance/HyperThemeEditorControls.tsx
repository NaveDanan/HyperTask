// Ported from t3code (apps/web/src/components/ui/button.tsx, input.tsx, popover.tsx, closing-positioner.tsx,
// toggle.tsx, toggle-group.tsx, color-picker.tsx and apps/web/src/hooks/useViewportSize.ts), Copyright (c) 2026 T3
// Tools Inc., MIT License. See NOTICE.md in this folder.
// The theme editor's own controls, with t3code's class strings: the full Button and Input (the editor uses the
// secondary button and the compact mono native input that HyperSettingsControls leaves out), Popover, ToggleGroup and
// the color picker planes. Left out: the inline button variants and the popover title/close/handle helpers.

import { mergeProps } from '@base-ui/react/merge-props';
import { Input as InputPrimitive } from '@base-ui/react/input';
import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { Toggle as TogglePrimitive } from '@base-ui/react/toggle';
import { ToggleGroup as ToggleGroupPrimitive } from '@base-ui/react/toggle-group';
import { useRender } from '@base-ui/react/use-render';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import {
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from 'react';
import { cn } from '@/lib/utils';
import type { HsvColor } from '@/theme/HyperThemeColorMath';

// ---------------------------------------------------------------------------------------------------------------
// Button
const buttonVariants = cva(
  "[--control-icon-color:currentColor] [&_svg]:-mx-0.5 relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-[var(--control-radius)] border font-medium text-base outline-none transition-[box-shadow,scale] [&:not([aria-haspopup]):not(:disabled):not([aria-disabled=true])]:will-change-[scale] [&:active:not([aria-haspopup])]:scale-[0.97] before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--control-radius)-1px)] pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 aria-disabled:cursor-not-allowed aria-disabled:opacity-64 sm:text-sm [&_svg:not([class*='text-'])]:text-[var(--control-icon-color)] [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: {
      size: 'default',
      variant: 'default',
    },
    variants: {
      size: {
        compact:
          "h-7 gap-1 rounded-md px-[calc(--spacing(2)-1px)] text-xs before:rounded-[calc(var(--radius-md)-1px)] [&_svg:not([class*='size-'])]:size-3.5",
        default: 'h-9 px-[calc(--spacing(3)-1px)] sm:h-8',
        icon: 'size-9 sm:size-8',
        'icon-lg': 'size-10 sm:size-9',
        'icon-micro':
          "size-5 rounded-sm p-0 before:rounded-[calc(var(--radius-sm)-1px)] [&_svg:not([class*='size-'])]:size-3",
        'icon-tiny': "size-4 p-0 [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-8 sm:size-7',
        'icon-sm-pill': 'size-8 rounded-full before:rounded-full sm:size-7',
        'icon-xl': "size-11 sm:size-10 [&_svg:not([class*='size-'])]:size-5 sm:[&_svg:not([class*='size-'])]:size-4.5",
        'icon-xs':
          "size-7 sm:size-6 not-in-data-[slot=input-group]:[&_svg:not([class*='size-'])]:size-4 sm:not-in-data-[slot=input-group]:[&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-10 px-[calc(--spacing(3.5)-1px)] sm:h-9',
        micro:
          "h-5 gap-1 rounded-sm px-[calc(--spacing(1.5)-1px)] text-[11px] before:rounded-[calc(var(--radius-sm)-1px)] sm:text-[11px] [&_svg:not([class*='size-'])]:size-3 sm:[&_svg:not([class*='size-'])]:size-3",
        multiline: 'min-h-9 px-[calc(--spacing(3)-1px)] py-[calc(--spacing(1.5)-1px)] whitespace-normal sm:min-h-8',
        sm: 'h-8 gap-1.5 px-[calc(--spacing(2.5)-1px)] sm:h-7',
        'sm-pill': 'h-8 gap-1.5 rounded-full px-2.5 sm:h-7',
        'sm-multiline':
          'min-h-8 gap-1.5 px-[calc(--spacing(2.5)-1px)] py-[calc(--spacing(1)-1px)] whitespace-normal sm:min-h-7',
        xl: "h-11 px-[calc(--spacing(4)-1px)] text-lg sm:h-10 sm:text-base [&_svg:not([class*='size-'])]:size-5 sm:[&_svg:not([class*='size-'])]:size-4.5",
        xs: "h-7 gap-1 px-[calc(--spacing(2)-1px)] text-sm sm:h-6 sm:text-xs [&_svg:not([class*='size-'])]:size-4 sm:[&_svg:not([class*='size-'])]:size-3.5",
      },
      variant: {
        default:
          'not-disabled:inset-shadow-[0_1px_--theme(--color-white/16%)] border-primary bg-primary text-primary-foreground shadow-primary/24 shadow-xs [:active,[data-pressed]]:inset-shadow-[0_1px_--theme(--color-black/8%)] [:disabled,:active,[data-pressed]]:shadow-none [:hover,[data-pressed]]:bg-primary/90',
        destructive:
          'not-disabled:inset-shadow-[0_1px_--theme(--color-white/16%)] border-destructive bg-destructive text-white shadow-destructive/24 shadow-xs [:active,[data-pressed]]:inset-shadow-[0_1px_--theme(--color-black/8%)] [:disabled,:active,[data-pressed]]:shadow-none [:hover,[data-pressed]]:bg-destructive/90',
        'destructive-outline':
          'border-input bg-popover not-dark:bg-clip-padding text-destructive-foreground shadow-xs/5 not-disabled:not-active:not-data-pressed:before:shadow-[0_1px_--theme(--color-black/4%)] dark:bg-input/32 dark:not-disabled:before:shadow-[0_-1px_--theme(--color-white/2%)] dark:not-disabled:not-active:not-data-pressed:before:shadow-[0_-1px_--theme(--color-white/6%)] [:disabled,:active,[data-pressed]]:shadow-none [:hover,[data-pressed]]:border-destructive/32 [:hover,[data-pressed]]:bg-destructive/4',
        ghost:
          '[--control-icon-color:var(--contrast-muted-foreground)] border-transparent text-foreground data-pressed:bg-accent [:hover,[data-pressed]]:bg-accent',
        'ghost-muted':
          '[--control-icon-color:currentColor] border-transparent text-muted-foreground data-pressed:bg-accent [:hover,[data-pressed]]:bg-accent [:hover,[data-pressed]]:text-foreground',
        'ghost-destructive':
          '[--control-icon-color:currentColor] border-transparent text-muted-foreground data-pressed:bg-accent [:hover,[data-pressed]]:bg-accent [:hover,[data-pressed]]:text-destructive',
        glass:
          'surface-glass [--control-icon-color:var(--contrast-muted-foreground)] rounded-full border-border/60 text-foreground shadow-sm before:rounded-full [:hover,[data-pressed]]:border-border',
        link: 'border-transparent underline-offset-4 [:hover,[data-pressed]]:underline',
        'media-close':
          '[--control-icon-color:currentColor] border-transparent bg-black/65 text-white shadow-sm ring-1 ring-white/20 [:hover,[data-pressed]]:bg-black/80 focus-visible:ring-white',
        'media-navigation':
          '[--control-icon-color:currentColor] absolute top-1/2 z-20 -translate-y-1/2 border-transparent text-white/90 [:hover,[data-pressed]]:bg-white/10 [:hover,[data-pressed]]:text-white focus-visible:ring-white focus-visible:ring-offset-transparent',
        outline:
          '[--control-icon-color:var(--contrast-muted-foreground)] border-input bg-popover not-dark:bg-clip-padding text-foreground shadow-xs/5 not-disabled:not-active:not-data-pressed:before:shadow-[0_1px_--theme(--color-black/4%)] dark:bg-input/32 dark:not-disabled:before:shadow-[0_-1px_--theme(--color-white/2%)] dark:not-disabled:not-active:not-data-pressed:before:shadow-[0_-1px_--theme(--color-white/6%)] [:disabled,:active,[data-pressed]]:shadow-none [:hover,[data-pressed]]:bg-accent/50 dark:[:hover,[data-pressed]]:bg-input/64',
        overlay: 'border-transparent bg-black/70 text-white/65 [:hover,[data-pressed]]:bg-black/90',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground [:active,[data-pressed]]:bg-secondary/80 [:hover,[data-pressed]]:bg-secondary/90',
        'warning-outline':
          'border-warning/32 bg-warning-surface text-warning-foreground shadow-xs/5 [:disabled,:active,[data-pressed]]:shadow-none [:hover,[data-pressed]]:border-warning/40 [:hover,[data-pressed]]:bg-warning/16 dark:[:hover,[data-pressed]]:bg-warning/24',
      },
    },
  },
);

type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>;
type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>['size']>;

interface ButtonProps extends useRender.ComponentProps<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

function Button({ className, variant, size, render, ...props }: ButtonProps) {
  const typeValue: React.ButtonHTMLAttributes<HTMLButtonElement>['type'] = render ? undefined : 'button';

  const defaultProps = {
    className: cn(buttonVariants({ className, size, variant })),
    'data-slot': 'button',
    type: typeValue,
  };

  return useRender({
    defaultTagName: 'button',
    props: mergeProps<'button'>(defaultProps, props),
    render,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Input

type InputProps = Omit<InputPrimitive.Props & React.RefAttributes<HTMLInputElement>, 'size'> & {
  size?: 'sm' | 'compact' | 'default' | 'lg' | number;
  font?: 'default' | 'mono';
  unstyled?: boolean;
  nativeInput?: boolean;
};

function Input({
  className,
  size = 'default',
  font = 'default',
  unstyled = false,
  nativeInput = false,
  ...props
}: InputProps) {
  const inputClassName = cn(
    'h-8.5 w-full min-w-0 rounded-[inherit] px-[calc(--spacing(3)-1px)] leading-8.5 outline-none placeholder:text-placeholder sm:h-7.5 sm:leading-7.5 [transition:background-color_5000000s_ease-in-out_0s]',
    size === 'compact' && 'h-7 px-[calc(--spacing(2.5)-1px)] text-xs leading-7 sm:h-7 sm:leading-7',
    size === 'sm' && 'h-7.5 px-[calc(--spacing(2.5)-1px)] leading-7.5 sm:h-6.5 sm:leading-6.5',
    size === 'lg' && 'h-9.5 leading-9.5 sm:h-8.5 sm:leading-8.5',
    props.type === 'search' &&
      '[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none [&::-webkit-search-results-button]:appearance-none [&::-webkit-search-results-decoration]:appearance-none',
    props.type === 'number' &&
      '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
    props.type === 'file' &&
      'text-muted-foreground file:me-3 file:bg-transparent file:font-medium file:text-foreground file:text-sm',
  );
  let inputElement: React.ReactElement;

  if (nativeInput) {
    const { style, onValueChange: _onValueChange, ...nativeInputProps } = props;
    const nativeStyle = typeof style === 'function' ? undefined : style;

    inputElement = (
      <input
        className={inputClassName}
        data-slot="input"
        size={typeof size === 'number' ? size : undefined}
        style={nativeStyle}
        {...(nativeInputProps as React.ComponentProps<'input'>)}
      />
    );
  } else {
    inputElement = (
      <InputPrimitive
        className={inputClassName}
        data-slot="input"
        size={typeof size === 'number' ? size : undefined}
        {...props}
      />
    );
  }

  return (
    <span
      className={
        cn(
          !unstyled &&
            'relative inline-flex w-full rounded-lg border border-input bg-background not-dark:bg-clip-padding text-base text-foreground shadow-xs/5 ring-ring/24 transition-shadow before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] not-has-disabled:not-has-focus-visible:not-has-aria-invalid:before:shadow-[0_1px_--theme(--color-black/4%)] has-focus-visible:has-aria-invalid:border-destructive/64 has-focus-visible:has-aria-invalid:ring-destructive/16 has-aria-invalid:border-destructive/36 has-focus-visible:border-ring has-autofill:bg-foreground/4 has-disabled:opacity-64 has-[:disabled,:focus-visible,[aria-invalid]]:shadow-none has-focus-visible:ring-[3px] has-focus-visible:ring-inset sm:text-sm dark:bg-input/32 dark:has-autofill:bg-foreground/8 dark:has-aria-invalid:ring-destructive/24 dark:not-has-disabled:not-has-focus-visible:not-has-aria-invalid:before:shadow-[0_-1px_--theme(--color-white/6%)]',
          !unstyled && size === 'compact' && 'rounded-md before:rounded-[calc(var(--radius-md)-1px)]',
          font === 'mono' && 'font-mono tabular-nums',
          className,
        ) || undefined
      }
      data-size={size}
      data-slot="input-control"
    >
      {inputElement}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Popover

const PLACEMENT_KEYS = ['position', 'top', 'right', 'bottom', 'left', 'transform'] as const;

type Placement = Pick<CSSProperties, (typeof PLACEMENT_KEYS)[number]>;

function ClosingPositioner({ open, style, ...props }: ComponentProps<'div'> & { open: boolean }) {
  const [openPlacement, setOpenPlacement] = useState<Placement>({});
  if (open && style && PLACEMENT_KEYS.some((key) => style[key] !== openPlacement[key])) {
    const { position, top, right, bottom, left, transform } = style;
    setOpenPlacement({ position, top, right, bottom, left, transform });
  }
  return <div {...props} style={open ? style : { ...style, ...openPlacement }} />;
}

function renderClosingPositioner(props: ComponentProps<'div'>, state: { open: boolean }) {
  return <ClosingPositioner {...props} open={state.open} />;
}

const Popover = PopoverPrimitive.Root;

function PopoverTrigger({ className, children, ...props }: PopoverPrimitive.Trigger.Props) {
  return (
    <PopoverPrimitive.Trigger className={className} data-slot="popover-trigger" {...props}>
      {children}
    </PopoverPrimitive.Trigger>
  );
}

const popoverPopupWidthClassName = {
  auto: '',
  sm: 'w-64',
  md: 'w-80',
  lg: 'w-96',
} as const;

const popoverViewportPaddingClassName = {
  default: 'py-4 [--viewport-inline-padding:--spacing(4)]',
  compact: 'py-2 [--viewport-inline-padding:--spacing(3)]',
  none: 'rounded-[calc(var(--radius-lg)-1px)] py-0 [--viewport-inline-padding:0px]',
} as const;

function PopoverPopup({
  children,
  className,
  padding = 'default',
  variant = 'default',
  width = 'auto',
  side = 'bottom',
  align = 'center',
  sideOffset = 4,
  alignOffset = 0,
  collisionAvoidance,
  tooltipStyle = false,
  keepMounted = false,
  anchor,
  touchBackdrop = false,
  ...props
}: PopoverPrimitive.Popup.Props & {
  padding?: keyof typeof popoverViewportPaddingClassName;
  variant?: 'default' | 'panel';
  side?: PopoverPrimitive.Positioner.Props['side'];
  align?: PopoverPrimitive.Positioner.Props['align'];
  sideOffset?: PopoverPrimitive.Positioner.Props['sideOffset'];
  alignOffset?: PopoverPrimitive.Positioner.Props['alignOffset'];
  collisionAvoidance?: PopoverPrimitive.Positioner.Props['collisionAvoidance'];
  tooltipStyle?: boolean;
  keepMounted?: PopoverPrimitive.Portal.Props['keepMounted'];
  anchor?: PopoverPrimitive.Positioner.Props['anchor'];
  width?: keyof typeof popoverPopupWidthClassName;
  touchBackdrop?: boolean;
}) {
  // Viewport rekeys on close; persistent single-trigger forms need stable containers for drafts and submit
  // guards.
  const Viewport = keepMounted ? 'div' : PopoverPrimitive.Viewport;
  return (
    <PopoverPrimitive.Portal keepMounted={keepMounted}>
      {touchBackdrop ? (
        // On touch, the backdrop consumes outside taps so closing cannot also activate the control beneath.
        <PopoverPrimitive.Backdrop
          className="fixed inset-0 z-[130] hidden pointer-coarse:block"
          data-slot="popover-backdrop"
        />
      ) : null}
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        collisionAvoidance={collisionAvoidance}
        collisionPadding={variant === 'panel' ? 0 : undefined}
        className={cn(
          'h-(--positioner-height) max-h-(--available-height) w-(--positioner-width) max-w-(--available-width)',
          // Kept-mounted positioners first paint at the window origin, so a transform transition slides them in from there.
          !keepMounted && 'transition-transform data-instant:transition-none',
          variant === 'panel'
            ? 'z-(--z-sheet) w-[min(calc(var(--thread-details-panel-width)+--spacing(4)),calc(var(--anchor-width)---spacing(2)))] transition-[top] duration-150 ease-out data-instant:transition-[top] motion-reduce:transition-none motion-reduce:data-instant:transition-none'
            : 'z-[130]',
        )}
        data-slot="popover-positioner"
        render={renderClosingPositioner}
        side={side}
        sideOffset={sideOffset}
      >
        <PopoverPrimitive.Popup
          className={cn(
            'relative flex h-(--popup-height,auto) w-(--popup-width,auto) origin-(--transform-origin) rounded-lg text-popover-foreground outline-none transition-[width,height,scale,opacity] before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] has-data-[slot=calendar]:rounded-xl has-data-[slot=calendar]:before:rounded-[calc(var(--radius-xl)-1px)] data-ending-style:scale-98 data-starting-style:scale-98 data-ending-style:opacity-0 data-starting-style:opacity-0 dark:before:shadow-[0_-1px_--theme(--color-white/6%)]',
            variant !== 'panel' && 'dropdown-glass',
            // Electron drag hit-testing ignores z-index; popups over a drag region would swallow hover.
            '[-webkit-app-region:no-drag]',
            tooltipStyle && 'w-fit rounded-md text-xs shadow-md/5 before:rounded-[calc(var(--radius-md)-1px)]',
            !tooltipStyle &&
              variant !== 'panel' &&
              'shadow-[0_16px_40px_-18px_rgb(0_0_0/55%)] dark:shadow-[0_18px_44px_-18px_rgb(0_0_0/80%)]',
            width !== 'auto' && ['max-w-[calc(100vw-2rem)]', popoverPopupWidthClassName[width]],
            variant === 'panel' &&
              'w-full overflow-visible rounded-none border-0 bg-transparent shadow-none before:hidden [backdrop-filter:none] [-webkit-backdrop-filter:none]',
            className,
          )}
          data-slot="popover-popup"
          {...props}
        >
          <Viewport
            className={cn(
              'relative size-full max-h-(--available-height) overflow-clip px-(--viewport-inline-padding) has-data-[slot=calendar]:p-2 data-instant:transition-none **:data-current:data-ending-style:opacity-0 **:data-current:data-starting-style:opacity-0 **:data-previous:data-ending-style:opacity-0 **:data-previous:data-starting-style:opacity-0 **:data-current:w-[calc(var(--popup-width)-2*var(--viewport-inline-padding)-2px)] **:data-previous:w-[calc(var(--popup-width)-2*var(--viewport-inline-padding)-2px)] **:data-current:opacity-100 **:data-previous:opacity-100 **:data-current:transition-opacity **:data-previous:transition-opacity',
              tooltipStyle && padding === 'default'
                ? 'py-1 [--viewport-inline-padding:--spacing(2)]'
                : popoverViewportPaddingClassName[padding],
              !tooltipStyle && 'not-data-transitioning:overflow-y-auto',
              variant === 'panel' && 'overflow-visible py-2 [--viewport-inline-padding:--spacing(2)]',
            )}
            data-slot="popover-viewport"
          >
            {children}
          </Viewport>
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Toggle and ToggleGroup

const toggleVariants = cva(
  "[&_svg]:-mx-0.5 relative inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg border font-medium text-base text-foreground outline-none transition-shadow before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 aria-disabled:opacity-64 data-pressed:bg-input/64 data-pressed:text-accent-foreground sm:text-sm [&_svg:not([class*='opacity-'])]:opacity-80 [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: {
      size: 'default',
      variant: 'default',
    },
    variants: {
      size: {
        compact:
          "h-7 min-w-7 rounded-md px-[calc(--spacing(1)-1px)] text-xs before:rounded-[calc(var(--radius-md)-1px)] [&_svg:not([class*='size-'])]:size-3.5",
        default: 'h-9 min-w-9 px-[calc(--spacing(2)-1px)] sm:h-8 sm:min-w-8',
        lg: 'h-10 min-w-10 px-[calc(--spacing(2.5)-1px)] sm:h-9 sm:min-w-9',
        segmented: 'h-6 min-w-0 rounded-md px-2.5 text-xs before:rounded-[calc(var(--radius-md)-1px)]',
        sm: 'h-8 min-w-8 px-[calc(--spacing(1.5)-1px)] sm:h-7 sm:min-w-7',
        xs: 'h-7 min-w-7 px-[calc(--spacing(1)-1px)] sm:h-6 sm:min-w-6 rounded-md',
      },
      variant: {
        default: 'border-transparent',
        pill: 'border-transparent rounded-full px-3 font-normal text-muted-foreground data-pressed:text-foreground',
        ghost:
          'border-transparent text-foreground shadow-none [:disabled,:active,[data-pressed]]:shadow-none before:shadow-none data-pressed:bg-accent data-pressed:text-accent-foreground disabled:opacity-100 disabled:text-muted-foreground disabled:[&_svg]:opacity-100',
        outline:
          'border-input bg-background not-dark:bg-clip-padding shadow-xs/5 not-disabled:not-active:not-data-pressed:before:shadow-[0_1px_--theme(--color-black/4%)] dark:bg-input/32 dark:data-pressed:bg-input dark:hover:bg-input/64 dark:not-disabled:not-active:not-data-pressed:before:shadow-[0_-1px_--theme(--color-white/6%)] dark:not-disabled:not-data-pressed:before:shadow-[0_-1px_--theme(--color-white/2%)] [:disabled,:active,[data-pressed]]:shadow-none',
        segmented:
          'border-transparent text-muted-foreground shadow-none transition-colors before:shadow-none hover:bg-background/55 hover:text-foreground data-pressed:bg-background data-pressed:text-foreground data-pressed:shadow-xs/10 dark:hover:bg-input/32 dark:data-pressed:bg-input/72',
      },
    },
  },
);

function ToggleComponent({
  className,
  variant,
  size,
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return <TogglePrimitive className={cn(toggleVariants({ className, size, variant }))} data-slot="toggle" {...props} />;
}

const ToggleGroupContext = React.createContext<VariantProps<typeof toggleVariants>>({
  size: 'default',
  variant: 'default',
});

function ToggleGroup({
  className,
  variant = 'segmented',
  size: sizeProp,
  orientation = 'horizontal',
  children,
  ...props
}: ToggleGroupPrimitive.Props & VariantProps<typeof toggleVariants>) {
  const size = sizeProp === undefined ? (variant === 'segmented' ? 'segmented' : 'default') : sizeProp;
  const value = { size, variant };
  return (
    <ToggleGroupPrimitive
      className={cn(
        'flex w-fit *:focus-visible:z-10 dark:*:[[data-slot=separator]:has(+[data-slot=toggle]:hover)]:before:bg-input/64 dark:*:[[data-slot=separator]:has(+[data-slot=toggle][data-pressed])]:before:bg-input dark:*:[[data-slot=toggle]:hover+[data-slot=separator]]:before:bg-input/64 dark:*:[[data-slot=toggle][data-pressed]+[data-slot=separator]]:before:bg-input',
        orientation === 'horizontal' ? '*:pointer-coarse:after:min-w-auto' : '*:pointer-coarse:after:min-h-auto',
        variant === 'segmented'
          ? 'gap-0.5 rounded-lg bg-input/40 p-0.5'
          : variant === 'default'
            ? 'gap-0.5'
            : orientation === 'horizontal'
              ? '*:not-first:not-data-[slot=separator]:before:-start-[0.5px] *:not-last:not-data-[slot=separator]:before:-end-[0.5px] *:not-first:rounded-s-none *:not-last:rounded-e-none *:not-first:border-s-0 *:not-last:border-e-0 *:not-first:before:rounded-s-none *:not-last:before:rounded-e-none'
              : '*:not-first:not-data-[slot=separator]:before:-top-[0.5px] *:not-last:not-data-[slot=separator]:before:-bottom-[0.5px] flex-col *:not-first:rounded-t-none *:not-last:rounded-b-none *:not-first:border-t-0 *:not-last:border-b-0 *:not-first:before:rounded-t-none *:not-last:before:rounded-b-none *:data-[slot=toggle]:not-last:before:hidden dark:*:last:before:hidden dark:*:first:before:block',
        className,
      )}
      data-size={size}
      data-slot="toggle-group"
      data-variant={variant}
      orientation={orientation}
      {...props}
    >
      <ToggleGroupContext value={value}>{children}</ToggleGroupContext>
    </ToggleGroupPrimitive>
  );
}

function Toggle({
  className,
  children,
  variant,
  size,
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  const context = React.use(ToggleGroupContext);

  const resolvedVariant = variant ?? context.variant;
  const resolvedSize = size ?? context.size;

  return (
    <ToggleComponent
      className={className}
      data-size={resolvedSize}
      data-variant={resolvedVariant}
      size={resolvedSize}
      variant={resolvedVariant}
      {...props}
    >
      {children}
    </ToggleComponent>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Color picker planes

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

function useColorDrag(
  update: (event: PointerEvent<HTMLDivElement>) => void,
  onInteractionEnd?: () => void,
  focusTarget?: RefObject<HTMLElement | null>,
) {
  const [isDragging, setIsDragging] = useState(false);
  const pointerId = useRef<number | null>(null);
  const stopDragging = (event: PointerEvent<HTMLDivElement>) => {
    if (pointerId.current !== event.pointerId) return;
    pointerId.current = null;
    setIsDragging(false);
    onInteractionEnd?.();
  };
  return {
    thumbTransition: isDragging ? undefined : 'left 80ms linear, top 80ms linear, background-color 80ms linear',
    handlers: {
      onPointerDown(event: PointerEvent<HTMLDivElement>) {
        if (pointerId.current !== null || event.button !== 0) return;
        pointerId.current = event.pointerId;
        (focusTarget?.current ?? event.currentTarget).focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        setIsDragging(true);
        update(event);
      },
      onPointerMove(event: PointerEvent<HTMLDivElement>) {
        if (pointerId.current === event.pointerId) update(event);
      },
      onPointerUp: stopDragging,
      onPointerCancel: stopDragging,
      onLostPointerCapture: stopDragging,
    },
  };
}

type ColorControlProps<T> = {
  label: string;
  value: T;
  onChange: (value: T) => void;
  onInteractionEnd?: () => void;
  className?: string;
};

export function ColorSaturationValuePlane({
  label,
  value,
  onChange,
  onInteractionEnd,
  className,
  variant = 'inset',
}: ColorControlProps<HsvColor> & { variant?: 'inset' | 'edge' }) {
  const instructionsId = useId();
  const saturationRef = useRef<HTMLInputElement>(null);
  const { handlers, thumbTransition } = useColorDrag(
    (event) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      onChange({
        ...value,
        s: clamp((event.clientX - bounds.left) / bounds.width),
        v: 1 - clamp((event.clientY - bounds.top) / bounds.height),
      });
    },
    onInteractionEnd,
    saturationRef,
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>, axis: 's' | 'v') => {
    const step = event.shiftKey ? 0.1 : 0.02;
    let nextValue: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        nextValue = clamp(value[axis] + step);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        nextValue = clamp(value[axis] - step);
        break;
      case 'Home':
        nextValue = 0;
        break;
      case 'End':
        nextValue = 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    onChange({ ...value, [axis]: nextValue });
  };

  return (
    <div
      aria-label={`${label} saturation and brightness`}
      role="group"
      className={cn(
        'relative cursor-crosshair touch-none overflow-hidden bg-[linear-gradient(to_top,#000,transparent),linear-gradient(to_right,#fff,transparent)] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-popover',
        variant === 'edge' ? 'h-36 rounded-none' : 'h-32 rounded-lg',
        className,
      )}
      style={{
        backgroundColor: `hsl(${value.h} 100% 50%)`,
      }}
      {...handlers}
    >
      <span id={instructionsId} className="sr-only">
        Use arrow keys to adjust the focused value. Hold Shift for larger steps. Use Home and End for the minimum and
        maximum. Press Tab to move between saturation and brightness.
      </span>
      {(
        [
          ['s', 'Saturation'],
          ['v', 'Brightness'],
        ] as const
      ).map(([axis, axisLabel]) => (
        <label key={axis} className="contents">
          <input
            ref={axis === 's' ? saturationRef : undefined}
            type="range"
            min={0}
            max={100}
            step="any"
            value={value[axis] * 100}
            aria-label={`${label} ${axisLabel.toLowerCase()}`}
            aria-describedby={instructionsId}
            aria-valuetext={`${Math.round(value[axis] * 100)}%`}
            className="peer sr-only"
            onKeyDown={(event) => handleKeyDown(event, axis)}
            onChange={(event) => onChange({ ...value, [axis]: event.currentTarget.valueAsNumber / 100 })}
          />
          <span
            aria-hidden
            className="pointer-events-none invisible absolute bottom-2 left-2 z-10 rounded bg-popover px-1.5 py-0.5 text-xs text-popover-foreground peer-focus-visible:visible"
          >
            {axisLabel} {Math.round(value[axis] * 100)}%
          </span>
        </label>
      ))}
      <span
        className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.4)]"
        style={{
          left: `calc(${value.s} * (100% - 0.75rem) + 0.375rem)`,
          top: `calc(${1 - value.v} * (100% - 0.75rem) + 0.375rem)`,
          transition: thumbTransition,
        }}
      />
    </div>
  );
}

export function ColorHueSlider({ label, value, onChange, onInteractionEnd, className }: ColorControlProps<number>) {
  const { handlers, thumbTransition } = useColorDrag((event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width) return;
    onChange(clamp((event.clientX - bounds.left) / bounds.width) * 360);
  }, onInteractionEnd);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      onChange(event.key === 'Home' ? 0 : 360);
      return;
    }
    if (!['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    const direction = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : -1;
    onChange((value + direction * step + 360) % 360);
  };

  return (
    <div
      aria-label={label}
      aria-valuemax={360}
      aria-valuemin={0}
      aria-valuenow={Math.round(value)}
      className={cn(
        'relative flex h-6 cursor-pointer touch-none items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover',
        className,
      )}
      role="slider"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      {...handlers}
    >
      <span
        aria-hidden
        className="h-2.5 w-full rounded-full bg-[linear-gradient(to_right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)] shadow-[inset_0_0_0_1px_rgb(0_0_0_/_12%)]"
      />
      <span
        className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.4)]"
        style={{
          left: `calc(${value / 360} * (100% - 1rem) + 0.5rem)`,
          backgroundColor: `hsl(${value} 100% 50%)`,
          transition: thumbTransition,
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// useViewportSize

const subscribeToViewport = (onChange: () => void) => {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
};
const readViewportWidth = () => window.innerWidth;
const readViewportHeight = () => window.innerHeight;

/** The window's CSS viewport, re-read on every resize. */
export function useViewportSize() {
  const width = useSyncExternalStore(subscribeToViewport, readViewportWidth);
  const height = useSyncExternalStore(subscribeToViewport, readViewportHeight);
  return { width, height };
}

export { Button, Input, Popover, PopoverPopup, PopoverTrigger, Toggle, ToggleGroup };
export type { ButtonSize, ButtonVariant, InputProps };
