/**
 * DEE-436 — released Human-executable T4A closure verifiers (file-based, read-only).
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { verifyFhvT4CeremonyQualificationProofs } from "@/lib/trader/observability/fhv-t4a-ceremony-qualification";
import { FhvT4CeremonyQualificationError } from "@/lib/trader/observability/fhv-t4a-ceremony-qualification-errors";
import {
  buildFhvT4aCeremonyPassFields,
  type FhvT4CeremonyPassFields,
} from "@/lib/trader/observability/fhv-t4a-ceremony-results";
import { writeFileAtomic } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";

import { HTR_WP03_BENCHMARK_EXPECTED_CYCLES } from "@/lib/trader/backtest/replay-benchmark-harness";
import {
  readReplayCheckpoint,
  readReplayRunChainManifest,
  segmentRole,
} from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import { validateFhvCanonicalRunChainCompletion } from "@/lib/trader/observability/fhv-canonical-run-chain";
import {
  readFhvCommandLedgerEntries,
  readFhvCommandResult,
} from "@/lib/trader/observability/fhv-command-ledger";
import { FHV_REHEARSAL_CHECKPOINT_CYCLE } from "@/lib/trader/observability/fhv-observability.constants";
import {
  assertFhvRehearsalEconomicFrontierQuiescent,
  validateFhvRehearsalEconomicFrontierBinding,
} from "@/lib/trader/observability/fhv-rehearsal-economic-frontier";
import {
  FHV_REHEARSAL_ALLOWED_FIXTURES,
  FHV_REHEARSAL_MAX_RUNTIME_MS,
  readFhvRehearsalManifest,
} from "@/lib/trader/observability/fhv-rehearsal-launcher";
import {
  readFhvRehearsalActualPauseCycle,
  readFhvRehearsalCampaignProgress,
  readFhvRehearsalTerminalClassification,
} from "@/lib/trader/observability/fhv-rehearsal-campaign-runner";
import {
  readFhvResumeRuntimeProof,
  validateFhvResumeRuntimeProof,
} from "@/lib/trader/observability/fhv-resume-runtime-proof";
import { readFhvOperatorStatusTolerant } from "@/lib/trader/observability/fhv-status-writer";
import {
  FHV_SYSTEMD_LEGACY_CONTAINER_IMAGE,
  FHV_SYSTEMD_LEGACY_CONTAINER_NAME,
  readFhvSystemdDeployedRevision,
  verifyFhvSystemdDeployedRevisionMatchesTarget,
  verifyFhvSystemdDeployedRevisionRecord,
} from "@/lib/trader/observability/fhv-systemd-deployed-revision";
import {
  FHV_SYSTEMD_CAMPAIGN_UNIT,
  FHV_SYSTEMD_OBSERVER_UNIT,
} from "@/lib/trader/observability/fhv-systemd-unit-config";
import {
  isFhvT4DeterministicPauseManifest,
  readFhvT4PauseArmedRecord,
} from "@/lib/trader/observability/fhv-t4-deterministic-pause";
import {
  FHV_T4_EVIDENCE_SEAL_VERIFICATION_PASS,
  verifyFhvT4EvidenceSeal,
} from "@/lib/trader/observability/fhv-t4-evidence-seal";
import {
  parseFhvT4ContinuitySnapshot,
  verifyFhvT4ContinuitySnapshots,
  verifyFhvT4ContinuityVerificationProofArtifact,
} from "@/lib/trader/observability/fhv-t4-continuity-capture";
import {
  verifyFhvT4DeploymentProofArtifact,
  type FhvT4DeploymentProofV1,
} from "@/lib/trader/observability/fhv-t4-deployment-proof";
import {
  assertFhvT4HostMonotonicBudget,
  FHV_T4_CAMPAIGN_RUNTIME_MAX_BUDGET_MS,
  readFhvT4HostMonotonicSample,
} from "@/lib/trader/observability/fhv-t4-host-monotonic-clock";
import { verifyFhvT4HostProbeProofArtifact } from "@/lib/trader/observability/fhv-t4-host-probe-proof";
import {
  verifyFhvT4FinalVerificationProofArtifact,
  verifyFhvT4PausedVerificationProofArtifact,
} from "@/lib/trader/observability/fhv-t4-paused-final-proofs";
import {
  readFhvT4ResumeEnforcementProof,
  verifyFhvT4ResumeEnforcementProofMatchesRun,
} from "@/lib/trader/observability/fhv-t4-resume-enforcement-proof";
import {
  verifyFhvT4RollbackProofArtifact,
  type FhvT4RollbackProofV1,
} from "@/lib/trader/observability/fhv-t4-rollback-proof";
import { verifyFhvT4CheckoutIdentityProofArtifact } from "@/lib/trader/observability/fhv-t4-release-checkout-identity";

export const FHV_T4_PAUSED_VERIFICATION_PASS = "FHV_T4_PAUSED_VERIFICATION_PASS" as const;
export const FHV_T4_FINAL_VERIFICATION_PASS = "FHV_T4_FINAL_VERIFICATION_PASS" as const;
export const FHV_T4_DEPLOYMENT_VERIFICATION_PASS = "FHV_T4_DEPLOYMENT_VERIFICATION_PASS" as const;
export const FHV_T4_ROLLBACK_VERIFICATION_PASS = "FHV_T4_ROLLBACK_VERIFICATION_PASS" as const;
export const FHV_T4_CEREMONY_VERIFICATION_PASS = "FHV_T4_CEREMONY_VERIFICATION_PASS" as const;
export const FHV_T4_CAMPAIGN_RUNTIME_SCHEMA_VERSION = "fhv-t4-campaign-runtime/v2" as const;
export const FHV_T4_CAMPAIGN_RUNTIME_FILENAME = "fhv-t4-campaign-runtime.v1.json" as const;
export const FHV_T4_CAMPAIGN_RUNTIME_START_SCHEMA_VERSION =
  "fhv-t4-campaign-runtime-start/v2" as const;
export const FHV_T4_CAMPAIGN_RUNTIME_START_FILENAME =
  "fhv-t4-campaign-runtime-start.v1.json" as const;

export class FhvT4ClosureVerifierError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvT4ClosureVerifierError";
  }
}

export type FhvT4IdentityInput = Readonly<{
  runRoot: string;
  runId: string;
  organizationId: string;
  targetSha: string;
  releaseTag?: string;
  repoRoot?: string;
}>;

export type FhvT4HostProbe = Readonly<{
  systemctlIsActive: (unit: string) => { state: string };
  systemctlIsEnabled: (unit: string) => { state: string };
  unitFileExists: (unit: string) => boolean;
  listMatchingProcesses: (pattern: string) => string[];
  inspectLegacyContainer: () => {
    name: string;
    image: string;
    running: boolean;
  } | null;
}>;

export type FhvT4CampaignRuntimeStartV1 = Readonly<{
  schemaVersion: typeof FHV_T4_CAMPAIGN_RUNTIME_START_SCHEMA_VERSION;
  runId: string;
  organizationId: string;
  targetSha: string;
  fixtureId: "HTR_WP03_BENCHMARK";
  hostBootId: string;
  startedMonotonicNs: string;
  startedAtUtc: string;
  contentDigest: string;
}>;

export type FhvT4CampaignRuntimeV1 = Readonly<{
  schemaVersion: typeof FHV_T4_CAMPAIGN_RUNTIME_SCHEMA_VERSION;
  runId: string;
  organizationId: string;
  targetSha: string;
  fixtureId: "HTR_WP03_BENCHMARK";
  hostBootId: string;
  startedMonotonicNs: string;
  completedMonotonicNs: string;
  elapsedMonotonicNs: string;
  maxBudgetMs: number;
  startedAtUtc: string;
  completedAtUtc: string;
  contentDigest: string;
}>;

export type { FhvT4CeremonyPassFields };

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function requireFile(path: string, code: string): void {
  if (!existsSync(path)) {
    throw new FhvT4ClosureVerifierError(code, `Required path missing: ${path}`);
  }
}

function parseUnitField(unitText: string, field: string): string | null {
  const prefix = `${field}=`;
  for (const line of unitText.split("\n")) {
    if (line.startsWith(prefix)) {
      return line.slice(prefix.length).trim();
    }
  }
  return null;
}

export function writeFhvT4CampaignRuntimeProof(
  runRoot: string,
  input: Omit<FhvT4CampaignRuntimeV1, "schemaVersion" | "contentDigest">,
): FhvT4CampaignRuntimeV1 {
  const withoutDigest = {
    schemaVersion: FHV_T4_CAMPAIGN_RUNTIME_SCHEMA_VERSION,
    ...input,
  };
  const record: FhvT4CampaignRuntimeV1 = {
    ...withoutDigest,
    contentDigest: computePayloadDigest(withoutDigest),
  };
  writeFileAtomic(
    join(runRoot, FHV_T4_CAMPAIGN_RUNTIME_FILENAME),
    `${JSON.stringify(record, null, 2)}\n`,
  );
  return record;
}

export function readFhvT4CampaignRuntimeProof(runRoot: string): FhvT4CampaignRuntimeV1 | null {
  const path = join(runRoot, FHV_T4_CAMPAIGN_RUNTIME_FILENAME);
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, "utf8")) as FhvT4CampaignRuntimeV1;
}

export function readFhvT4CampaignRuntimeStart(runRoot: string): FhvT4CampaignRuntimeStartV1 | null {
  const path = join(runRoot, FHV_T4_CAMPAIGN_RUNTIME_START_FILENAME);
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, "utf8")) as FhvT4CampaignRuntimeStartV1;
}

export function ensureFhvT4CampaignRuntimeStarted(
  runRoot: string,
  input: Omit<FhvT4CampaignRuntimeStartV1, "schemaVersion" | "contentDigest" | "startedAtUtc"> & {
    repoRoot: string;
    startedAtUtc?: string;
  },
): FhvT4CampaignRuntimeStartV1 {
  const existing = readFhvT4CampaignRuntimeStart(runRoot);
  if (existing) {
    const { contentDigest, ...withoutDigest } = existing;
    if (computePayloadDigest(withoutDigest) !== contentDigest) {
      throw new FhvT4ClosureVerifierError(
        "FHV_T4_CAMPAIGN_RUNTIME_START_DIGEST_MISMATCH",
        "Campaign runtime start digest mismatch.",
      );
    }
    if (
      existing.runId !== input.runId ||
      existing.organizationId !== input.organizationId ||
      existing.targetSha !== input.targetSha ||
      existing.fixtureId !== input.fixtureId ||
      existing.hostBootId !== input.hostBootId ||
      existing.startedMonotonicNs !== input.startedMonotonicNs
    ) {
      throw new FhvT4ClosureVerifierError(
        "FHV_T4_CAMPAIGN_RUNTIME_START_IDENTITY_MISMATCH",
        "Existing campaign runtime start identity mismatch.",
      );
    }
    return existing;
  }

  const withoutDigest = {
    schemaVersion: FHV_T4_CAMPAIGN_RUNTIME_START_SCHEMA_VERSION,
    runId: input.runId,
    organizationId: input.organizationId,
    targetSha: input.targetSha,
    fixtureId: input.fixtureId,
    hostBootId: input.hostBootId,
    startedMonotonicNs: input.startedMonotonicNs,
    startedAtUtc: input.startedAtUtc ?? new Date().toISOString(),
  };
  const record: FhvT4CampaignRuntimeStartV1 = {
    ...withoutDigest,
    contentDigest: computePayloadDigest(withoutDigest),
  };
  writeFileAtomic(
    join(runRoot, FHV_T4_CAMPAIGN_RUNTIME_START_FILENAME),
    `${JSON.stringify(record, null, 2)}\n`,
  );
  return record;
}

export function finalizeFhvT4CampaignRuntimeProof(
  runRoot: string,
  input: { repoRoot: string; completedAtUtc?: string },
): FhvT4CampaignRuntimeV1 {
  const start = readFhvT4CampaignRuntimeStart(runRoot);
  if (!start) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_CAMPAIGN_RUNTIME_START_MISSING",
      "Campaign runtime start marker is required before finalization.",
    );
  }
  const { contentDigest: startDigest, ...startWithoutDigest } = start;
  if (computePayloadDigest(startWithoutDigest) !== startDigest) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_CAMPAIGN_RUNTIME_START_DIGEST_MISMATCH",
      "Campaign runtime start digest mismatch.",
    );
  }
  const completedSample = readFhvT4HostMonotonicSample(input.repoRoot);
  if (completedSample.bootId !== start.hostBootId) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_CAMPAIGN_RUNTIME_BOOT_ID_CHANGED",
      "Host boot ID changed during campaign runtime.",
    );
  }
  const startedNs = BigInt(start.startedMonotonicNs);
  const completedNs = BigInt(completedSample.monotonicNs);
  if (completedNs < startedNs) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_CAMPAIGN_RUNTIME_INVALID",
      "completedMonotonicNs must be >= startedMonotonicNs.",
    );
  }
  const elapsedMonotonicNs = (completedNs - startedNs).toString();

  return writeFhvT4CampaignRuntimeProof(runRoot, {
    runId: start.runId,
    organizationId: start.organizationId,
    targetSha: start.targetSha,
    fixtureId: start.fixtureId,
    hostBootId: start.hostBootId,
    startedMonotonicNs: start.startedMonotonicNs,
    completedMonotonicNs: completedSample.monotonicNs,
    elapsedMonotonicNs,
    maxBudgetMs: FHV_T4_CAMPAIGN_RUNTIME_MAX_BUDGET_MS,
    startedAtUtc: start.startedAtUtc,
    completedAtUtc: input.completedAtUtc ?? new Date().toISOString(),
  });
}

export function resolveFhvT4SharedMonotonicDeadline(
  runRoot: string,
  repoRoot: string,
  maxRuntimeMs: number,
): { deadlineMonotonicNs: bigint; startedMonotonicNs: bigint; hostBootId: string } {
  const start = readFhvT4CampaignRuntimeStart(runRoot);
  if (!start) {
    const sample = readFhvT4HostMonotonicSample(repoRoot);
    const startedMonotonicNs = BigInt(sample.monotonicNs);
    return {
      hostBootId: sample.bootId,
      startedMonotonicNs,
      deadlineMonotonicNs: startedMonotonicNs + BigInt(maxRuntimeMs) * 1_000_000n,
    };
  }
  const startedMonotonicNs = BigInt(start.startedMonotonicNs);
  return {
    hostBootId: start.hostBootId,
    startedMonotonicNs,
    deadlineMonotonicNs: startedMonotonicNs + BigInt(maxRuntimeMs) * 1_000_000n,
  };
}

function assertCampaignRuntimeBudget(input: FhvT4IdentityInput, maxMs: number): number {
  const runtime = readFhvT4CampaignRuntimeProof(input.runRoot);
  if (!runtime) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_CAMPAIGN_RUNTIME_MISSING",
      "fhv-t4-campaign-runtime.v1.json is required for shared five-minute budget proof.",
    );
  }
  const { contentDigest, ...withoutDigest } = runtime;
  if (computePayloadDigest(withoutDigest) !== contentDigest) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_CAMPAIGN_RUNTIME_DIGEST_MISMATCH",
      "Campaign runtime proof digest mismatch.",
    );
  }
  if (
    runtime.runId !== input.runId ||
    runtime.organizationId !== input.organizationId ||
    runtime.targetSha !== input.targetSha
  ) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_CAMPAIGN_RUNTIME_IDENTITY_MISMATCH",
      "Campaign runtime proof identity mismatch.",
    );
  }
  if (runtime.fixtureId !== "HTR_WP03_BENCHMARK") {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_CAMPAIGN_RUNTIME_FIXTURE_MISMATCH",
      "Campaign runtime proof fixtureId must be HTR_WP03_BENCHMARK.",
    );
  }
  const start = readFhvT4CampaignRuntimeStart(input.runRoot);
  if (
    start &&
    (start.startedMonotonicNs !== runtime.startedMonotonicNs ||
      start.hostBootId !== runtime.hostBootId)
  ) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_CAMPAIGN_RUNTIME_BUDGET_RESET",
      "Campaign runtime start marker must match final proof (no resumed budget reset).",
    );
  }
  const { elapsedMs } = assertFhvT4HostMonotonicBudget({
    hostBootId: runtime.hostBootId,
    startedMonotonicNs: runtime.startedMonotonicNs,
    completedMonotonicNs: runtime.completedMonotonicNs,
    expectedBootId: runtime.hostBootId,
    maxBudgetMs: maxMs,
  });
  if (
    runtime.elapsedMonotonicNs !==
    (BigInt(runtime.completedMonotonicNs) - BigInt(runtime.startedMonotonicNs)).toString()
  ) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_CAMPAIGN_RUNTIME_ELAPSED_MISMATCH",
      "elapsedMonotonicNs must equal completed-started.",
    );
  }
  return elapsedMs;
}

function assertAlertPolicyDigest(runRoot: string, expectedDigest: string): void {
  const status = readFhvOperatorStatusTolerant(runRoot);
  if (!status?.alertPolicyDigest) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_ALERT_POLICY_STATUS_MISSING",
      "fhv-operator-status.v1.json alertPolicyDigest is required.",
    );
  }
  if (status.alertPolicyDigest !== expectedDigest) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_ALERT_POLICY_MISMATCH",
      "Runtime alertPolicyDigest does not match manifest.",
    );
  }
}

function findLedgerAction(
  runRoot: string,
  action: "PAUSE_AT_CHECKPOINT" | "RESUME_FROM_CHECKPOINT",
  commandId?: string,
) {
  const matches = readFhvCommandLedgerEntries(runRoot).filter(
    (entry) =>
      entry.command.action === action &&
      (commandId === undefined || entry.command.commandId === commandId),
  );
  if (matches.length === 0) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_LEDGER_ACTION_MISSING",
      `No ${action} command ledger entry found.`,
    );
  }
  return matches[matches.length - 1]!;
}

function assertExecutedCommandResult(
  runRoot: string,
  commandId: string,
  idempotencyKey: string,
): void {
  const result = readFhvCommandResult(runRoot, commandId);
  if (!result) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_COMMAND_RESULT_MISSING",
      `Command result missing for ${commandId}.`,
    );
  }
  if (result.status !== "executed") {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_COMMAND_RESULT_NOT_EXECUTED",
      `Command result status is ${result.status}, expected executed.`,
    );
  }
  if (result.enforcementApplied !== true) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_COMMAND_ENFORCEMENT_MISSING",
      "enforcementApplied must be true.",
    );
  }
  if (result.commandId !== commandId || result.idempotencyKey !== idempotencyKey) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_COMMAND_RESULT_IDENTITY_MISMATCH",
      "Command result identity mismatch.",
    );
  }
}

function assertAcceptedResumeCommandResult(
  runRoot: string,
  commandId: string,
  idempotencyKey: string,
): void {
  const result = readFhvCommandResult(runRoot, commandId);
  if (!result) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_COMMAND_RESULT_MISSING",
      `Command result missing for ${commandId}.`,
    );
  }
  if (result.status !== "accepted") {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_RESUME_RESULT_NOT_ACCEPTED",
      `RESUME result status is ${result.status}, expected accepted.`,
    );
  }
  if (result.enforcementApplied !== false) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_RESUME_ENFORCEMENT_APPLIED_INVALID",
      "RESUME acceptance must defer enforcement to root handoff.",
    );
  }
  if (result.commandId !== commandId || result.idempotencyKey !== idempotencyKey) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_COMMAND_RESULT_IDENTITY_MISMATCH",
      "Command result identity mismatch.",
    );
  }
}

export function verifyFhvT4PausedState(input: FhvT4IdentityInput): {
  classification: typeof FHV_T4_PAUSED_VERIFICATION_PASS;
  checks: string[];
} {
  const checks: string[] = [];
  const manifest = readFhvRehearsalManifest(input.runRoot);
  if (!isFhvT4DeterministicPauseManifest(manifest)) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_MANIFEST_NOT_DETERMINISTIC",
      "Manifest is not configured for T4 deterministic pause.",
    );
  }
  if (manifest.fixtureId !== "HTR_WP03_BENCHMARK") {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_FIXTURE_MISMATCH",
      "fixtureId must be HTR_WP03_BENCHMARK.",
    );
  }
  if (manifest.targetSha !== input.targetSha) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_TARGET_SHA_MISMATCH",
      "Manifest targetSha mismatch.",
    );
  }
  if (manifest.runId !== input.runId || manifest.organizationId !== input.organizationId) {
    throw new FhvT4ClosureVerifierError("FHV_T4_IDENTITY_MISMATCH", "Manifest run/org mismatch.");
  }
  if (manifest.deterministicPauseAtCycle !== FHV_REHEARSAL_CHECKPOINT_CYCLE) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_PAUSE_CYCLE_MISMATCH",
      `deterministicPauseAtCycle must be ${FHV_REHEARSAL_CHECKPOINT_CYCLE}.`,
    );
  }
  checks.push("manifest");

  const terminal = readFhvRehearsalTerminalClassification(input.runRoot);
  if (terminal !== "REHEARSAL_PAUSED") {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_TERMINAL_NOT_PAUSED",
      `Expected REHEARSAL_PAUSED, got ${terminal ?? "null"}.`,
    );
  }
  const actualPauseCycle = readFhvRehearsalActualPauseCycle(input.runRoot);
  if (actualPauseCycle !== FHV_REHEARSAL_CHECKPOINT_CYCLE) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_ACTUAL_PAUSE_CYCLE_MISMATCH",
      `actualPauseCycle must be ${FHV_REHEARSAL_CHECKPOINT_CYCLE}.`,
    );
  }
  checks.push("terminal");

  const progress = readFhvRehearsalCampaignProgress(input.runRoot);
  if (!progress || progress.phase !== "paused_at_checkpoint") {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_PROGRESS_PHASE_MISMATCH",
      "progress phase must be paused_at_checkpoint.",
    );
  }
  if (progress.cyclesProcessed !== FHV_REHEARSAL_CHECKPOINT_CYCLE) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_CYCLES_PROCESSED_MISMATCH",
      `cyclesProcessed must be ${FHV_REHEARSAL_CHECKPOINT_CYCLE}.`,
    );
  }
  checks.push("progress");

  const armed = readFhvT4PauseArmedRecord(input.runRoot);
  if (!armed) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_PAUSE_ARMED_MISSING",
      "Pause-armed record missing.",
    );
  }
  if (
    armed.runId !== input.runId ||
    armed.organizationId !== input.organizationId ||
    armed.targetSha !== input.targetSha ||
    armed.fixtureId !== "HTR_WP03_BENCHMARK" ||
    armed.deterministicPauseAtCycle !== FHV_REHEARSAL_CHECKPOINT_CYCLE ||
    !armed.commandId ||
    !armed.idempotencyKey ||
    !armed.operatorId
  ) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_PAUSE_ARMED_SCHEMA_INVALID",
      "Pause-armed record identity/schema invalid.",
    );
  }
  checks.push("pause-armed");

  const pauseEntry = findLedgerAction(input.runRoot, "PAUSE_AT_CHECKPOINT", armed.commandId);
  if (
    pauseEntry.command.campaignRunId !== input.runId ||
    pauseEntry.command.organizationId !== input.organizationId ||
    pauseEntry.command.operatorId !== armed.operatorId ||
    pauseEntry.command.confirmationPhraseClass !== "PAUSE" ||
    pauseEntry.command.idempotencyKey !== armed.idempotencyKey
  ) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_PAUSE_LEDGER_MISMATCH",
      "PAUSE ledger entry does not match armed record.",
    );
  }
  assertExecutedCommandResult(
    input.runRoot,
    pauseEntry.command.commandId,
    pauseEntry.command.idempotencyKey,
  );
  checks.push("pause-command");

  const checkpoint = readReplayCheckpoint(input.runRoot);
  if (!checkpoint) {
    throw new FhvT4ClosureVerifierError("FHV_T4_CHECKPOINT_MISSING", "Replay checkpoint missing.");
  }
  if (
    checkpoint.backtestRunId !== input.runId ||
    checkpoint.codeSha !== input.targetSha ||
    checkpoint.safeResumeThroughCycleIndex !== FHV_REHEARSAL_CHECKPOINT_CYCLE - 1 ||
    checkpoint.evidenceDurableThroughCycleIndex !== FHV_REHEARSAL_CHECKPOINT_CYCLE - 1 ||
    checkpoint.replayTerminalState !== "REPLAY_RUN_SEALED_PARTIAL_RESUMABLE"
  ) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_CHECKPOINT_IDENTITY_MISMATCH",
      "Checkpoint identity/frontier mismatch.",
    );
  }
  if (!checkpoint.campaignIdentityFrontierState) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_IDENTITY_FRONTIER_MISSING",
      "Campaign identity frontier missing.",
    );
  }
  if (
    checkpoint.campaignIdentityFrontierState.runId !== input.runId ||
    checkpoint.campaignIdentityFrontierState.organizationId !== input.organizationId
  ) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_IDENTITY_FRONTIER_MISMATCH",
      "Campaign identity frontier not identity-bound.",
    );
  }
  const expectedFixtureDigest = FHV_REHEARSAL_ALLOWED_FIXTURES.HTR_WP03_BENCHMARK.fixtureSha256;
  if (checkpoint.fixtureSha256 !== expectedFixtureDigest) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_FIXTURE_DIGEST_MISMATCH",
      "Checkpoint fixture digest mismatch.",
    );
  }
  if (!checkpoint.rehearsalEconomicFrontierState) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_ECONOMIC_FRONTIER_MISSING",
      "Rehearsal economic frontier missing.",
    );
  }
  if (checkpoint.rehearsalEconomicFrontierState.mode !== "QUIESCENT_NO_ECONOMIC_STATE") {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_ECONOMIC_MODE_MISMATCH",
      "Economic frontier mode must be QUIESCENT_NO_ECONOMIC_STATE.",
    );
  }
  validateFhvRehearsalEconomicFrontierBinding({
    frontier: checkpoint.rehearsalEconomicFrontierState,
    runId: input.runId,
    organizationId: input.organizationId,
    safeResumeThroughCycleIndex: FHV_REHEARSAL_CHECKPOINT_CYCLE - 1,
  });
  assertFhvRehearsalEconomicFrontierQuiescent(checkpoint.rehearsalEconomicFrontierState);
  checks.push("checkpoint-economic");

  const chain = readReplayRunChainManifest(input.runRoot);
  if (!chain) {
    throw new FhvT4ClosureVerifierError("FHV_T4_RUN_CHAIN_MISSING", "Run-chain manifest missing.");
  }
  const authoritative = chain.segments.filter(
    (segment) => segmentRole(segment) === "authoritative",
  );
  const partial = authoritative[0];
  if (!partial || partial.terminalState !== "STREAMING_EVIDENCE_SEALED_PARTIAL") {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_PARTIAL_EVIDENCE_TERMINAL_MISMATCH",
      "Partial evidence terminal must be STREAMING_EVIDENCE_SEALED_PARTIAL.",
    );
  }
  checks.push("partial-evidence");

  assertAlertPolicyDigest(input.runRoot, manifest.alertPolicyDigest);
  checks.push("alert-policy");

  return { classification: FHV_T4_PAUSED_VERIFICATION_PASS, checks };
}

export function verifyFhvT4FinalState(
  input: FhvT4IdentityInput & { maxCampaignRuntimeMs?: number },
): {
  classification: typeof FHV_T4_FINAL_VERIFICATION_PASS;
  checks: string[];
  fullHistoryRescanDelta: number;
} {
  const checks: string[] = [];
  const maxMs = input.maxCampaignRuntimeMs ?? FHV_REHEARSAL_MAX_RUNTIME_MS;

  // Historical pause artifacts must remain valid; do not require unconsumed pre-arm.
  const armed = readFhvT4PauseArmedRecord(input.runRoot);
  if (!armed) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_PAUSE_ARMED_MISSING",
      "Historical pause-armed record required for final verification.",
    );
  }
  findLedgerAction(input.runRoot, "PAUSE_AT_CHECKPOINT", armed.commandId);
  checks.push("historical-pause");

  const terminal = readFhvRehearsalTerminalClassification(input.runRoot);
  if (terminal !== "REHEARSAL_OK") {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_TERMINAL_NOT_OK",
      `Expected REHEARSAL_OK, got ${terminal ?? "null"}.`,
    );
  }
  checks.push("terminal");

  const resumeEntry = findLedgerAction(input.runRoot, "RESUME_FROM_CHECKPOINT");
  if (
    resumeEntry.command.campaignRunId !== input.runId ||
    resumeEntry.command.organizationId !== input.organizationId ||
    resumeEntry.command.confirmationPhraseClass !== "RESUME"
  ) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_RESUME_LEDGER_MISMATCH",
      "RESUME ledger entry identity mismatch.",
    );
  }
  const expectedCheckpointSeq = FHV_REHEARSAL_CHECKPOINT_CYCLE;
  if (resumeEntry.command.expectedCampaignState.checkpointSeq !== expectedCheckpointSeq) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_RESUME_CHECKPOINT_SEQ_MISMATCH",
      `expected checkpointSeq must be ${expectedCheckpointSeq}.`,
    );
  }
  assertAcceptedResumeCommandResult(
    input.runRoot,
    resumeEntry.command.commandId,
    resumeEntry.command.idempotencyKey,
  );
  checks.push("resume-command");

  verifyFhvT4ResumeEnforcementProofMatchesRun({
    runRoot: input.runRoot,
    runId: input.runId,
    organizationId: input.organizationId,
    targetSha: input.targetSha,
  });
  checks.push("resume-enforcement-proof");

  const checkpoint = readReplayCheckpoint(input.runRoot);
  if (!checkpoint) {
    throw new FhvT4ClosureVerifierError("FHV_T4_CHECKPOINT_MISSING", "Replay checkpoint missing.");
  }
  const resumeCycleStartIndex = checkpoint.safeResumeThroughCycleIndex + 1;
  const proof = readFhvResumeRuntimeProof(input.runRoot);
  if (!proof) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_RESUME_PROOF_MISSING",
      "Resume runtime proof missing.",
    );
  }
  validateFhvResumeRuntimeProof({
    proof,
    runId: input.runId,
    organizationId: input.organizationId,
    expectedProcessPid: proof.processPid,
    resumeCycleStartIndex,
  });
  if (proof.firstExecutedCycleIndex !== resumeCycleStartIndex) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_RESUME_FIRST_CYCLE_MISMATCH",
      "firstExecutedCycleIndex must equal resumeCycleStartIndex.",
    );
  }
  if (proof.fullHistoryRescanDelta !== 0) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_RESCAN_DELTA_NONZERO",
      "fullHistoryRescanDelta must be 0.",
    );
  }
  checks.push("resume-proof");

  const chainValidation = validateFhvCanonicalRunChainCompletion(input.runRoot);
  if (!chainValidation.ok) {
    throw new FhvT4ClosureVerifierError(chainValidation.code, chainValidation.reason);
  }
  if (
    chainValidation.read.authoritativeGapCount !== 0 ||
    chainValidation.read.authoritativeDuplicateCount !== 0 ||
    chainValidation.read.authoritativeCycleCount !== HTR_WP03_BENCHMARK_EXPECTED_CYCLES
  ) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_RUN_CHAIN_COUNTS_INVALID",
      "Canonical run-chain authoritative counts invalid.",
    );
  }
  const chain = readReplayRunChainManifest(input.runRoot);
  if (!chain) {
    throw new FhvT4ClosureVerifierError("FHV_T4_RUN_CHAIN_MISSING", "Run-chain manifest missing.");
  }
  const authoritative = chain.segments.filter(
    (segment) => segmentRole(segment) === "authoritative",
  );
  if (authoritative.length < 2) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_RUN_CHAIN_SEGMENTS_INCOMPLETE",
      "Expected authoritative partial and continuation segments.",
    );
  }
  const partial = authoritative[0]!;
  const continuation = authoritative[authoritative.length - 1]!;
  if (partial.terminalState !== "STREAMING_EVIDENCE_SEALED_PARTIAL") {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_PARTIAL_TERMINAL_MISMATCH",
      "Partial segment terminal mismatch.",
    );
  }
  if (continuation.terminalState !== "STREAMING_EVIDENCE_OK") {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_CONTINUATION_TERMINAL_MISMATCH",
      "Continuation segment terminal mismatch.",
    );
  }
  if (
    continuation.continuesFromRunDir !== partial.runDir ||
    continuation.continuesFromChainDigest !== partial.chainDigest
  ) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_CONTINUATION_LINK_BROKEN",
      "Continuation does not link to exact partial path/digest.",
    );
  }
  checks.push("canonical-run-chain");

  const manifest = readFhvRehearsalManifest(input.runRoot);
  if (manifest.targetSha !== input.targetSha || manifest.runId !== input.runId) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_MANIFEST_IDENTITY_MISMATCH",
      "Final manifest identity mismatch.",
    );
  }
  assertAlertPolicyDigest(input.runRoot, manifest.alertPolicyDigest);
  checks.push("alert-policy");

  assertCampaignRuntimeBudget(input, maxMs);
  checks.push("shared-budget");

  return {
    classification: FHV_T4_FINAL_VERIFICATION_PASS,
    checks,
    fullHistoryRescanDelta: 0,
  };
}

export function verifyFhvT4DeploymentTruth(input: {
  repoRoot: string;
  targetSha: string;
  releaseTag: string;
  runId: string;
  organizationId: string;
  operatorId: string;
  serviceUser: string;
  workingDirectory: string;
  environmentFile: string;
  renderedUnitsDir: string;
  installedUnitsDir: string;
}): {
  classification: typeof FHV_T4_DEPLOYMENT_VERIFICATION_PASS;
  installedDigests: Record<string, string>;
} {
  const units = [FHV_SYSTEMD_CAMPAIGN_UNIT, FHV_SYSTEMD_OBSERVER_UNIT] as const;
  const installedDigests: Record<string, string> = {};
  for (const unit of units) {
    const renderedPath = join(input.renderedUnitsDir, unit);
    const installedPath = join(input.installedUnitsDir, unit);
    requireFile(renderedPath, "FHV_T4_RENDERED_UNIT_MISSING");
    requireFile(installedPath, "FHV_T4_INSTALLED_UNIT_MISSING");
    const renderedDigest = sha256File(renderedPath);
    const installedDigest = sha256File(installedPath);
    if (renderedDigest !== installedDigest) {
      throw new FhvT4ClosureVerifierError(
        "FHV_T4_UNIT_DIGEST_MISMATCH",
        `Installed/rendered digest mismatch for ${unit}.`,
      );
    }
    installedDigests[unit] = installedDigest;
    const text = readFileSync(installedPath, "utf8");
    if (parseUnitField(text, "User") !== input.serviceUser) {
      throw new FhvT4ClosureVerifierError("FHV_T4_UNIT_USER_MISMATCH", `User mismatch in ${unit}.`);
    }
    if (parseUnitField(text, "WorkingDirectory") !== input.workingDirectory) {
      throw new FhvT4ClosureVerifierError(
        "FHV_T4_UNIT_WORKING_DIRECTORY_MISMATCH",
        `WorkingDirectory mismatch in ${unit}.`,
      );
    }
    if (parseUnitField(text, "EnvironmentFile") !== input.environmentFile) {
      throw new FhvT4ClosureVerifierError(
        "FHV_T4_UNIT_ENVIRONMENT_FILE_MISMATCH",
        `EnvironmentFile mismatch in ${unit}.`,
      );
    }
    if (!text.includes(`FHV_TARGET_SHA=${input.targetSha}`)) {
      throw new FhvT4ClosureVerifierError(
        "FHV_T4_UNIT_TARGET_SHA_GUARD_MISSING",
        `Target SHA guard missing in ${unit}.`,
      );
    }
    if (!text.includes(`FHV_RUN_ID=${input.runId}`)) {
      throw new FhvT4ClosureVerifierError(
        "FHV_T4_UNIT_RUN_BINDING_MISSING",
        `Run binding missing in ${unit}.`,
      );
    }
    if (!text.includes(`FHV_ORGANIZATION_ID=${input.organizationId}`)) {
      throw new FhvT4ClosureVerifierError(
        "FHV_T4_UNIT_ORG_BINDING_MISSING",
        `Organization binding missing in ${unit}.`,
      );
    }
  }

  const record = verifyFhvSystemdDeployedRevisionMatchesTarget({
    repoRoot: input.repoRoot,
    targetSha: input.targetSha,
    releaseTag: input.releaseTag,
    runId: input.runId,
    organizationId: input.organizationId,
    serviceUser: input.serviceUser,
    renderedUnitDigests: {
      [FHV_SYSTEMD_CAMPAIGN_UNIT]: installedDigests[FHV_SYSTEMD_CAMPAIGN_UNIT]!,
      [FHV_SYSTEMD_OBSERVER_UNIT]: installedDigests[FHV_SYSTEMD_OBSERVER_UNIT]!,
    },
  });
  verifyFhvSystemdDeployedRevisionRecord(record);
  if (record.operatorId !== input.operatorId) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_DEPLOYMENT_OPERATOR_MISMATCH",
      "Deployment record operatorId mismatch.",
    );
  }
  if (
    record.legacyContainerName !== FHV_SYSTEMD_LEGACY_CONTAINER_NAME ||
    record.legacyContainerImage !== FHV_SYSTEMD_LEGACY_CONTAINER_IMAGE ||
    record.legacyContainerRunning !== true
  ) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_LEGACY_CONTAINER_RECORD_MISMATCH",
      "Deployment record legacy container fields invalid.",
    );
  }

  return {
    classification: FHV_T4_DEPLOYMENT_VERIFICATION_PASS,
    installedDigests,
  };
}

function assertAllowlistedState(label: string, state: string, allowlist: readonly string[]): void {
  if (!allowlist.includes(state)) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_HOST_STATE_UNKNOWN",
      `${label} state '${state}' is not in allowlist [${allowlist.join(", ")}].`,
    );
  }
}

export function verifyFhvT4RollbackState(input: {
  runRoot: string;
  repoRoot: string;
  targetSha: string;
  requiredEvidencePaths: readonly string[];
  host: FhvT4HostProbe;
}): {
  classification: typeof FHV_T4_ROLLBACK_VERIFICATION_PASS;
  deploymentRecordDisposition: "PRESERVED";
} {
  for (const unit of [FHV_SYSTEMD_CAMPAIGN_UNIT, FHV_SYSTEMD_OBSERVER_UNIT]) {
    assertAllowlistedState(`${unit} active`, input.host.systemctlIsActive(unit).state, [
      "inactive",
      "not-found",
    ]);
    assertAllowlistedState(`${unit} enabled`, input.host.systemctlIsEnabled(unit).state, [
      "disabled",
      "not-found",
    ]);
    if (input.host.unitFileExists(unit)) {
      throw new FhvT4ClosureVerifierError(
        "FHV_T4_ROLLBACK_UNIT_FILE_PRESENT",
        `Unit file still present for ${unit}.`,
      );
    }
  }

  const residual = [
    ...input.host.listMatchingProcesses("fhv-campaign-cli"),
    ...input.host.listMatchingProcesses("fhv-observer-cli"),
    ...input.host.listMatchingProcesses("waia-fhv-campaign"),
    ...input.host.listMatchingProcesses("waia-fhv-observer"),
  ];
  if (residual.length > 0) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_ROLLBACK_RESIDUAL_PROCESS",
      `Residual process remains: ${residual.join(", ")}`,
    );
  }

  const legacy = input.host.inspectLegacyContainer();
  if (
    !legacy ||
    legacy.name !== FHV_SYSTEMD_LEGACY_CONTAINER_NAME ||
    legacy.image !== FHV_SYSTEMD_LEGACY_CONTAINER_IMAGE ||
    legacy.running !== true
  ) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_ROLLBACK_LEGACY_CONTAINER_MISMATCH",
      "Legacy container must remain exact and running after rollback.",
    );
  }

  for (const path of input.requiredEvidencePaths) {
    requireFile(path, "FHV_T4_ROLLBACK_EVIDENCE_MISSING");
  }

  const record = readFhvSystemdDeployedRevision(input.repoRoot);
  if (!record) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_ROLLBACK_DEPLOYMENT_RECORD_MISSING",
      "Deployment record must remain preserved after rollback.",
    );
  }
  if (record.releaseSha !== input.targetSha) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_ROLLBACK_DEPLOYMENT_RECORD_SHA_MISMATCH",
      "Preserved deployment record releaseSha mismatch.",
    );
  }

  return {
    classification: FHV_T4_ROLLBACK_VERIFICATION_PASS,
    deploymentRecordDisposition: "PRESERVED",
  };
}

export function verifyFhvT4ContinuityDigests(input: {
  beforePath: string;
  afterPath: string;
  requiredKeys: readonly string[];
}): void {
  requireFile(input.beforePath, "FHV_T4_CONTINUITY_BEFORE_MISSING");
  requireFile(input.afterPath, "FHV_T4_CONTINUITY_AFTER_MISSING");
  const before = JSON.parse(readFileSync(input.beforePath, "utf8")) as Record<string, string>;
  const after = JSON.parse(readFileSync(input.afterPath, "utf8")) as Record<string, string>;
  for (const key of input.requiredKeys) {
    if (!before[key] || !after[key]) {
      throw new FhvT4ClosureVerifierError(
        "FHV_T4_CONTINUITY_KEY_MISSING",
        `Continuity digest key missing: ${key}`,
      );
    }
    if (before[key] !== after[key]) {
      throw new FhvT4ClosureVerifierError(
        "FHV_T4_CONTINUITY_DIGEST_CHANGED",
        `Continuity digest changed for ${key}.`,
      );
    }
  }
}

export function verifyFhvT4Ceremony(input: {
  identity: FhvT4IdentityInput;
  sealDestination: string;
  continuityBeforePath: string;
  continuityAfterPath: string;
  serviceUser: string;
  workingDirectory: string;
  environmentFile: string;
}): {
  classification: typeof FHV_T4_CEREMONY_VERIFICATION_PASS;
  passFields: FhvT4CeremonyPassFields;
  deploymentProof: FhvT4DeploymentProofV1;
  rollbackProof: FhvT4RollbackProofV1;
} {
  const releaseTag = input.identity.releaseTag ?? "";
  verifyFhvT4CheckoutIdentityProofArtifact({
    runRoot: input.identity.runRoot,
    targetSha: input.identity.targetSha,
    releaseTag,
    runId: input.identity.runId,
    organizationId: input.identity.organizationId,
  });
  const pausedProof = verifyFhvT4PausedVerificationProofArtifact({
    runRoot: input.identity.runRoot,
    targetSha: input.identity.targetSha,
    releaseTag,
    runId: input.identity.runId,
    organizationId: input.identity.organizationId,
  });
  const finalProof = verifyFhvT4FinalVerificationProofArtifact({
    runRoot: input.identity.runRoot,
    targetSha: input.identity.targetSha,
    releaseTag,
    runId: input.identity.runId,
    organizationId: input.identity.organizationId,
  });
  verifyFhvT4FinalState(input.identity);
  const resumeProof = readFhvResumeRuntimeProof(input.identity.runRoot);
  if (!resumeProof || resumeProof.fullHistoryRescanDelta !== 0) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_CEREMONY_RESCAN_INVALID",
      "Ceremony requires fullHistoryRescanDelta=0.",
    );
  }
  const hostProbe = verifyFhvT4HostProbeProofArtifact({
    runRoot: input.identity.runRoot,
    targetSha: input.identity.targetSha,
    runId: input.identity.runId,
    organizationId: input.identity.organizationId,
    requireLegacyRunning: true,
  });
  const deploymentProof = verifyFhvT4DeploymentProofArtifact({
    runRoot: input.identity.runRoot,
    targetSha: input.identity.targetSha,
    releaseTag,
    runId: input.identity.runId,
    organizationId: input.identity.organizationId,
    serviceUser: input.serviceUser,
    workingDirectory: input.workingDirectory,
    environmentFile: input.environmentFile,
  });
  if (
    deploymentProof.hostProbeProofDigest !== hostProbe.contentDigest ||
    deploymentProof.legacyContainerRunning !== true ||
    hostProbe.legacy.running !== true
  ) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_CEREMONY_LEGACY_CONTAINER_INVALID",
      "Ceremony legacy-container/host-probe proof mismatch.",
    );
  }
  const rollbackProof = verifyFhvT4RollbackProofArtifact({
    runRoot: input.identity.runRoot,
    targetSha: input.identity.targetSha,
    runId: input.identity.runId,
    organizationId: input.identity.organizationId,
    deploymentProof,
  });
  const seal = verifyFhvT4EvidenceSeal({
    sealDestination: input.sealDestination,
    releaseSha: input.identity.targetSha,
    runId: input.identity.runId,
    organizationId: input.identity.organizationId,
    releaseTag: input.identity.releaseTag,
    serviceUser: input.serviceUser,
  });
  if (seal.classification !== FHV_T4_EVIDENCE_SEAL_VERIFICATION_PASS) {
    throw new FhvT4ClosureVerifierError(
      "FHV_T4_CEREMONY_SEAL_FAILED",
      "Evidence seal verification failed.",
    );
  }
  const before = parseFhvT4ContinuitySnapshot(
    JSON.parse(readFileSync(input.continuityBeforePath, "utf8")) as unknown,
  );
  const after = parseFhvT4ContinuitySnapshot(
    JSON.parse(readFileSync(input.continuityAfterPath, "utf8")) as unknown,
  );
  verifyFhvT4ContinuitySnapshots({ before, after });
  verifyFhvT4ContinuityVerificationProofArtifact({
    runRoot: input.identity.runRoot,
    targetSha: input.identity.targetSha,
    runId: input.identity.runId,
    organizationId: input.identity.organizationId,
    beforeDigest: before.contentDigest,
    afterDigest: after.contentDigest,
  });
  const manifest = readFhvRehearsalManifest(input.identity.runRoot);
  assertAlertPolicyDigest(input.identity.runRoot, manifest.alertPolicyDigest);

  try {
    verifyFhvT4CeremonyQualificationProofs({
      runRoot: input.identity.runRoot,
      targetSha: input.identity.targetSha,
      runId: input.identity.runId,
      organizationId: input.identity.organizationId,
      continuityBeforePath: input.continuityBeforePath,
      continuityAfterPath: input.continuityAfterPath,
    });
  } catch (error) {
    if (error instanceof FhvT4CeremonyQualificationError) {
      throw new FhvT4ClosureVerifierError(error.code, error.message);
    }
    throw error;
  }
  const passFields: FhvT4CeremonyPassFields = buildFhvT4aCeremonyPassFields({
    PAUSE_RESULT:
      pausedProof.actualPauseCycle === 40
        ? "REHEARSAL_PAUSED_AT_CYCLE_40"
        : (() => {
            throw new FhvT4ClosureVerifierError(
              "FHV_T4_CEREMONY_PAUSE_RESULT_INVALID",
              "Paused proof cycle is not 40.",
            );
          })(),
    RESUME_RESULT: finalProof.finalTerminal,
    CANONICAL_RUN_CHAIN_RESULT: finalProof.canonicalRunChainResult,
  });

  return {
    classification: FHV_T4_CEREMONY_VERIFICATION_PASS,
    passFields,
    deploymentProof,
    rollbackProof,
  };
}
