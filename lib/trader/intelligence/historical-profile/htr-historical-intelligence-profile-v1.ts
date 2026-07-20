import { HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1_DATA } from "@/lib/trader/intelligence/historical-profile/htr-historical-intelligence-profile-v1-data";
import type {
  HistoricalIntelligenceProfile,
  HistoricalProfileId,
} from "@/lib/trader/intelligence/historical-profile/historical-profile.types";
import {
  computeHistoricalProfileDigest,
  canonicalizeHistoricalProfile,
} from "@/lib/trader/intelligence/historical-profile/serialize-historical-profile";

export type { HistoricalIntelligenceProfile, HistoricalProfileId };
export { HISTORICAL_PROFILE_SCHEMA_VERSION } from "@/lib/trader/intelligence/historical-profile/historical-profile.types";
export {
  canonicalizeHistoricalProfile,
  computeHistoricalProfileDigest,
} from "@/lib/trader/intelligence/historical-profile/serialize-historical-profile";

const STAGING_PROFILE =
  HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1_DATA as unknown as HistoricalIntelligenceProfile;

export const HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1: HistoricalIntelligenceProfile =
  canonicalizeHistoricalProfile(STAGING_PROFILE);

export const HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1_DIGEST = computeHistoricalProfileDigest(
  HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1,
);

export function isHistoricalProfileActive(
  profile: HistoricalIntelligenceProfile | undefined | null,
): profile is HistoricalIntelligenceProfile {
  if (!profile) return false;
  return (
    profile.profileId === HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1.profileId &&
    computeHistoricalProfileDigest(profile) === HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1_DIGEST
  );
}

export function assertHistoricalProfileNotGlobalDefault(): void {
  if (process.env.WAIA_MI_CORE_ENABLED === "1" || process.env.WAIA_MI_CORE_ENABLED === "true") {
    throw new Error(
      "WP13_GLOBAL_DEFAULT_ACTIVATION: env MI core flag is not equivalent to historical profile",
    );
  }
}
