import { cn } from "@/lib/utils";
import {
  FINAL_VISUAL_ALT,
  FINAL_VISUAL_INTRINSIC,
  FINAL_VISUAL_PATHS,
} from "@/lib/landing/final-visuals";

type NarrativeFinalImageProps = {
  asset: "twin" | "legacy";
  testId: string;
  className?: string;
  /** Prefer object-contain so relationship/crop zones stay fully visible. */
  objectFit?: "contain" | "cover";
};

/**
 * Final Human-approved raster plate for Twin / Legacy (DEE-608 B2).
 * Follows Hero `<picture>` / `<img>` convention — WebP only (no AVIF in B2).
 */
export function NarrativeFinalImage({
  asset,
  testId,
  className,
  objectFit = "contain",
}: NarrativeFinalImageProps) {
  const paths = FINAL_VISUAL_PATHS[asset];
  const alt = FINAL_VISUAL_ALT[asset];

  return (
    <div
      data-testid={testId}
      data-media-slot="final-art"
      className={cn(
        "relative w-full overflow-hidden rounded-xl border border-[rgba(218,200,160,0.2)]",
        "bg-[rgba(4,10,22,0.92)]",
        "aspect-[4/5]",
        className,
      )}
    >
      <picture data-testid={`${testId}-picture`}>
        {/*
          Single optimized WebP (~163–165 KB) — no srcset pipeline.
          Do not advertise `sizes` without alternate sources.
        */}
        <img
          data-testid={`${testId}-image`}
          src={paths.webp}
          alt={alt}
          width={FINAL_VISUAL_INTRINSIC.width}
          height={FINAL_VISUAL_INTRINSIC.height}
          className={cn(
            "absolute inset-0 h-full w-full select-none",
            objectFit === "cover" ? "object-cover object-center" : "object-contain object-center",
          )}
          draggable={false}
          decoding="async"
          loading="lazy"
        />
      </picture>
    </div>
  );
}
