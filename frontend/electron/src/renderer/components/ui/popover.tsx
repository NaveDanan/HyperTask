// Ported from t3code (apps/web/src/components/ui/popover.tsx), Copyright (c) 2026 T3 Tools Inc., MIT License. See features/settings/appearance/NOTICE.md.
import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import { cn } from "cn"

const PLACEMENT_KEYS = ["position", "top", "right", "bottom", "left", "transform"] as const

type Placement = Pick<React.CSSProperties, (typeof PLACEMENT_KEYS)[number]>

// Ported from t3code's closing-positioner.tsx (same folder). Keeps the last open placement while the
// popup closes, so its exit transition does not jump to the window origin.
function ClosingPositioner({
  open,
  style,
  ...props
}: React.ComponentProps<"div"> & { open: boolean }) {
  const [openPlacement, setOpenPlacement] = React.useState<Placement>({})
  if (open && style && PLACEMENT_KEYS.some((key) => style[key] !== openPlacement[key])) {
    const { position, top, right, bottom, left, transform } = style
    setOpenPlacement({ position, top, right, bottom, left, transform })
  }
  return <div {...props} style={open ? style : { ...style, ...openPlacement }} />
}

export function renderClosingPositioner(
  props: React.ComponentProps<"div">,
  state: { open: boolean }
) {
  return <ClosingPositioner {...props} open={state.open} />
}

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  align = "center",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<
    PopoverPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50 transition-transform data-instant:transition-none"
        render={renderClosingPositioner}
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "dropdown-glass z-50 flex w-72 origin-(--transform-origin) flex-col gap-2.5 rounded-lg p-2.5 text-sm text-popover-foreground shadow-[0_16px_40px_-18px_rgb(0_0_0/55%)] outline-hidden transition-[width,height,scale,opacity] data-ending-style:scale-98 data-starting-style:scale-98 data-ending-style:opacity-0 data-starting-style:opacity-0 dark:shadow-[0_18px_44px_-18px_rgb(0_0_0/80%)]",
            className
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("flex flex-col gap-0.5 text-sm", className)}
      {...props}
    />
  )
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
  return (
    <PopoverPrimitive.Title
      data-slot="popover-title"
      className={cn("font-medium", className)}
      {...props}
    />
  )
}

function PopoverDescription({
  className,
  ...props
}: PopoverPrimitive.Description.Props) {
  return (
    <PopoverPrimitive.Description
      data-slot="popover-description"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
}
