/** Twin external / user-facing identity contract (DEE-46) — logical schema; no persistence here. */

import type { TwinReadinessLevel } from "@/lib/dashboard/twin-readiness-api.types";

export const TWIN_PROFILE_SCHEMA_VERSION = "twin-profile-v1" as const;

export type TwinProfileSchemaVersion = typeof TWIN_PROFILE_SCHEMA_VERSION;

export type TwinProfile = {
  schemaVersion: TwinProfileSchemaVersion;
  identity: {
    title: string;
    shortDescription: string;
    dominantTraits: string[];
  };
  expression: {
    tone: string;
    communicationStyle: string[];
  };
  behavior: {
    decisionStyle: string[];
    relationshipStyle: string[];
  };
  emotionalProfile: {
    emotionalPatterns: string[];
  };
  contradictions: {
    contradictions: string[];
  };
  readiness: {
    level: TwinReadinessLevel;
  };
  visibility: {
    isPublic: boolean;
  };
};
