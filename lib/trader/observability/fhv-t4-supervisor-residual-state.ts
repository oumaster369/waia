/**
 * DEE-436 — PRE_AUTH supervisor residual-state proof parsing and fail-closed policy.
 */

import { createHash } from "node:crypto";

import {
  FHV_SYSTEMD_ALLOWED_UNITS,
  type FhvSystemdAllowedUnit,
} from "@/lib/trader/observability/fhv-systemd-unit-config";

export const FHV_T4A_SUPERVISOR_RESIDUAL_STATE_SCHEMA =
  "fhv-t4-supervisor-residual-state/v1" as const;

export const FHV_T4A_RESIDUAL_RECOVERY_SCHEMA = "fhv-t4-supervisor-residual-recovery/v1" as const;

export type FhvT4aSupervisorResidualUnitStateV1 = Readonly<{
  unitName: FhvSystemdAllowedUnit;
  unitFileExists: boolean;
  unitFilePath: string;
  unitFileSha256: string | null;
  loadState: string;
  unitFileState: string;
  activeState: string;
  subState: string;
  fragmentPath: string;
  enabledState: string;
  activeClass: string;
  isFailed: boolean;
  execStart: string;
  workingDirectory: string;
  environmentFilePath: string;
  embeddedRunId: string | null;
  embeddedTargetSha: string | null;
  embeddedOrganizationId: string | null;
}>;

export type FhvT4aSupervisorResidualStateProofV1 = Readonly<{
  schemaVersion: typeof FHV_T4A_SUPERVISOR_RESIDUAL_STATE_SCHEMA;
  expectedRunId: string;
  expectedTargetSha: string;
  expectedOrganizationId: string;
  expectedHostname: string;
  expectedMachineIdSha256: string;
  observedHostname: string;
  observedMachineIdSha256: string;
  hostBootId: string;
  units: readonly FhvT4aSupervisorResidualUnitStateV1[];
}>;

export type FhvT4aSupervisorResidualClassification =
  | "FHV_T4A_SUPERVISOR_RESIDUAL_SAFE"
  | "FHV_T4A_SUPERVISOR_RESIDUAL_BLOCKED_ENABLED"
  | "FHV_T4A_SUPERVISOR_RESIDUAL_BLOCKED_ACTIVE"
  | "FHV_T4A_SUPERVISOR_RESIDUAL_BLOCKED_FAILED"
  | "FHV_T4A_SUPERVISOR_RESIDUAL_BLOCKED_HOST_IDENTITY"
  | "FHV_T4A_SUPERVISOR_RESIDUAL_BLOCKED_UNIT_IDENTITY";

export class FhvT4aSupervisorResidualStateError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvT4aSupervisorResidualStateError";
  }
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function parseUnit(raw: unknown, index: number): FhvT4aSupervisorResidualUnitStateV1 {
  if (typeof raw !== "object" || raw === null) {
    throw new FhvT4aSupervisorResidualStateError(
      "FHV_T4A_SUPERVISOR_RESIDUAL_UNIT_INVALID",
      `Unit ${index} must be an object.`,
    );
  }
  const unit = raw as FhvT4aSupervisorResidualUnitStateV1;
  if (!FHV_SYSTEMD_ALLOWED_UNITS.includes(unit.unitName as FhvSystemdAllowedUnit)) {
    throw new FhvT4aSupervisorResidualStateError(
      "FHV_T4A_SUPERVISOR_RESIDUAL_UNIT_NOT_ALLOWLISTED",
      `Unit not allowlisted: ${String(unit.unitName)}`,
    );
  }
  if (typeof unit.unitFileExists !== "boolean") {
    throw new FhvT4aSupervisorResidualStateError(
      "FHV_T4A_SUPERVISOR_RESIDUAL_UNIT_INVALID",
      "unitFileExists required.",
    );
  }
  return unit;
}

export function parseFhvT4aSupervisorResidualStateProof(
  raw: unknown,
): FhvT4aSupervisorResidualStateProofV1 {
  if (typeof raw !== "object" || raw === null) {
    throw new FhvT4aSupervisorResidualStateError(
      "FHV_T4A_SUPERVISOR_RESIDUAL_INVALID",
      "Residual state payload must be an object.",
    );
  }
  const payload = raw as FhvT4aSupervisorResidualStateProofV1;
  if (payload.schemaVersion !== FHV_T4A_SUPERVISOR_RESIDUAL_STATE_SCHEMA) {
    throw new FhvT4aSupervisorResidualStateError(
      "FHV_T4A_SUPERVISOR_RESIDUAL_SCHEMA_MISMATCH",
      "schemaVersion mismatch.",
    );
  }
  if (!Array.isArray(payload.units) || payload.units.length !== 2) {
    throw new FhvT4aSupervisorResidualStateError(
      "FHV_T4A_SUPERVISOR_RESIDUAL_UNITS_INVALID",
      "Exactly two allowlisted units required.",
    );
  }
  const units = payload.units.map((unit, index) => parseUnit(unit, index));
  const unitNames = new Set(units.map((unit) => unit.unitName));
  if (unitNames.size !== 2) {
    throw new FhvT4aSupervisorResidualStateError(
      "FHV_T4A_SUPERVISOR_RESIDUAL_UNITS_INVALID",
      "Duplicate unit names in residual proof.",
    );
  }
  return { ...payload, units };
}

