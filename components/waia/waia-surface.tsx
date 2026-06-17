import * as React from "react";

import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const waiaSurfaceVariants = cva("", {
  variants: {
    variant: {
      /** Subtle instrumental panel (chat log, workspace sections). */
      raised: "rounded-waia-surface border border-border bg-muted/10",
      /** Solid raised surface using WAIA semantic tokens. */
      elevated: "rounded-waia-surface border border-waia-divider bg-waia-elevated",
      /** First-start / invitation framing with dashed border. */
      invitation: "rounded-waia-ceremonial border border-dashed border-border bg-muted/20",
    },
  },
  defaultVariants: {
    variant: "raised",
  },
});

export type WaiaSurfaceProps = React.ComponentPropsWithoutRef<"div"> &
  VariantProps<typeof waiaSurfaceVariants>;

const WaiaSurface = React.forwardRef<HTMLDivElement, WaiaSurfaceProps>(function WaiaSurface(
  { className, variant, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      data-slot="waia-surface"
      className={cn(waiaSurfaceVariants({ variant }), className)}
      {...props}
    />
  );
});

export { WaiaSurface, waiaSurfaceVariants };
