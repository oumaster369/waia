import { cn } from "@/lib/utils";

type FinalArtReadySlotProps = {
  testId: string;
  /** Production brief id, e.g. V-TWIN / V-LEGACY. */
  assetId: "V-TWIN" | "V-LEGACY";
  /** Semantic purpose for a11y (not a broken-image message). */
  purpose: string;
  className?: string;
  /** Soft compositional hint: twin dual-presence vs legacy continuity. */
  motif: "twin" | "legacy";
};

/**
 * Intentional final-artwork zone for DEE-608 B2.
 * Calm, complete composition — not a grey placeholder or broken image.
 * Removable when Human-approved raster assets arrive.
 */
export function FinalArtReadySlot({
  testId,
  assetId,
  purpose,
  className,
  motif,
}: FinalArtReadySlotProps) {
  const gradients =
    motif === "twin"
      ? "bg-[radial-gradient(ellipse_at_32%_38%,rgba(201,169,110,0.22),transparent_48%),radial-gradient(ellipse_at_72%_42%,rgba(170,190,220,0.2),transparent_50%),rgba(5,11,24,0.94)]"
      : "bg-[radial-gradient(ellipse_at_40%_30%,rgba(201,169,110,0.16),transparent_45%),radial-gradient(ellipse_at_55%_70%,rgba(180,160,130,0.12),transparent_55%),rgba(5,11,24,0.94)]";

  return (
    <div
      data-testid={testId}
      data-media-slot="final-art-ready"
      data-asset-id={assetId}
      role="img"
      aria-label={`${purpose}. Final artwork ${assetId} reserved for Human-approved production.`}
      className={cn(
        "relative aspect-[4/5] w-full overflow-hidden rounded-xl border border-[rgba(218,200,160,0.2)]",
        "min-h-[14rem] sm:min-h-[16rem]",
        gradients,
        className,
      )}
    >
      {/* Compositional guides — decorative only; removed with final art. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {motif === "twin" ? (
          <>
            <div className="absolute top-[28%] left-[18%] h-[38%] w-[28%] rounded-full border border-[rgba(218,200,160,0.22)] bg-[radial-gradient(circle_at_40%_35%,rgba(201,169,110,0.18),transparent_70%)]" />
            <div className="absolute top-[26%] right-[16%] h-[40%] w-[30%] rounded-full border border-[rgba(170,190,220,0.24)] bg-[radial-gradient(circle_at_55%_40%,rgba(180,200,230,0.16),transparent_70%)]" />
            <div className="absolute top-1/2 left-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[rgba(255,248,230,0.55)] shadow-[0_0_18px_rgba(232,220,180,0.45)]" />
          </>
        ) : (
          <>
            <div className="absolute top-[22%] left-[22%] h-[32%] w-[26%] rounded-[40%] border border-[rgba(218,200,160,0.18)] bg-[radial-gradient(circle_at_40%_30%,rgba(201,169,110,0.14),transparent_72%)]" />
            <div className="absolute right-[20%] bottom-[20%] h-[34%] w-[28%] rounded-[40%] border border-[rgba(200,185,160,0.2)] bg-[radial-gradient(circle_at_50%_40%,rgba(190,175,150,0.12),transparent_72%)]" />
            <div className="absolute top-[48%] left-[36%] h-px w-[28%] bg-[linear-gradient(90deg,transparent,rgba(218,200,160,0.45),transparent)]" />
          </>
        )}
      </div>
      <span className="sr-only">
        {assetId} production slot ready — {purpose}
      </span>
    </div>
  );
}
