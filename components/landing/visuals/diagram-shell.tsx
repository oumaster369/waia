import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type DiagramShellProps = {
  testId: string;
  /** Accessible name for the diagram as a whole. */
  label: string;
  /** Longer description when the SVG is decorative relative to nearby text. */
  description?: string;
  className?: string;
  /** Aspect ratio utility; default 4/5 for column diagrams. */
  aspectClassName?: string;
  children: ReactNode;
};

/**
 * Calm midnight frame for homepage-local SVG diagrams (DEE-608 B1).
 */
export function DiagramShell({
  testId,
  label,
  description,
  className,
  aspectClassName = "aspect-[4/5]",
  children,
}: DiagramShellProps) {
  return (
    <figure
      data-testid={testId}
      data-media-slot="diagram"
      className={cn(
        "relative w-full overflow-hidden rounded-xl border border-[rgba(218,200,160,0.18)]",
        "bg-[radial-gradient(ellipse_at_28%_18%,rgba(201,169,110,0.1),transparent_52%),radial-gradient(ellipse_at_78%_78%,rgba(160,180,210,0.08),transparent_48%),rgba(4,10,22,0.92)]",
        aspectClassName,
        className,
      )}
    >
      <svg
        viewBox="0 0 320 400"
        className="h-full w-full"
        role="img"
        aria-label={description ? `${label}. ${description}` : label}
      >
        {children}
      </svg>
    </figure>
  );
}
