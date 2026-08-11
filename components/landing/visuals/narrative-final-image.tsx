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
  /** Prefer object-contain so relationship/crop zones are not destroyed. */
  objectFit?: "contain" | "cover";
  /** Only enable when the optional AVIF file is actually shipped. */
  includeAvif?: boolean;
};

/**
 * Final Human-approved raster plate for V-TWIN / V-LEGACY (DEE-608 B2).
 * Follows Hero `<picture>` convention; AVIF only when explicitly enabled.
 */
export function NarrativeFinalImage({
  asset,
  testId,
  className,
  objectFit = "contain",
  includeAvif = false,
}: NarrativeFinalImageProps) {
  const paths = FINAL_VISUAL_PATHS[asset];
  const alt = FINAL_VISUAL_ALT[asset];

  return (
    <div
      data-testid={testId}
      data-media-slot="final-art"
      data-asset-id={asset === "twin" ? "V-TWIN" : "V-LEGACY"}
      className={cn(
        "relative w-full overflow-hidden rounded-xl border border-[rgba(218,200,160,0.2)]",
        "bg-[rgba(4,10,22,0.92)]",
        "aspect-[4/5] min-h-[14rem] sm:min-h-[16rem]",
        className,
      )}
    >
      <picture data-testid={`${testId}-picture`}>
        {includeAvif ? (
          <source data-testid={`${testId}-source-avif`} type="image/avif" srcSet={paths.avif} />
        ) : null}
        <img
          data-testid={`${testId}-image`}
          src={paths.webp}
          alt={alt}
          width={FINAL_VISUAL_INTRINSIC.width}
          height={FINAL_VISUAL_INTRINSIC.height}
          sizes="(max-width: 1023px) 100vw, 34vw"
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
