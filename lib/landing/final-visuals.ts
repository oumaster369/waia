/**
 * DEE-608 B2 — stable homepage-local final raster contract.
 * Production WebP assets live at the public paths below (no source PNG in git).
 */

export const FINAL_VISUAL_PATHS = {
  twin: {
    webp: "/landing/visuals/ai-twin.webp",
    avif: "/landing/visuals/ai-twin.avif",
    fsWebp: "public/landing/visuals/ai-twin.webp",
    fsAvif: "public/landing/visuals/ai-twin.avif",
  },
  legacy: {
    webp: "/landing/visuals/living-legacy.webp",
    avif: "/landing/visuals/living-legacy.avif",
    fsWebp: "public/landing/visuals/living-legacy.webp",
    fsAvif: "public/landing/visuals/living-legacy.avif",
  },
} as const;

/** Public alt text — no internal IDs, DEE refs, or production-status language. */
export const FINAL_VISUAL_ALT = {
  twin: "A human presence and a related digital presence meet at a soft threshold, suggesting AI-TWIN as a co-researcher.",
  legacy:
    "A present human, a preserved layer of lived experience, and a later generation connected through continuity of meaning.",
} as const;

/**
 * Intrinsic geometry of committed production WebPs (exact 4:5).
 * Must match the actual files — do not invent dimensions.
 */
export const FINAL_VISUAL_INTRINSIC = {
  width: 1120,
  height: 1400,
  aspectRatio: "4 / 5",
} as const;

export const FINAL_VISUAL_BUDGET_BYTES = 180_000;
