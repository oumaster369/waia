import {
  canonicalizeSemanticObject,
  computeSemanticSha256Hex,
} from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type { HistoricalIntelligenceProfile } from "@/lib/trader/intelligence/historical-profile/historical-profile.types";

export function canonicalizeHistoricalProfile(
  profile: HistoricalIntelligenceProfile,
): HistoricalIntelligenceProfile {
  return canonicalizeSemanticObject(
    profile as unknown as Record<string, unknown>,
  ) as unknown as HistoricalIntelligenceProfile;
}

export function computeHistoricalProfileDigest(profile: HistoricalIntelligenceProfile): string {
  return computeSemanticSha256Hex(canonicalizeHistoricalProfile(profile));
}
