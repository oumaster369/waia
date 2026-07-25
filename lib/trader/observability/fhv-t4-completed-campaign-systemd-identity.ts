/**
 * DEE-436 — machine-derived completed waia-fhv-campaign.service systemd identity.
 */

import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import { normalizeFhvT4BootId } from "@/lib/trader/observability/fhv-t4-boot-id";

export const FHV_T4_COMPLETED_CAMPAIGN_SYSTEMD_IDENTITY_SCHEMA_VERSION =
  "fhv-t4-completed-campaign-systemd-identity/v1" as const;

export type FhvT4CompletedCampaignSystemdIdentityV1 = Readonly<{
  schemaVersion: typeof FHV_T4_COMPLETED_CAMPAIGN_SYSTEMD_IDENTITY_SCHEMA_VERSION;
  unitName: string;
  bootId: string;
  activeState: string;
  subState: string;
  result: string;
  invocationId: string;
  execMainPid: number;
  execMainStartTimestampMonotonic: string;
  execMainExitTimestampMonotonic: string;
  execMainCode: number;
  execMainStatus: number;
  nRestarts: number;
  contentDigest: string;
}>;

export class FhvT4CompletedCampaignSystemdIdentityError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvT4CompletedCampaignSystemdIdentityError";
  }
}

const BOOT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function normalizeBootIdField(raw: string): string {
  return normalizeFhvT4BootId(raw);
}

export type FhvT4CompletedCampaignSystemdIdentityReader = (
  unitName?: string,
) => FhvT4CompletedCampaignSystemdIdentityV1;

let readerOverride: FhvT4CompletedCampaignSystemdIdentityReader | null = null;

export function setFhvT4CompletedCampaignSystemdIdentityReaderForTests(
  reader: FhvT4CompletedCampaignSystemdIdentityReader | null,
): void {
  readerOverride = reader;
}

export function serializeFhvT4CompletedCampaignSystemdIdentity(
  input: Omit<FhvT4CompletedCampaignSystemdIdentityV1, "contentDigest">,
): FhvT4CompletedCampaignSystemdIdentityV1 {
  const withoutDigest = { ...input };
  return {
    ...withoutDigest,
    contentDigest: computePayloadDigest(withoutDigest),
  };
}

