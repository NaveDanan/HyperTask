// Ported from t3code (apps/web/src/components/ui/closing-positioner.tsx), Copyright (c) 2026 T3 Tools Inc., MIT License. See features/settings/appearance/NOTICE.md.
import * as React from "react"

const PLACEMENT_KEYS = ["position", "top", "right", "bottom", "left", "transform"] as const

type Placement = Pick<React.CSSProperties, (typeof PLACEMENT_KEYS)[number]>

// base-ui resets the positioner to top/left 0 with opacity 0 as soon as a popup starts closing, and
// it sets the placement again on open. Keep the last open placement while closing so the exit
// animation plays in place instead of jumping to the window origin, and drop that opacity 0 so the
// exit can fade. On open, base-ui's style is used unchanged, so the popup stays hidden until it has
// been positioned.
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
  if (open) {
    return <div {...props} style={style} />
  }
  return <div {...props} style={{ ...style, opacity: undefined, ...openPlacement }} />
}

export function renderClosingPositioner(
  props: React.ComponentProps<"div">,
  state: { open: boolean }
) {
  return <ClosingPositioner {...props} open={state.open} />
}
