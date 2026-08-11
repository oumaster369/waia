import { cn } from "@/lib/utils";

type NarrativeMediaSlotProps = {
  /** Short description of the future visual’s job (for a11y). */
  purpose: string;
  testId: string;
  className?: string;
};

/**
 * Intentional future visual zone for DEE-608.
 * Looks complete without artwork — no broken placeholders, stock, or generated images.
 */
export function NarrativeMediaSlot({
  purpose,
  testId,
  className,
}: NarrativeMediaSlotProps) {
  return (
    <div
      data-testid={testId}
      data-media-slot="reserved"
      role="img"
      aria-label={`${purpose}. Visual narrative reserved for a later asset.`}
      className={cn(
        "relative min-h-[9rem] overflow-hidden rounded-xl border border-[rgba(218,200,160,0.16)] sm:min-h-[11rem]",
        "bg-[radial-gradient(ellipse_at_30%_20%,rgba(201,169,110,0.14),transparent_55%),radial-gradient(ellipse_at_80%_70%,rgba(160,180,210,0.1),transparent_50%),rgba(6,12,28,0.85)]",
        className,
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 50% 50%, rgba(255,252,245,0.04) 0%, transparent 62%)",
        }}
      />
      <span className="sr-only">Future visual slot: {purpose}</span>
    </div>
  );
}