export function parseFhvT4CompletedCampaignSystemdIdentity(
  raw: unknown,
): FhvT4CompletedCampaignSystemdIdentityV1 {
  if (typeof raw !== "object" || raw === null) {
    throw new FhvT4CompletedCampaignSystemdIdentityError(
      "FHV_T4_COMPLETED_CAMPAIGN_IDENTITY_INVALID",
      "Completed campaign systemd identity must be an object.",
    );
  }
  const identity = raw as FhvT4CompletedCampaignSystemdIdentityV1;
  if (identity.schemaVersion !== FHV_T4_COMPLETED_CAMPAIGN_SYSTEMD_IDENTITY_SCHEMA_VERSION) {
    throw new FhvT4CompletedCampaignSystemdIdentityError(
      "FHV_T4_COMPLETED_CAMPAIGN_IDENTITY_SCHEMA_MISMATCH",
      "Completed campaign identity schemaVersion mismatch.",
    );
  }
  if (!identity.unitName.trim() || !identity.unitName.includes("campaign")) {
    throw new FhvT4CompletedCampaignSystemdIdentityError(
      "FHV_T4_COMPLETED_CAMPAIGN_IDENTITY_UNIT_INVALID",
      "unitName must identify the campaign unit.",
    );
  }
  if (!BOOT_ID_PATTERN.test(normalizeBootIdField(identity.bootId))) {
    throw new FhvT4CompletedCampaignSystemdIdentityError(
      "FHV_T4_COMPLETED_CAMPAIGN_IDENTITY_BOOT_ID_INVALID",
      "bootId invalid.",
    );
  }
  if (!identity.invocationId.trim()) {
    throw new FhvT4CompletedCampaignSystemdIdentityError(
      "FHV_T4_COMPLETED_CAMPAIGN_IDENTITY_INVOCATION_REQUIRED",
      "invocationId is required.",
    );
  }
  if (identity.activeState.trim() !== "inactive") {
    throw new FhvT4CompletedCampaignSystemdIdentityError(
      "FHV_T4_COMPLETED_CAMPAIGN_IDENTITY_NOT_INACTIVE",
      "Completed campaign must be inactive.",
    );
  }
  if (identity.result.trim() !== "success") {
    throw new FhvT4CompletedCampaignSystemdIdentityError(
      "FHV_T4_COMPLETED_CAMPAIGN_IDENTITY_RESULT_INVALID",
      "Completed campaign Result must be success.",
    );
  }
  if (!Number.isInteger(identity.execMainPid) || identity.execMainPid <= 0) {
    throw new FhvT4CompletedCampaignSystemdIdentityError(
      "FHV_T4_COMPLETED_CAMPAIGN_IDENTITY_EXEC_MAIN_PID_INVALID",
      "execMainPid must be a positive retained integer.",
    );
  }
  if (!Number.isInteger(identity.nRestarts) || identity.nRestarts < 0) {
    throw new FhvT4CompletedCampaignSystemdIdentityError(
      "FHV_T4_COMPLETED_CAMPAIGN_IDENTITY_NRESTARTS_INVALID",
      "nRestarts must be a non-negative integer.",
    );
  }
  if (identity.execMainCode !== 1) {
    throw new FhvT4CompletedCampaignSystemdIdentityError(
      "FHV_T4_COMPLETED_CAMPAIGN_IDENTITY_EXIT_CODE_INVALID",
      "Completed campaign ExecMainCode must be 1 (CLD_EXITED).",
    );
  }
  if (identity.execMainStatus !== 0) {
    throw new FhvT4CompletedCampaignSystemdIdentityError(
      "FHV_T4_COMPLETED_CAMPAIGN_IDENTITY_EXIT_STATUS_INVALID",
      "Completed campaign ExecMainStatus must be 0.",
    );
  }
  if (
    !identity.execMainStartTimestampMonotonic.trim() ||
    identity.execMainStartTimestampMonotonic.trim() === "0" ||
    !identity.execMainExitTimestampMonotonic.trim() ||
    identity.execMainExitTimestampMonotonic.trim() === "0"
  ) {
    throw new FhvT4CompletedCampaignSystemdIdentityError(
      "FHV_T4_COMPLETED_CAMPAIGN_IDENTITY_TIMESTAMPS_INVALID",
      "Retained execution timestamps must be nonzero.",
    );
  }
  if (
    BigInt(identity.execMainExitTimestampMonotonic.trim()) <=
    BigInt(identity.execMainStartTimestampMonotonic.trim())
  ) {
    throw new FhvT4CompletedCampaignSystemdIdentityError(
      "FHV_T4_COMPLETED_CAMPAIGN_IDENTITY_TIMESTAMP_ORDER_INVALID",
      "ExecMainExitTimestampMonotonic must be after start.",
    );
  }
  const normalized = {
    schemaVersion: identity.schemaVersion,
    unitName: identity.unitName.trim(),
    bootId: normalizeBootIdField(identity.bootId),
    activeState: identity.activeState.trim(),
    subState: identity.subState.trim(),
    result: identity.result.trim(),
    invocationId: identity.invocationId.trim(),
    execMainPid: identity.execMainPid,
    execMainStartTimestampMonotonic: identity.execMainStartTimestampMonotonic.trim(),
    execMainExitTimestampMonotonic: identity.execMainExitTimestampMonotonic.trim(),
    execMainCode: identity.execMainCode,
    execMainStatus: identity.execMainStatus,
    nRestarts: identity.nRestarts,
  };
  const { contentDigest, ...withoutDigest } = identity;
  if (computePayloadDigest(withoutDigest) !== contentDigest) {
    throw new FhvT4CompletedCampaignSystemdIdentityError(
      "FHV_T4_COMPLETED_CAMPAIGN_IDENTITY_DIGEST_MISMATCH",
      "contentDigest mismatch.",
    );
  }
  return { ...normalized, contentDigest };
}

