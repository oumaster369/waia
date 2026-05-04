/**
 * DEE-53: Society v1 content map and Socialization action — deterministic rules only.
 * Readiness gating uses TwinReadinessResult.level (authoritative vs profile.readiness mirrors).
 */

import type { TwinProfile } from "@/lib/dashboard/twin-profile-api.types";
import type { TwinReadinessResult } from "@/lib/dashboard/twin-readiness-api.types";
import {
  SOCIETY_VISIBILITY_NOTICE_V1,
  SOCIALIZATION_EFFECT_V1,
  SOCIALIZATION_REQUIRED_READINESS_LEVEL_V1,
  TWIN_SOCIETY_SCHEMA_VERSION,
  type SocietyContentMap,
  type SocializationAction,
  type SocializationStatus,
} from "@/lib/dashboard/twin-society-api.types";

const TRAIT_SUMMARY_MAX = 4;

export type TwinSocietyContractInput = {
  profile: TwinProfile;
  readiness: TwinReadinessResult;
  /** Ephemeral defaults false; callers bind persistence later. */
  socializationCompleted?: boolean;
  socializationInProgress?: boolean;
};

function overallPercent(overall: number): number {
  if (!Number.isFinite(overall)) {
    return 0;
  }
  return Math.round(Math.min(1, Math.max(0, overall)) * 100);
}

function buildTraitSummary(profile: TwinProfile): string {
  const traits = profile.identity.dominantTraits.slice(0, TRAIT_SUMMARY_MAX);
  if (traits.length === 0) {
    return "No dominant trait labels yet.";
  }
  return traits.join(", ");
}

function nextActionCopy(status: SocializationStatus): string {
  switch (status) {
    case "not_ready":
      return "Continue building your Twin until maturity reaches high readiness to unlock socialization.";
    case "ready_to_start":
      return "Start socialization to open the Society workspace preview. Your profile remains private in v1.";
    case "socializing":
      return "Socialization is running; stay on this flow until it completes.";
    case "socialized":
      return "Society preview is available; your profile remains private in v1.";
  }
}

export function deriveSocializationStatus(input: TwinSocietyContractInput): SocializationStatus {
  if (input.socializationCompleted === true) {
    return "socialized";
  }
  if (input.socializationInProgress === true) {
    return "socializing";
  }
  if (input.readiness.level === "high") {
    return "ready_to_start";
  }
  return "not_ready";
}

function actionReason(status: SocializationStatus): { allowed: boolean; reason: string } {
  switch (status) {
    case "ready_to_start":
      return {
        allowed: true,
        reason:
          "Twin readiness is high; socialization can start. v1 keeps the Twin profile private and does not publish to a public feed.",
      };
    case "not_ready":
      return {
        allowed: false,
        reason: "Socialization requires high twin readiness in v1.",
      };
    case "socializing":
      return {
        allowed: false,
        reason: "Socialization is already in progress.",
      };
    case "socialized":
      return {
        allowed: false,
        reason: "Socialization has already completed for this Twin.",
      };
  }
}

export function getSocializationAction(input: TwinSocietyContractInput): SocializationAction {
  const status = deriveSocializationStatus(input);
  const { allowed, reason } = actionReason(status);
  return {
    action: "start_socialization",
    allowed,
    reason,
    requiredReadinessLevel: SOCIALIZATION_REQUIRED_READINESS_LEVEL_V1,
    requiresPublicProfile: false,
    effect: SOCIALIZATION_EFFECT_V1,
  };
}

function readinessBadgeText(readiness: TwinReadinessResult): string {
  const pct = overallPercent(readiness.overall);
  return `Twin maturity: ${readiness.level} (${pct}% overall signal).`;
}

export function buildSocietyContentMap(input: TwinSocietyContractInput): SocietyContentMap {
  const { profile, readiness } = input;
  const socializationStatus = deriveSocializationStatus(input);

  return {
    schemaVersion: TWIN_SOCIETY_SCHEMA_VERSION,
    profileCard: {
      title: profile.identity.title,
      shortDescription: profile.identity.shortDescription,
      tone: profile.expression.tone,
      traitSummary: buildTraitSummary(profile),
    },
    readinessBadge: readinessBadgeText(readiness),
    socializationStatus,
    visibilityNotice: SOCIETY_VISIBILITY_NOTICE_V1,
    nextAction: nextActionCopy(socializationStatus),
  };
}