export function fhvT4aSupervisorResidualStateDigest(
  proof: FhvT4aSupervisorResidualStateProofV1,
): string {
  return sha256Hex(JSON.stringify(proof));
}

export function classifyFhvT4aSupervisorResidualState(
  proof: FhvT4aSupervisorResidualStateProofV1,
): FhvT4aSupervisorResidualClassification {
  if (
    proof.observedHostname !== proof.expectedHostname ||
    proof.observedMachineIdSha256 !== proof.expectedMachineIdSha256
  ) {
    return "FHV_T4A_SUPERVISOR_RESIDUAL_BLOCKED_HOST_IDENTITY";
  }

  for (const unit of proof.units) {
    if (unit.isFailed || unit.activeState === "failed" || unit.subState === "failed") {
      return "FHV_T4A_SUPERVISOR_RESIDUAL_BLOCKED_FAILED";
    }
    if (unit.activeClass === "active") {
      return "FHV_T4A_SUPERVISOR_RESIDUAL_BLOCKED_ACTIVE";
    }
    if (unit.enabledState === "enabled") {
      return "FHV_T4A_SUPERVISOR_RESIDUAL_BLOCKED_ENABLED";
    }
    const hasEmbeddedIdentity =
      unit.embeddedRunId || unit.embeddedTargetSha || unit.embeddedOrganizationId;
    if (
      hasEmbeddedIdentity &&
      (unit.embeddedRunId !== proof.expectedRunId ||
        unit.embeddedTargetSha !== proof.expectedTargetSha ||
        unit.embeddedOrganizationId !== proof.expectedOrganizationId) &&
      (unit.enabledState === "enabled" || unit.activeClass === "active")
    ) {
      return "FHV_T4A_SUPERVISOR_RESIDUAL_BLOCKED_UNIT_IDENTITY";
    }
  }

  return "FHV_T4A_SUPERVISOR_RESIDUAL_SAFE";
}

export function assertFhvT4aSupervisorResidualStateSafe(
  proof: FhvT4aSupervisorResidualStateProofV1,
): FhvT4aSupervisorResidualClassification {
  const classification = classifyFhvT4aSupervisorResidualState(proof);
  if (classification !== "FHV_T4A_SUPERVISOR_RESIDUAL_SAFE") {
    throw new FhvT4aSupervisorResidualStateError(classification, classification);
  }
  return classification;
}

export function assertResidualProofMatchesFreshRunBindings(input: {
  proof: FhvT4aSupervisorResidualStateProofV1;
  runId: string;
  targetSha: string;
  organizationId: string;
  expectedHostname: string;
  expectedMachineIdSha256: string;
}): void {
  const { proof } = input;
  if (proof.expectedRunId !== input.runId) {
    throw new FhvT4aSupervisorResidualStateError(
      "FHV_T4A_SUPERVISOR_RESIDUAL_BINDING_MISMATCH",
      "expectedRunId mismatch.",
    );
  }
  if (proof.expectedTargetSha !== input.targetSha) {
    throw new FhvT4aSupervisorResidualStateError(
      "FHV_T4A_SUPERVISOR_RESIDUAL_BINDING_MISMATCH",
      "expectedTargetSha mismatch.",
    );
  }
  if (proof.expectedOrganizationId !== input.organizationId) {
    throw new FhvT4aSupervisorResidualStateError(
      "FHV_T4A_SUPERVISOR_RESIDUAL_BINDING_MISMATCH",
      "expectedOrganizationId mismatch.",
    );
  }
  if (proof.expectedHostname !== input.expectedHostname) {
    throw new FhvT4aSupervisorResidualStateError(
      "FHV_T4A_SUPERVISOR_RESIDUAL_BINDING_MISMATCH",
      "expectedHostname mismatch.",
    );
  }
  if (proof.expectedMachineIdSha256 !== input.expectedMachineIdSha256) {
    throw new FhvT4aSupervisorResidualStateError(
      "FHV_T4A_SUPERVISOR_RESIDUAL_BINDING_MISMATCH",
      "expectedMachineIdSha256 mismatch.",
    );
  }
}
