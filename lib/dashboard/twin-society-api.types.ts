/** Society v1 content map and Socialization action contract (DEE-53) — logical only; no persistence. */

export const TWIN_SOCIETY_SCHEMA_VERSION = "twin-society-v1" as const;

export type TwinSocietySchemaVersion = typeof TWIN_SOCIETY_SCHEMA_VERSION;

export type SocializationStatus = "not_ready" | "ready_to_start" | "socializing" | "socialized";

export const SOCIALIZATION_EFFECT_V1 = "marks_twin_ready_for_society_preview" as const;

export type SocializationEffectV1 = typeof SOCIALIZATION_EFFECT_V1;

export const SOCIALIZATION_REQUIRED_READINESS_LEVEL_V1 = "high" as const;

export type SocietyProfileCard = {
  title: string;
  shortDescription: string;
  tone: string;
  /** Joined dominant traits (capped in builder); deterministic. */
  traitSummary: string;
};

/** Single fixed string for twin-society-v1; no public feed, discovery, or publishing in v1. */
export const SOCIETY_VISIBILITY_NOTICE_V1 =
  "Society v1 is a private preview: your Twin profile stays private, with no public publishing, no discovery or matching between users, no social graph, and no external sharing. RAW diary text never appears outside your private Twin surface." as const;

export type SocietyContentMap = {
  schemaVersion: TwinSocietySchemaVersion;
  profileCard: SocietyProfileCard;
  readinessBadge: string;
  socializationStatus: SocializationStatus;
  visibilityNotice: typeof SOCIETY_VISIBILITY_NOTICE_V1;
  nextAction: string;
};

export type SocializationAction = {
  action: "start_socialization";
  allowed: boolean;
  reason: string;
  requiredReadinessLevel: typeof SOCIALIZATION_REQUIRED_READINESS_LEVEL_V1;
  requiresPublicProfile: false;
  effect: SocializationEffectV1;
};