export function readFhvT4CompletedCampaignSystemdIdentity(
  repoRoot: string,
  unitName = "waia-fhv-campaign.service",
  env: NodeJS.ProcessEnv = process.env,
): FhvT4CompletedCampaignSystemdIdentityV1 {
  if (readerOverride) {
    return readerOverride(unitName);
  }
  const injected = env.FHV_T4_CAMPAIGN_SYSTEMD_IDENTITY_JSON?.trim();
  if (injected) {
    const parsed = parseFhvT4CompletedCampaignSystemdIdentity(JSON.parse(injected));
    if (parsed.unitName !== unitName) {
      throw new FhvT4CompletedCampaignSystemdIdentityError(
        "FHV_T4_COMPLETED_CAMPAIGN_IDENTITY_UNIT_MISMATCH",
        `Injected campaign identity unit ${parsed.unitName} != ${unitName}`,
      );
    }
    return parsed;
  }
  const script = join(repoRoot, "scripts/ops/fhv-t4-campaign-systemd-identity-read.sh");
  const output = execFileSync("bash", [script, unitName], { encoding: "utf8" }).trim();
  return parseFhvT4CompletedCampaignSystemdIdentity(JSON.parse(output));
}

export function assertFhvT4CompletedCampaignProcessUnchanged(input: {
  before: FhvT4CompletedCampaignSystemdIdentityV1;
  after: FhvT4CompletedCampaignSystemdIdentityV1;
}): void {
  if (input.before.unitName !== input.after.unitName) {
    throw new FhvT4CompletedCampaignSystemdIdentityError(
      "FHV_T4_CAMPAIGN_CONTINUITY_UNIT_MISMATCH",
      "Campaign unitName mismatch.",
    );
  }
  if (input.before.bootId !== input.after.bootId) {
    throw new FhvT4CompletedCampaignSystemdIdentityError(
      "FHV_T4_CAMPAIGN_CONTINUITY_BOOT_ID_CHANGED",
      "Host reboot invalidates campaign continuity proof.",
    );
  }
  if (input.before.invocationId !== input.after.invocationId) {
    throw new FhvT4CompletedCampaignSystemdIdentityError(
      "FHV_T4_CAMPAIGN_CONTINUITY_INVOCATION_CHANGED",
      "Campaign InvocationID must remain unchanged.",
    );
  }
  if (input.before.execMainPid !== input.after.execMainPid) {
    throw new FhvT4CompletedCampaignSystemdIdentityError(
      "FHV_T4_CAMPAIGN_CONTINUITY_PID_CHANGED",
      "Campaign ExecMainPID must remain unchanged.",
    );
  }
  if (
    input.before.execMainStartTimestampMonotonic !== input.after.execMainStartTimestampMonotonic ||
    input.before.execMainExitTimestampMonotonic !== input.after.execMainExitTimestampMonotonic
  ) {
    throw new FhvT4CompletedCampaignSystemdIdentityError(
      "FHV_T4_CAMPAIGN_CONTINUITY_EXEC_TIMESTAMPS_CHANGED",
      "Campaign execution timestamps must remain unchanged.",
    );
  }
  if (input.after.activeState !== "inactive") {
    throw new FhvT4CompletedCampaignSystemdIdentityError(
      "FHV_T4_CAMPAIGN_CONTINUITY_REACTIVATED",
      "Campaign must not become active under a new invocation.",
    );
  }
  if (input.after.result !== "success") {
    throw new FhvT4CompletedCampaignSystemdIdentityError(
      "FHV_T4_CAMPAIGN_CONTINUITY_RESULT_CHANGED",
      "Campaign Result must remain success.",
    );
  }
  if (input.after.nRestarts !== input.before.nRestarts) {
    throw new FhvT4CompletedCampaignSystemdIdentityError(
      "FHV_T4_CAMPAIGN_CONTINUITY_NRESTARTS_CHANGED",
      "Campaign NRestarts must not increase after completion.",
    );
  }
}
