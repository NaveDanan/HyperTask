// Copied from t3code (apps/web/src/components/ui/label.tsx), Copyright (c) 2026 T3 Tools Inc., MIT License.
// See src/shared/hyper-voice/NOTICE.md.
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import { cn } from "./lib";

function Label({ className, render, ...props }: useRender.ComponentProps<"label">) {
  const defaultProps = {
    className: cn(
      "inline-flex items-center gap-2 text-base/4.5 sm:text-sm/4 font-medium text-foreground",
      className,
    ),
    "data-slot": "label",
  };

  return useRender({
    defaultTagName: "label",
    props: mergeProps<"label">(defaultProps, props),
    render,
  });
}

export { Label };
