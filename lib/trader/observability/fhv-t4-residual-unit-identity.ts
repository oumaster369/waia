/**
 * DEE-436 — failed-run supervisor unit identity proof for governed recovery.
 */

import { createHash } from "node:crypto";

import type { FhvT4aSupervisorResidualUnitStateV1 } from "@/lib/trader/observability/fhv-t4-supervisor-residual-state";

export type FhvT4aResidualUnitIdentityClassification =
  | "FHV_T4A_RESIDUAL_UNIT_IDENTITY_MATCH"
  | "FHV_T4A_RESIDUAL_UNIT_IDENTITY_MISSING"
  | "FHV_T4A_RESIDUAL_UNIT_IDENTITY_TARGET_SHA_MISMATCH"
  | "FHV_T4A_RESIDUAL_UNIT_IDENTITY_RUN_ID_MISMATCH"
  | "FHV_T4A_RESIDUAL_UNIT_IDENTITY_ORG_MISMATCH"
  | "FHV_T4A_RESIDUAL_UNIT_IDENTITY_MIXED_PAIR"
  | "FHV_T4A_RESIDUAL_UNIT_IDENTITY_FRAGMENT_MISMATCH"
  | "FHV_T4A_RESIDUAL_UNIT_IDENTITY_CURRENT_RUN_DETECTED";

export class FhvT4aResidualUnitIdentityError extends Error {
  constructor(
    readonly code: FhvT4aResidualUnitIdentityClassification,
    message: string,
  ) {
    super(message);
    this.name = "FhvT4aResidualUnitIdentityError";
  }
}

function normalizeSha(value: string): string {
  return value.trim().toLowerCase();
}

function unitHasEmbeddedIdentity(unit: FhvT4aSupervisorResidualUnitStateV1): boolean {
  return Boolean(unit.embeddedRunId || unit.embeddedTargetSha || unit.embeddedOrganizationId);
}

export function classifyFhvT4aResidualUnitIdentity(input: {
  units: readonly FhvT4aSupervisorResidualUnitStateV1[];
  failedRunId: string;
  failedTargetSha: string;
  failedOrganizationId: string;
}): FhvT4aResidualUnitIdentityClassification {
  const failedTargetSha = normalizeSha(input.failedTargetSha);
  const presentUnits = input.units.filter((unit) => unit.unitFileExists);

  if (presentUnits.length === 0) {
    return "FHV_T4A_RESIDUAL_UNIT_IDENTITY_MISSING";
  }

  const embeddedUnits = presentUnits.filter(unitHasEmbeddedIdentity);
  if (embeddedUnits.length === 0) {
    return "FHV_T4A_RESIDUAL_UNIT_IDENTITY_MISSING";
  }

  const observer = input.units.find((unit) => unit.unitName === "waia-fhv-observer.service");
  const campaign = input.units.find((unit) => unit.unitName === "waia-fhv-campaign.service");
  if (!observer || !campaign) {
    return "FHV_T4A_RESIDUAL_UNIT_IDENTITY_MISSING";
  }

  for (const unit of embeddedUnits) {
    if (!unit.embeddedRunId || !unit.embeddedTargetSha || !unit.embeddedOrganizationId) {
      return "FHV_T4A_RESIDUAL_UNIT_IDENTITY_MISSING";
    }
    if (unit.embeddedRunId !== input.failedRunId) {
      if (unit.embeddedTargetSha && normalizeSha(unit.embeddedTargetSha) !== failedTargetSha) {
        return "FHV_T4A_RESIDUAL_UNIT_IDENTITY_CURRENT_RUN_DETECTED";
      }
      return "FHV_T4A_RESIDUAL_UNIT_IDENTITY_RUN_ID_MISMATCH";
    }
    if (normalizeSha(unit.embeddedTargetSha) !== failedTargetSha) {
      return "FHV_T4A_RESIDUAL_UNIT_IDENTITY_TARGET_SHA_MISMATCH";
    }
    if (unit.embeddedOrganizationId !== input.failedOrganizationId) {
      return "FHV_T4A_RESIDUAL_UNIT_IDENTITY_ORG_MISMATCH";
    }
    if (unit.workingDirectory && !unit.workingDirectory.includes(`waia-${failedTargetSha}`)) {
      return "FHV_T4A_RESIDUAL_UNIT_IDENTITY_FRAGMENT_MISMATCH";
    }
    if (unit.fragmentPath && unit.unitFilePath && unit.fragmentPath !== unit.unitFilePath) {
      return "FHV_T4A_RESIDUAL_UNIT_IDENTITY_FRAGMENT_MISMATCH";
    }
  }

  const observerEmbedded = unitHasEmbeddedIdentity(observer);
  const campaignEmbedded = unitHasEmbeddedIdentity(campaign);
  if (observerEmbedded !== campaignEmbedded) {
    return "FHV_T4A_RESIDUAL_UNIT_IDENTITY_MIXED_PAIR";
  }

  if (observerEmbedded && campaignEmbedded) {
    if (
      observer.embeddedRunId !== campaign.embeddedRunId ||
      normalizeSha(observer.embeddedTargetSha ?? "") !==
        normalizeSha(campaign.embeddedTargetSha ?? "") ||
      observer.embeddedOrganizationId !== campaign.embeddedOrganizationId
    ) {
      return "FHV_T4A_RESIDUAL_UNIT_IDENTITY_MIXED_PAIR";
    }
  }

  return "FHV_T4A_RESIDUAL_UNIT_IDENTITY_MATCH";
}

export function assertFhvT4aResidualUnitIdentityMatch(input: {
  units: readonly FhvT4aSupervisorResidualUnitStateV1[];
  failedRunId: string;
  failedTargetSha: string;
  failedOrganizationId: string;
}): FhvT4aResidualUnitIdentityClassification {
  const classification = classifyFhvT4aResidualUnitIdentity(input);
  if (classification !== "FHV_T4A_RESIDUAL_UNIT_IDENTITY_MATCH") {
    throw new FhvT4aResidualUnitIdentityError(classification, classification);
  }
  return classification;
}

export function fhvT4aResidualRecoveryBeforeStateDigest(
  beforeState: Readonly<{ units: readonly FhvT4aSupervisorResidualUnitStateV1[] }>,
): string {
  return createHash("sha256").update(JSON.stringify(beforeState), "utf8").digest("hex");
}

export function assertFhvT4aResidualRecoveryBeforeStateMatches(input: {
  authorized: Readonly<{ units: readonly FhvT4aSupervisorResidualUnitStateV1[] }>;
  observed: Readonly<{ units: readonly FhvT4aSupervisorResidualUnitStateV1[] }>;
  authorizedHostBootId: string;
  observedHostBootId: string;
}): void {
  if (input.authorizedHostBootId !== input.observedHostBootId) {
    throw new FhvT4aResidualUnitIdentityError(
      "FHV_T4A_RESIDUAL_UNIT_IDENTITY_FRAGMENT_MISMATCH",
      "Host boot ID drift between preview and confirm.",
    );
  }
  if (
    fhvT4aResidualRecoveryBeforeStateDigest(input.authorized) !==
    fhvT4aResidualRecoveryBeforeStateDigest(input.observed)
  ) {
    throw new FhvT4aResidualUnitIdentityError(
      "FHV_T4A_RESIDUAL_UNIT_IDENTITY_FRAGMENT_MISMATCH",
      "Before-state drift between preview and confirm.",
    );
  }
}
