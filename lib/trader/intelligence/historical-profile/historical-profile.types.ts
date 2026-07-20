import type { HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1_DATA } from "@/lib/trader/intelligence/historical-profile/htr-historical-intelligence-profile-v1-data";

export const HISTORICAL_PROFILE_SCHEMA_VERSION = 2 as const;

export type HistoricalProfileId = "HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1";

export type HistoricalIntelligenceProfile = typeof HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1_DATA;
