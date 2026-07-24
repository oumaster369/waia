import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import {
  isFhvCampaignControlRequestPending,
  resolveFhvControlRequestDisposition,
} from "@/lib/trader/observability/fhv-control-request-validator";
import type { FhvOperatorCommandV1 } from "@/lib/trader/observability/fhv-operator-command-v1";
import {
  FHV_REHEARSAL_CHECKPOINT_CYCLE,
  type FhvOperatorAction,
} from "@/lib/trader/observability/fhv-observability.constants";
import {
  readFhvRehearsalManifest,
  type FhvRehearsalLaunchConfigV1,
} from "@/lib/trader/observability/fhv-rehearsal-launcher";
import { resolveFhvCampaignState } from "@/lib/trader/observability/fhv-campaign-state";
import { isFhvCommandEnforcementActive } from "@/lib/trader/observability/fhv-env-config";

export const FHV_T4_PAUSE_ARMED_FILENAME = "fhv-t4-pause-armed.v1.json" as const;
export const FHV_T4_DETERMINISTIC_PAUSE_SCHEMA_VERSION = "fhv-t4-pause-armed/v1" as const;

export type FhvT4PauseArmedRecordV1 = Readonly<{
  schemaVersion: typeof FHV_T4_DETERMINISTIC_PAUSE_SCHEMA_VERSION;
  runId: string;
  organizationId: string;
  targetSha: string;
  fixtureId: "HTR_WP03_BENCHMARK";
  deterministicPauseAtCycle: typeof FHV_REHEARSAL_CHECKPOINT_CYCLE;
  commandId: string;
  idempotencyKey: string;
  operatorId: string;
  armedAtUtc: string;
  contentDigest: string;
}>;

export class FhvT4DeterministicPauseError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvT4DeterministicPauseError";
  }
}

export function isFhvT4DeterministicPauseManifest(manifest: FhvRehearsalLaunchConfigV1): boolean {
  return manifest.t4DeterministicPause === true;
}

export function resolveFhvT4PauseArmedPath(runRoot: string): string {
  return join(runRoot, "control", FHV_T4_PAUSE_ARMED_FILENAME);
}

function digestPauseArmedPayload(record: Omit<FhvT4PauseArmedRecordV1, "contentDigest">): string {
  return computePayloadDigest(record);
}

export function serializeFhvT4PauseArmedRecord(
  record: Omit<FhvT4PauseArmedRecordV1, "contentDigest">,
): FhvT4PauseArmedRecordV1 {
  return { ...record, contentDigest: digestPauseArmedPayload(record) };
}

