import type { HistoricalIntelligenceProfile } from "@/lib/trader/intelligence/historical-profile/historical-profile.types";
import { isHistoricalProfileActive } from "@/lib/trader/intelligence/historical-profile/htr-historical-intelligence-profile-v1";

/**
 * PR-2 Market Intelligence Core feature gate.
 * Default OFF — when disabled the pipeline is byte-identical to understanding → CDE.
 * HTR-WP13: historical profile activation is explicit and digest-validated; env flag alone is not equivalent.
 */
export function isMiCoreEnabled(
  raw: string | undefined = process.env.WAIA_MI_CORE_ENABLED,
  historicalProfile?: HistoricalIntelligenceProfile | null,
): boolean {
  if (historicalProfile && isHistoricalProfileActive(historicalProfile)) {
    return true;
  }
  if (!raw) {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}