export function readFhvT4PauseArmedRecord(runRoot: string): FhvT4PauseArmedRecordV1 | null {
  const path = resolveFhvT4PauseArmedPath(runRoot);
  if (!existsSync(path)) {
    return null;
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as FhvT4PauseArmedRecordV1;
  const { contentDigest, ...withoutDigest } = parsed;
  if (digestPauseArmedPayload(withoutDigest) !== contentDigest) {
    throw new FhvT4DeterministicPauseError(
      "FHV_T4_PAUSE_ARMED_DIGEST_MISMATCH",
      "T4 pause armed record digest mismatch.",
    );
  }
  return parsed;
}

export function writeFhvT4PauseArmedRecord(
  runRoot: string,
  record: Omit<FhvT4PauseArmedRecordV1, "contentDigest">,
): FhvT4PauseArmedRecordV1 {
  const payload = serializeFhvT4PauseArmedRecord(record);
  writeFileAtomic(resolveFhvT4PauseArmedPath(runRoot), `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

export function assertFhvT4PreArmPauseCommand(input: {
  command: FhvOperatorCommandV1;
  manifest: FhvRehearsalLaunchConfigV1;
  targetSha: string;
  commandEnforcementEnabled: boolean;
  runRoot: string;
}): void {
  if (!isFhvT4DeterministicPauseManifest(input.manifest)) {
    throw new FhvT4DeterministicPauseError(
      "FHV_T4_MANIFEST_NOT_DETERMINISTIC",
      "Manifest is not configured for T4 deterministic pause.",
    );
  }
  if (input.command.action !== "PAUSE_AT_CHECKPOINT") {
    throw new FhvT4DeterministicPauseError(
      "FHV_T4_PREARM_ACTION_INVALID",
      "Only PAUSE_AT_CHECKPOINT may be pre-armed.",
    );
  }
  if (input.command.campaignRunId !== input.manifest.runId) {
    throw new FhvT4DeterministicPauseError("FHV_T4_RUN_MISMATCH", "Command runId mismatch.");
  }
  if (input.command.organizationId !== input.manifest.organizationId) {
    throw new FhvT4DeterministicPauseError(
      "FHV_T4_ORG_MISMATCH",
      "Command organizationId mismatch.",
    );
  }
  if (input.targetSha !== input.manifest.targetSha) {
    throw new FhvT4DeterministicPauseError("FHV_T4_TARGET_SHA_MISMATCH", "Target SHA mismatch.");
  }
  if (input.manifest.fixtureId !== "HTR_WP03_BENCHMARK") {
    throw new FhvT4DeterministicPauseError(
      "FHV_T4_FIXTURE_INVALID",
      "Fixture must be HTR_WP03_BENCHMARK.",
    );
  }
  if (input.manifest.deterministicPauseAtCycle !== FHV_REHEARSAL_CHECKPOINT_CYCLE) {
    throw new FhvT4DeterministicPauseError(
      "FHV_T4_PAUSE_CYCLE_INVALID",
      `deterministicPauseAtCycle must be ${FHV_REHEARSAL_CHECKPOINT_CYCLE}.`,
    );
  }
  if (!input.commandEnforcementEnabled) {
    throw new FhvT4DeterministicPauseError(
      "FHV_T4_COMMAND_ENFORCEMENT_DISABLED",
      "Command enforcement must be enabled for T4 pre-arm.",
    );
  }
  const terminal = readFhvT4TerminalClassification(input.runRoot);
  if (terminal !== null) {
    throw new FhvT4DeterministicPauseError(
      "FHV_T4_TERMINAL_EXISTS",
      "Cannot pre-arm pause after terminal classification exists.",
    );
  }
  const snapshot = resolveFhvCampaignState({
    runRoot: input.runRoot,
    runId: input.manifest.runId,
    organizationId: input.manifest.organizationId,
  });
  if (
    snapshot.state !== "NOT_STARTED" &&
    snapshot.state !== "STARTING" &&
    snapshot.state !== "RUNNING" &&
    snapshot.state !== "PAUSE_REQUESTED"
  ) {
    throw new FhvT4DeterministicPauseError(
      "FHV_T4_PREARM_STATE_INVALID",
      `Pre-arm not allowed in state ${snapshot.state}.`,
    );
  }
}

export function assertFhvT4PauseArmedBeforeCampaignStart(input: {
  runRoot: string;
  manifest: FhvRehearsalLaunchConfigV1;
}): void {
  if (!isFhvT4DeterministicPauseManifest(input.manifest)) {
    return;
  }
  const armed = readFhvT4PauseArmedRecord(input.runRoot);
  if (!armed) {
    throw new FhvT4DeterministicPauseError(
      "FHV_T4_PAUSE_NOT_ARMED",
      "T4 deterministic pause must be armed before campaign start.",
    );
  }
  if (
    armed.runId !== input.manifest.runId ||
    armed.organizationId !== input.manifest.organizationId
  ) {
    throw new FhvT4DeterministicPauseError(
      "FHV_T4_ARMED_IDENTITY_MISMATCH",
      "Armed record identity mismatch.",
    );
  }
  if (armed.targetSha !== input.manifest.targetSha) {
    throw new FhvT4DeterministicPauseError(
      "FHV_T4_ARMED_SHA_MISMATCH",
      "Armed record targetSha mismatch.",
    );
  }
  if (
    !isFhvCampaignControlRequestPending({
      runRoot: input.runRoot,
      action: "PAUSE_AT_CHECKPOINT",
      runId: input.manifest.runId,
      organizationId: input.manifest.organizationId,
    })
  ) {
    throw new FhvT4DeterministicPauseError(
      "FHV_T4_PAUSE_REQUEST_MISSING",
      "Pending PAUSE_AT_CHECKPOINT control request required before campaign start.",
    );
  }
}

export function shouldFhvT4PauseAtCycle(input: {
  runRoot: string;
  manifest: FhvRehearsalLaunchConfigV1;
  cyclesProcessed: number;
  pauseRequested: boolean;
}): boolean {
  if (!input.pauseRequested) {
    return false;
  }
  if (!isFhvT4DeterministicPauseManifest(input.manifest)) {
    return true;
  }
  return (
    input.cyclesProcessed >=
    (input.manifest.deterministicPauseAtCycle ?? FHV_REHEARSAL_CHECKPOINT_CYCLE)
  );
}

export function assertFhvT4PreArmEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === "test") {
    throw new FhvT4DeterministicPauseError(
      "FHV_T4_TEST_BARRIER_FORBIDDEN",
      "T4 deterministic pause must not run with NODE_ENV=test.",
    );
  }
  if (
    !isFhvCommandEnforcementActive({
      hostOsQualified: env.FHV_HOST_OS_QUALIFIED?.trim() === "true",
      commandEnforcementEnabled: env.FHV_COMMAND_ENFORCEMENT_ENABLED?.trim() === "true",
    })
  ) {
    throw new FhvT4DeterministicPauseError(
      "FHV_T4_COMMAND_ENFORCEMENT_DISABLED",
      "FHV_HOST_OS_QUALIFIED and FHV_COMMAND_ENFORCEMENT_ENABLED must both be true.",
    );
  }
}

export function resolveFhvT4PreArmExpectedPhase(
  runRoot: string,
  runId: string,
  organizationId: string,
): string {
  return resolveFhvCampaignState({ runRoot, runId, organizationId }).phase;
}

export function isFhvT4PreArmPauseAction(
  action: FhvOperatorAction,
): action is "PAUSE_AT_CHECKPOINT" {
  return action === "PAUSE_AT_CHECKPOINT";
}

function readFhvT4TerminalClassification(runRoot: string): string | null {
  const path = join(runRoot, "fhv-rehearsal-terminal.v1.json");
  if (!existsSync(path)) {
    return null;
  }
  return (
    (JSON.parse(readFileSync(path, "utf8")) as { classification?: string }).classification ?? null
  );
}

export function validateFhvT4PauseArmedMatchesControlRequest(input: {
  runRoot: string;
  runId: string;
  organizationId: string;
}): void {
  const disposition = resolveFhvControlRequestDisposition({
    runRoot: input.runRoot,
    action: "PAUSE_AT_CHECKPOINT",
    runId: input.runId,
    organizationId: input.organizationId,
  });
  if (disposition !== "pending") {
    throw new FhvT4DeterministicPauseError(
      "FHV_T4_PAUSE_REQUEST_NOT_PENDING",
      `Expected pending pause request, got ${disposition}.`,
    );
  }
}
