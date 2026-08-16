import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { computeAccountingSemanticDigest } from "@/lib/trader/accounting";
import { loadApprovedBenchmarkFixture } from "@/lib/trader/backtest/replay-benchmark-harness";
import type { RunBacktestResult } from "@/lib/trader/backtest/backtest-runner";
import { getFullHistoryRescanCount } from "@/lib/trader/backtest/replay-runtime-metrics";
import {
  writeFileAtomicCompareAndReplace,
  writeFileAtomicExclusive,
} from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type { Bar } from "@/lib/trader/intelligence/types";
import { FHV_DATASET_PARTITIONS_V1 } from "@/lib/trader/market-data/dataset/fhv-dataset-manifest";
import { assertFhvReplayNotLiveExchangePath } from "@/lib/trader/observability/fhv-campaign-semantic-abort";
import { shouldSkipFhvCheckoutIdentityVerification } from "@/lib/trader/observability/fhv-checkout-identity-test-hook";
import {
  readFhvConfigurationFreezeArtifact,
  type FhvConfigurationFreezeArtifactV1,
} from "@/lib/trader/observability/fhv-configuration-freeze-artifact";
import type { FhvConfigurationFreezeV1 } from "@/lib/trader/observability/fhv-configuration-freeze";
import { readFhvControlReplayReceipt } from "@/lib/trader/observability/fhv-control-replay-receipt";
import {
  loadOfficialSharedPortfolioBars,
  readFhvDatasetQualificationReceipt,
  type FhvDatasetQualificationReceiptV1,
} from "@/lib/trader/observability/fhv-dataset-qualification";
import { resolveFhvDatasetSealReceiptV2Path } from "@/lib/trader/market-data/fhv-dataset-manifest-v2";
import { assertFhvOfficialV2DatasetArtifactsPresent } from "@/lib/trader/market-data/fhv-official-v2-required";
import { revalidateFhvDatasetAtLaunch } from "@/lib/trader/observability/fhv-dataset-launch-guard";
import {
  assertFhvAuthorizationReceiptForExecution,
  assertFhvConfigurationFreezeForExecution,
  assertFhvControlReplayReceiptForFullLaunch,
  assertFhvDatasetQualificationReceiptForExecution,
  type FhvExecutionIdentity,
} from "@/lib/trader/observability/fhv-artifact-authority-chain";
import {
  prepareFhvOfficialLaunchExecution,
  recoverFhvExecutionWalForResume,
} from "@/lib/trader/observability/fhv-execution-checkpoint";
import {
  assertFhvFullHistoricalAuthorizationReceiptForLaunch,
  consumeFhvFullHistoricalAuthorizationReceipt,
  readFhvFullHistoricalAuthorizationReceipt,
  type FhvFullHistoricalAuthorizationReceiptV1,
} from "@/lib/trader/observability/fhv-full-historical-auth";
import {
  assertControlReplayAuthorizationPurpose,
  assertFullHistoricalAuthorizationPurpose,
  FHV_EXECUTION_PURPOSE_CONTROL_REPLAY,
  FHV_EXECUTION_PURPOSE_FULL_HISTORICAL,
  type FhvExecutionPurpose,
} from "@/lib/trader/observability/fhv-execution-purpose";
import {
  assertControlReplayTestOnlyAuthorityV1,
  CONTROL_REPLAY_AUTHORITY_CLASS,
  CONTROL_REPLAY_EXECUTION_MODE,
  type ControlReplayAuthorityIdentity,
} from "@/lib/trader/observability/control-replay-test-authority";
import {
  resolveFhvAuthorizationClaimPath,
  takeoverFhvAuthorizationRunning,
} from "@/lib/trader/observability/fhv-authorization-claim";
import { resolveFhvGenerationSessionDbPath } from "@/lib/trader/observability/fhv-generation-session-path";
import {
  assertFhvSyntheticScaleAuthorityForLaunch,
  readFhvSyntheticScaleAuthority,
  type FhvSyntheticScaleAuthorityV1,
} from "@/lib/trader/observability/fhv-synthetic-scale-authority";
import { runFullHistoricalBacktest } from "@/lib/trader/observability/fhv-full-historical-engine";
import {
  verifyFhvReleaseCheckoutIdentity,
  type FhvT4CheckoutIdentityProofV1,
} from "@/lib/trader/observability/fhv-t4-release-checkout-identity";
import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import {
  computeHtrFhvRunContractDigest,
  HTR_FHV_RUN_CONTRACT_INITIAL_CASH_USDT,
  HTR_FHV_RUN_CONTRACT_V0,
} from "@/lib/trader/readiness/htr-fhv-run-contract-v0";
import { computeReplayReproContentDigest } from "@/lib/trader/research/replay-repro-digest";
import { requiresWp3bTargetHostQualification } from "@/lib/trader/observability/fhv-launch-classification";
import { assertFhvWp3bHostQualified } from "@/lib/trader/observability/fhv-wp3b-receipt";
import {
  assertFhvThroughputHostQualified,
  FHV_THROUGHPUT_RECEIPT_FILENAME,
} from "@/lib/trader/observability/fhv-throughput-receipt";

export const FHV_FULL_LAUNCH_RECEIPT_SCHEMA_VERSION = "fhv-full-launch-receipt/v1" as const;
export const FHV_FULL_LAUNCH_MODE = "FULL_HISTORICAL_VALIDATION" as const;
export const FHV_BOUNDED_FULL_HISTORICAL_FIXTURE_ID = "HTR_WP03_BENCHMARK" as const;
export const FHV_HOLDOUT_UNSEAL_EVIDENCE_FILENAME = "fhv-holdout-unseal-evidence.v1.json" as const;

const FULL_SHA = /^[0-9a-f]{40}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

export type FhvFullLaunchReceiptV1 = Readonly<{
  schemaVersion: typeof FHV_FULL_LAUNCH_RECEIPT_SCHEMA_VERSION;
  mode: typeof FHV_FULL_LAUNCH_MODE;
  launchAtUtc: string;
  authorizationReceiptDigest: string;
  datasetQualificationReceiptDigest: string;
  configurationFreeze: FhvConfigurationFreezeV1;
  boundedFixture?: typeof FHV_BOUNDED_FULL_HISTORICAL_FIXTURE_ID;
  launchReceiptDigest: string;
}>;

export type FhvFullHistoricalLaunchInput = Readonly<{
  releaseSha: string;
  releaseTag?: string;
  runId: string;
  organizationId: string;
  operatorId: string;
  artifactRoot: string;
  configurationFreezePath: string;
  authorizationReceiptPath: string;
  authorizationReceiptDigest: string;
  datasetQualificationReceiptPath: string;
  datasetRoot?: string;
  manifestPath?: string;
  checkoutIdentityProofPath?: string;
  controlReplayReceiptPath?: string;
  repoPath?: string;
  rehearsalMode?: boolean;
  livePathInvoked?: boolean;
  holdoutAccessRequested?: boolean;
  boundedFixture?: boolean;
  maxCycles?: number;
  executionPurpose?: FhvExecutionPurpose;
  authorityClass?: string;
  executionMode?: string;
  capitalEligible?: boolean;
  syntheticScaleAuthorityPath?: string;
  runDir?: string;
  /** Path to the Execution Server throughput host-qualification receipt (ADR-0025 AD-6b). */
  throughputHostQualificationReceiptPath?: string;
}>;

export type FhvFullHistoricalLaunchResult = Readonly<{
  classification:
    | "BOUNDED_FULL_HISTORICAL_END_TO_END_PASS"
    | "FHV_SCHEMA_INTEGRATION_CEREMONY_PASS"
    | "FULL_HISTORICAL_VALIDATION_COMPLETED"
    | "FULL_HISTORICAL_TECHNICAL_COMPLETION"
    | "FULL_HISTORICAL_ECONOMIC_STOP_TECHNICAL_COMPLETION"
    | "FULL_HISTORICAL_INFRASTRUCTURE_FAILURE"
    | "FHV_SYNTHETIC_SCALE_PROBE_COMPLETED"
    | "FHV_SYNTHETIC_PROCESS_PARITY_SEGMENT_COMPLETED"
    | "FHV_SYNTHETIC_PROCESS_PARITY_PAUSED"
    | "FHV_CONTROL_REPLAY_CEREMONY_PASS"
    | "FULL_HISTORICAL_LAUNCH_FAILED";
  receiptPath: string;
  runDir: string;
  semanticReproDigest?: string;
  /**
   * Full-historical launches return the complete `RunBacktestResult`.
   * Control Replay plumbs the already-computed cycleCount (and optional
   * accounting slices) without fabricating a paper-path backtest.
   */
  backtest?: Pick<RunBacktestResult, "cycleCount"> & Partial<RunBacktestResult>;
  /** Pure `runBacktest` wall (excludes seed/receipt I/O) for official-scale cps feasibility. */
  hotPathWallTimeMs?: number;
}>;

export class FhvFullHistoricalLaunchError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvFullHistoricalLaunchError";
  }
}

const LEGACY_FULL_HISTORICAL_VALIDATION_PURPOSE = "FULL_HISTORICAL_VALIDATION" as const;

export function resolveFhvLaunchExecutionPurpose(input: {
  executionPurpose?: FhvExecutionPurpose | typeof LEGACY_FULL_HISTORICAL_VALIDATION_PURPOSE;
}): FhvExecutionPurpose {
  const raw = input.executionPurpose;
  if (raw === LEGACY_FULL_HISTORICAL_VALIDATION_PURPOSE) {
    throw new FhvFullHistoricalLaunchError(
      "INVALID_PURPOSE_LITERAL",
      "executionPurpose FULL_HISTORICAL_VALIDATION is deprecated; use FULL_HISTORICAL.",
    );
  }
  if (raw === FHV_EXECUTION_PURPOSE_CONTROL_REPLAY) {
    return FHV_EXECUTION_PURPOSE_CONTROL_REPLAY;
  }
  return FHV_EXECUTION_PURPOSE_FULL_HISTORICAL;
}

function assertFhvSyntheticScaleAuthorityPathRequired(input: {
  qualificationMode: FhvDatasetQualificationReceiptV1["qualificationMode"];
  maxCycles?: number;
  syntheticScaleAuthorityPath?: string;
}): void {
  if (input.qualificationMode !== "OFFICIAL_MULTI_YEAR") {
    return;
  }
  if (input.maxCycles == null) {
    return;
  }
  if (!input.syntheticScaleAuthorityPath?.trim()) {
    throw new FhvFullHistoricalLaunchError(
      "SYNTHETIC_AUTHORITY_REQUIRED",
      "OFFICIAL_MULTI_YEAR maxCycles requires syntheticScaleAuthorityPath.",
    );
  }
}

function loadFhvSyntheticScaleAuthorityForLaunch(input: {
  syntheticScaleAuthorityPath?: string;
  maxCycles?: number;
  qualificationMode: FhvDatasetQualificationReceiptV1["qualificationMode"];
}): FhvSyntheticScaleAuthorityV1 | undefined {
  if (input.qualificationMode !== "OFFICIAL_MULTI_YEAR") {
    return undefined;
  }
  // Load whenever a path is supplied — full-corpus (maxCycles=null) still seals
  // targetCycleCount for observational progress / projection. Classification remains
  // gated on maxCycles != null elsewhere.
  if (!input.syntheticScaleAuthorityPath?.trim()) {
    return undefined;
  }
  return readFhvSyntheticScaleAuthority(input.syntheticScaleAuthorityPath);
}

export function assertFhvSyntheticScaleAuthorityRequired(input: {
  qualificationReceipt: FhvDatasetQualificationReceiptV1;
  maxCycles?: number;
  syntheticScaleAuthorityPath?: string;
}): void {
  assertFhvSyntheticScaleAuthorityPathRequired({
    qualificationMode: input.qualificationReceipt.qualificationMode,
    maxCycles: input.maxCycles,
    syntheticScaleAuthorityPath: input.syntheticScaleAuthorityPath,
  });
}

function assertFhvFullHistoricalAuthorizationReceiptForResume(input: {
  receiptPath: string;
  authorizationReceiptDigest: string;
  releaseSha: string;
  releaseTag?: string;
  datasetQualificationReceiptDigest: string;
  datasetDigest: string;
  manifestDigest: string;
  configurationFreezeDigest: string;
  controlReplayReceiptDigest?: string;
  organizationId: string;
  operatorId: string;
  runId: string;
}): FhvFullHistoricalAuthorizationReceiptV1 {
  const receipt = readFhvFullHistoricalAuthorizationReceipt(input.receiptPath);
  if (receipt.authorizationReceiptDigest !== input.authorizationReceiptDigest) {
    throw new FhvFullHistoricalLaunchError(
      "AUTHORIZATION_RECEIPT_DIGEST_MISMATCH",
      "authorizationReceiptDigest mismatch.",
    );
  }
  if (!receipt.consumed) {
    throw new FhvFullHistoricalLaunchError(
      "AUTHORIZATION_NOT_CONSUMED",
      "Resume requires authorization receipt to be already consumed.",
    );
  }
  if (receipt.releaseSha !== input.releaseSha.trim().toLowerCase()) {
    throw new FhvFullHistoricalLaunchError(
      "AUTHORIZATION_RELEASE_SHA_MISMATCH",
      "Authorization receipt releaseSha mismatch.",
    );
  }
  if (input.releaseTag && receipt.releaseTag !== input.releaseTag.trim()) {
    throw new FhvFullHistoricalLaunchError(
      "AUTHORIZATION_RELEASE_TAG_MISMATCH",
      "Authorization receipt releaseTag mismatch.",
    );
  }
  if (receipt.datasetQualificationReceiptDigest !== input.datasetQualificationReceiptDigest) {
    throw new FhvFullHistoricalLaunchError(
      "AUTHORIZATION_QUALIFICATION_DIGEST_MISMATCH",
      "Authorization receipt datasetQualificationReceiptDigest mismatch.",
    );
  }
  if (
    receipt.datasetDigest !== input.datasetDigest ||
    receipt.manifestDigest !== input.manifestDigest ||
    receipt.configurationFreezeDigest !== input.configurationFreezeDigest
  ) {
    throw new FhvFullHistoricalLaunchError(
      "AUTHORIZATION_DIGEST_BINDING_MISMATCH",
      "Authorization receipt digest bindings mismatch.",
    );
  }
  if (
    input.controlReplayReceiptDigest &&
    receipt.controlReplayReceiptDigest !== input.controlReplayReceiptDigest
  ) {
    throw new FhvFullHistoricalLaunchError(
      "AUTHORIZATION_CONTROL_REPLAY_DIGEST_MISMATCH",
      "Authorization receipt controlReplayReceiptDigest mismatch.",
    );
  }
  if (
    receipt.organizationId !== input.organizationId ||
    receipt.operatorId !== input.operatorId ||
    receipt.runId !== input.runId
  ) {
    throw new FhvFullHistoricalLaunchError(
      "AUTHORIZATION_IDENTITY_MISMATCH",
      "Authorization receipt identity mismatch.",
    );
  }
  return receipt;
}

function computeLaunchReceiptDigest(
  receipt: Omit<FhvFullLaunchReceiptV1, "launchReceiptDigest">,
): string {
  return computeSemanticSha256Hex(receipt as unknown as Record<string, unknown>);
}

/** Strip run-identity fields that legitimately differ across control-replay runs. */
export function stripRunIdentityForControlReplay(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripRunIdentityForControlReplay);
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (
        key === "runId" ||
        key === "contentDigest" ||
        key === "epochId" ||
        key === "generation" ||
        key === "runDir" ||
        key === "checkpointRelativePath"
      ) {
        continue;
      }
      output[key] = stripRunIdentityForControlReplay(nested);
    }
    return output;
  }
  return value;
}

export function assertFhvRunContractIntervalsMatchPartitions(): void {
  const contract = HTR_FHV_RUN_CONTRACT_V0;
  if (
    contract.fullPeriod.startUtc !== FHV_DATASET_PARTITIONS_V1.development.startUtc ||
    contract.fullPeriod.endUtc !== FHV_DATASET_PARTITIONS_V1.blindHoldout.endUtc
  ) {
    throw new FhvFullHistoricalLaunchError(
      "FULL_PERIOD_PARTITION_MISMATCH",
      "fullPeriod must span development.startUtc through blindHoldout.endUtc (half-open).",
    );
  }
  if (
    JSON.stringify(contract.developmentCalibration) !==
    JSON.stringify(FHV_DATASET_PARTITIONS_V1.development)
  ) {
    throw new FhvFullHistoricalLaunchError(
      "DEVELOPMENT_PARTITION_MISMATCH",
      "developmentCalibration must match FHV_DATASET_PARTITIONS_V1.development.",
    );
  }
  if (
    JSON.stringify(contract.walkForward) !== JSON.stringify(FHV_DATASET_PARTITIONS_V1.walkForward)
  ) {
    throw new FhvFullHistoricalLaunchError(
      "WALK_FORWARD_PARTITION_MISMATCH",
      "walkForward must match FHV_DATASET_PARTITIONS_V1.walkForward.",
    );
  }
  if (
    JSON.stringify(contract.blindHoldout) !== JSON.stringify(FHV_DATASET_PARTITIONS_V1.blindHoldout)
  ) {
    throw new FhvFullHistoricalLaunchError(
      "BLIND_HOLDOUT_PARTITION_MISMATCH",
      "blindHoldout must match FHV_DATASET_PARTITIONS_V1.blindHoldout.",
    );
  }
}

function parseStrategyBinding(version: string): { strategyId: string; strategyVersion: string } {
  const at = version.lastIndexOf("@");
  if (at <= 0 || at >= version.length - 1) {
    throw new FhvFullHistoricalLaunchError(
      "STRATEGY_BINDING_INVALID",
      `Invalid strategy binding: ${version}`,
    );
  }
  return {
    strategyId: version.slice(0, at),
    strategyVersion: version.slice(at + 1),
  };
}

function resolveStrategyBindings(configurationFreeze: FhvConfigurationFreezeV1): {
  strategySignalIds: string[];
  primaryStrategyId: string;
  primaryStrategyVersion: string;
} {
  if (configurationFreeze.strategyVersions.length === 0) {
    throw new FhvFullHistoricalLaunchError(
      "STRATEGY_BINDINGS_REQUIRED",
      "strategyVersions are required in configuration freeze.",
    );
  }
  const bindings = configurationFreeze.strategyVersions.map(parseStrategyBinding);
  return {
    strategySignalIds: bindings.map((binding) => binding.strategyId),
    primaryStrategyId: bindings[0]!.strategyId,
    primaryStrategyVersion: bindings[0]!.strategyVersion,
  };
}

function assertCheckoutIdentityProofFile(input: {
  proofPath: string;
  releaseSha: string;
  releaseTag?: string;
  runId: string;
  organizationId: string;
}): void {
  const proof = JSON.parse(readFileSync(input.proofPath, "utf8")) as FhvT4CheckoutIdentityProofV1;
  const { contentDigest, ...withoutDigest } = proof;
  if (computePayloadDigest(withoutDigest) !== contentDigest) {
    throw new FhvFullHistoricalLaunchError(
      "CHECKOUT_PROOF_DIGEST_MISMATCH",
      "Checkout identity proof contentDigest mismatch.",
    );
  }
  if (proof.releaseSha !== input.releaseSha.trim().toLowerCase()) {
    throw new FhvFullHistoricalLaunchError(
      "CHECKOUT_PROOF_RELEASE_SHA_MISMATCH",
      "Checkout identity proof releaseSha mismatch.",
    );
  }
  if (input.releaseTag && proof.releaseTag !== input.releaseTag.trim()) {
    throw new FhvFullHistoricalLaunchError(
      "CHECKOUT_PROOF_RELEASE_TAG_MISMATCH",
      "Checkout identity proof releaseTag mismatch.",
    );
  }
  if (proof.runId !== input.runId || proof.organizationId !== input.organizationId) {
    throw new FhvFullHistoricalLaunchError(
      "CHECKOUT_PROOF_IDENTITY_MISMATCH",
      "Checkout identity proof run identity mismatch.",
    );
  }
}

export function assertCheckoutIdentity(input: FhvFullHistoricalLaunchInput, _runDir: string): void {
  if (shouldSkipFhvCheckoutIdentityVerification()) {
    return;
  }
  if (input.checkoutIdentityProofPath) {
    assertCheckoutIdentityProofFile({
      proofPath: input.checkoutIdentityProofPath,
      releaseSha: input.releaseSha,
      releaseTag: input.releaseTag,
      runId: input.runId,
      organizationId: input.organizationId,
    });
    return;
  }
  if (input.repoPath && input.releaseTag) {
    verifyFhvReleaseCheckoutIdentity({
      repoPath: input.repoPath,
      targetSha: input.releaseSha,
      releaseTag: input.releaseTag,
    });
    return;
  }
  throw new FhvFullHistoricalLaunchError(
    "CHECKOUT_IDENTITY_REQUIRED",
    "checkoutIdentityProofPath or repoPath+releaseTag required for release verification.",
  );
}

function resolveControlReplayReceiptDigest(
  input: FhvFullHistoricalLaunchInput,
): string | undefined {
  if (!input.controlReplayReceiptPath?.trim()) {
    return undefined;
  }
  return readFhvControlReplayReceipt(input.controlReplayReceiptPath).controlReplayReceiptDigest;
}

function writeFhvHoldoutUnsealEvidence(input: {
  runDir: string;
  releaseSha: string;
  organizationId: string;
  operatorId: string;
  runId: string;
  datasetQualificationReceiptDigest: string;
  controlReplayReceiptDigest?: string;
}): string {
  const evidencePath = join(input.runDir, "control", FHV_HOLDOUT_UNSEAL_EVIDENCE_FILENAME);
  if (existsSync(evidencePath)) {
    return evidencePath;
  }
  const body = {
    schemaVersion: "fhv-holdout-unseal-evidence/v1" as const,
    unsealedAtUtc: new Date().toISOString(),
    releaseSha: input.releaseSha.trim().toLowerCase(),
    organizationId: input.organizationId,
    operatorId: input.operatorId,
    runId: input.runId,
    datasetQualificationReceiptDigest: input.datasetQualificationReceiptDigest,
    ...(input.controlReplayReceiptDigest
      ? { controlReplayReceiptDigest: input.controlReplayReceiptDigest }
      : {}),
    partition: "blind-holdout" as const,
  };
  const evidence = {
    ...body,
    evidenceDigest: computePayloadDigest(body),
  };
  writeFileAtomicExclusive(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  return evidencePath;
}

export function resolveFhvFullHistoricalTerminalClassification(input: {
  boundedFixture?: boolean;
  qualificationReceipt: FhvDatasetQualificationReceiptV1;
  maxCycles?: number;
  syntheticScaleAuthority?: FhvSyntheticScaleAuthorityV1;
  sourceExhausted?: boolean;
  paused?: boolean;
}): FhvFullHistoricalLaunchResult["classification"] {
  if (input.boundedFixture) {
    return "BOUNDED_FULL_HISTORICAL_END_TO_END_PASS";
  }
  if (input.qualificationReceipt.qualificationMode === "OFFICIAL_PRE_HOLDOUT_REAL_DATA") {
    throw new FhvFullHistoricalLaunchError(
      "PRE_HOLDOUT_CANNOT_AUTHORIZE_FULL_HISTORICAL",
      "OFFICIAL_PRE_HOLDOUT_REAL_DATA cannot authorize FULL_HISTORICAL.",
    );
  }
  if (input.qualificationReceipt.qualificationMode === "SCHEMA_INTEGRATION_FIXTURE") {
    return "FHV_SCHEMA_INTEGRATION_CEREMONY_PASS";
  }
  if (input.qualificationReceipt.qualificationMode === "OFFICIAL_MULTI_YEAR") {
    if (input.maxCycles != null && input.syntheticScaleAuthority) {
      if (input.syntheticScaleAuthority.technicalObservationMode) {
        if (input.paused) {
          return "FHV_SYNTHETIC_PROCESS_PARITY_PAUSED";
        }
        return "FHV_SYNTHETIC_PROCESS_PARITY_SEGMENT_COMPLETED";
      }
      return "FHV_SYNTHETIC_SCALE_PROBE_COMPLETED";
    }
    if (input.sourceExhausted === false) {
      return "FULL_HISTORICAL_INFRASTRUCTURE_FAILURE";
    }
    return "FULL_HISTORICAL_TECHNICAL_COMPLETION";
  }
  throw new FhvFullHistoricalLaunchError(
    "UNSUPPORTED_QUALIFICATION_MODE",
    `Unsupported qualification mode for Full launch: ${input.qualificationReceipt.qualificationMode}.`,
  );
}

export function validateFhvFullHistoricalLaunchInput(
  input: FhvFullHistoricalLaunchInput,
  options?: { resume?: boolean },
): {
  configurationFreeze: FhvConfigurationFreezeV1;
  freezeArtifact: FhvConfigurationFreezeArtifactV1;
  qualificationReceipt: FhvDatasetQualificationReceiptV1;
  qualificationReceiptDigest: string;
  controlReplayReceiptDigest?: string;
  resolvedExecutionPurpose: FhvExecutionPurpose;
  syntheticScaleAuthority?: FhvSyntheticScaleAuthorityV1;
} {
  assertFhvRunContractIntervalsMatchPartitions();

  const resolvedExecutionPurpose = resolveFhvLaunchExecutionPurpose(input);

  if (input.authorityClass === CONTROL_REPLAY_AUTHORITY_CLASS) {
    const authority: ControlReplayAuthorityIdentity = {
      executionPurpose: "CONTROL_REPLAY",
      executionMode: CONTROL_REPLAY_EXECUTION_MODE,
      authorityClass: CONTROL_REPLAY_AUTHORITY_CLASS,
      capitalEligible: (input.capitalEligible ?? false) as false,
    };
    assertControlReplayTestOnlyAuthorityV1({
      surface: resolvedExecutionPurpose === "CONTROL_REPLAY" ? "CONTROL_REPLAY" : "FULL_HISTORICAL",
      authority,
    });
    if (resolvedExecutionPurpose === "FULL_HISTORICAL") {
      throw new FhvFullHistoricalLaunchError(
        "TEST_ONLY_AUTHORITY_REJECTED",
        "TEST_ONLY authority forbidden on FULL_HISTORICAL surface.",
      );
    }
  }

  if (input.rehearsalMode === true) {
    throw new FhvFullHistoricalLaunchError(
      "REHEARSAL_MODE_REJECTED",
      "FHV_REHEARSAL_MODE=true is rejected for Full Historical Validation launch.",
    );
  }

  assertFhvReplayNotLiveExchangePath(input.livePathInvoked === true);

  if (!FULL_SHA.test(input.releaseSha)) {
    throw new FhvFullHistoricalLaunchError(
      "INVALID_RELEASE_SHA",
      "releaseSha must be a full git SHA.",
    );
  }
  if (!RUN_ID_PATTERN.test(input.runId)) {
    throw new FhvFullHistoricalLaunchError("INVALID_RUN_ID", "runId is invalid.");
  }
  if (!UUID_V4.test(input.organizationId)) {
    throw new FhvFullHistoricalLaunchError(
      "INVALID_ORGANIZATION_ID",
      "organizationId must be UUID v4.",
    );
  }
  if (!input.operatorId.trim()) {
    throw new FhvFullHistoricalLaunchError("INVALID_OPERATOR_ID", "operatorId is required.");
  }

  if (input.holdoutAccessRequested === true && input.boundedFixture) {
    throw new FhvFullHistoricalLaunchError(
      "HOLDOUT_ACCESS_PROHIBITED",
      "Premature blind holdout access is prohibited.",
    );
  }

  if (!input.releaseTag?.trim() && !input.boundedFixture) {
    throw new FhvFullHistoricalLaunchError(
      "RELEASE_TAG_REQUIRED",
      "releaseTag is required for non-bounded Full Historical Validation.",
    );
  }

  const identity: FhvExecutionIdentity = {
    releaseSha: input.releaseSha,
    releaseTag: input.releaseTag ?? "unknown",
    organizationId: input.organizationId,
    operatorId: input.operatorId,
  };

  const qualificationReceipt = assertFhvDatasetQualificationReceiptForExecution({
    receiptPath: input.datasetQualificationReceiptPath,
    identity,
    requiredMode: input.boundedFixture ? undefined : undefined,
  });

  if (
    resolvedExecutionPurpose !== FHV_EXECUTION_PURPOSE_CONTROL_REPLAY &&
    qualificationReceipt.qualificationMode === "OFFICIAL_PRE_HOLDOUT_REAL_DATA"
  ) {
    throw new FhvFullHistoricalLaunchError(
      "PRE_HOLDOUT_CANNOT_AUTHORIZE_FULL_HISTORICAL",
      "OFFICIAL_PRE_HOLDOUT_REAL_DATA cannot authorize FULL_HISTORICAL.",
    );
  }

  assertFhvSyntheticScaleAuthorityRequired({
    qualificationReceipt,
    maxCycles: input.maxCycles,
    syntheticScaleAuthorityPath: input.syntheticScaleAuthorityPath,
  });

  /*
   * WP-3B target-host gate (ADR-0025 AD-6a). Only the genuine official unbounded campaign reaches
   * the 1-GiB checkpoint depth the ≤ 400 ms contract governs, so only it requires the host
   * qualification receipt. The decision is derived from this validated configuration — never from
   * the environment, which would let a forgotten variable silently disable the gate.
   */
  if (
    requiresWp3bTargetHostQualification({
      boundedFixture: input.boundedFixture,
      maxCycles: input.maxCycles,
      executionPurpose: input.executionPurpose,
      qualificationMode: qualificationReceipt.qualificationMode,
    })
  ) {
    assertFhvWp3bHostQualified({
      receiptPath:
        process.env.FHV_WP3B_HOST_RECEIPT_PATH?.trim() ||
        join(input.artifactRoot, "fhv-wp3b-host-qualification.v1.json"),
      expectedReleaseSha: input.releaseSha,
    });
    /*
     * Absolute throughput qualification (ADR-0025 AD-6b). The official unbounded campaign also
     * requires a fail-closed target-host throughput receipt proving the growth-aware projection
     * stays within the 6,480 s pre-launch headroom. This is distinct from WP-3B: WP-3B proves the
     * host can checkpoint within 400 ms; this proves it can finish the corpus in time. Both are
     * required before any official unbounded launch. Bounded fixtures, synthetic probes, process
     * parity and PRE_AUTH never require a receipt they cannot legitimately produce.
     */
    assertFhvThroughputHostQualified({
      receiptPath:
        input.throughputHostQualificationReceiptPath?.trim() ||
        join(input.artifactRoot, FHV_THROUGHPUT_RECEIPT_FILENAME),
      expectedReleaseSha: input.releaseSha,
    });
  }

  const includeHoldout =
    !input.boundedFixture && input.executionPurpose !== FHV_EXECUTION_PURPOSE_CONTROL_REPLAY;
  const controlReplayReceiptDigest = resolveControlReplayReceiptDigest(input);
  if (includeHoldout && !controlReplayReceiptDigest) {
    throw new FhvFullHistoricalLaunchError(
      "CONTROL_REPLAY_RECEIPT_REQUIRED",
      "Official holdout launch requires controlReplayReceiptPath with PASS receipt.",
    );
  }

  const freezeArtifact = assertFhvConfigurationFreezeForExecution({
    freezePath: input.configurationFreezePath,
    identity,
    runId: input.runId,
    qualificationReceipt,
  });
  const configurationFreeze = freezeArtifact.configurationFreeze;

  const expectedExecutionPurpose = resolvedExecutionPurpose;
  const authorizationReceipt = assertFhvAuthorizationReceiptForExecution({
    receiptPath: input.authorizationReceiptPath,
    identity,
    runId: input.runId,
    qualificationReceipt,
    freezeDigest: configurationFreeze.configurationFreezeDigest,
    controlReplayReceiptDigest,
    expectedExecutionPurpose,
    allowConsumed: options?.resume === true,
  });
  if (resolvedExecutionPurpose === FHV_EXECUTION_PURPOSE_CONTROL_REPLAY) {
    assertControlReplayAuthorizationPurpose(authorizationReceipt.executionPurpose);
  } else {
    assertFullHistoricalAuthorizationPurpose(authorizationReceipt.executionPurpose);
  }

  if (input.authorizationReceiptDigest !== authorizationReceipt.authorizationReceiptDigest) {
    throw new FhvFullHistoricalLaunchError(
      "AUTHORIZATION_RECEIPT_DIGEST_MISMATCH",
      "authorizationReceiptDigest mismatch.",
    );
  }

  if (includeHoldout && input.controlReplayReceiptPath) {
    assertFhvControlReplayReceiptForFullLaunch({
      receiptPath: input.controlReplayReceiptPath,
      identity,
      qualificationReceipt,
      authorizationReceipt,
    });
  }

  const authorizationBinding = {
    receiptPath: input.authorizationReceiptPath,
    authorizationReceiptDigest: input.authorizationReceiptDigest,
    releaseSha: input.releaseSha,
    releaseTag: input.releaseTag,
    datasetQualificationReceiptDigest: qualificationReceipt.qualificationReceiptDigest,
    datasetDigest: configurationFreeze.datasetDigest,
    manifestDigest: configurationFreeze.manifestDigest,
    configurationFreezeDigest: configurationFreeze.configurationFreezeDigest,
    controlReplayReceiptDigest,
    organizationId: input.organizationId,
    operatorId: input.operatorId,
    runId: input.runId,
  };
  if (options?.resume) {
    assertFhvFullHistoricalAuthorizationReceiptForResume(authorizationBinding);
  } else {
    assertFhvFullHistoricalAuthorizationReceiptForLaunch(authorizationBinding);
  }

  const syntheticScaleAuthority = loadFhvSyntheticScaleAuthorityForLaunch({
    syntheticScaleAuthorityPath: input.syntheticScaleAuthorityPath,
    maxCycles: input.maxCycles,
    qualificationMode: qualificationReceipt.qualificationMode,
  });

  if (syntheticScaleAuthority) {
    assertFhvSyntheticScaleAuthorityForLaunch({
      authority: syntheticScaleAuthority,
      executionPurpose: resolvedExecutionPurpose,
      runId: input.runId,
      organizationId: input.organizationId,
      releaseSha: input.releaseSha,
      datasetContentDigest: configurationFreeze.datasetDigest,
      manifestSemanticDigest: configurationFreeze.manifestDigest,
      maxCycles: input.maxCycles,
    });
  }

  if (configurationFreeze.initialCapitalUsdt !== HTR_FHV_RUN_CONTRACT_INITIAL_CASH_USDT) {
    throw new FhvFullHistoricalLaunchError(
      "INITIAL_CAPITAL_MISMATCH",
      `Initial capital must be exactly ${HTR_FHV_RUN_CONTRACT_INITIAL_CASH_USDT} USDT.`,
    );
  }

  if (!input.boundedFixture) {
    if (!input.datasetRoot?.trim() || !input.manifestPath?.trim()) {
      throw new FhvFullHistoricalLaunchError(
        "OFFICIAL_DATASET_PATHS_REQUIRED",
        "datasetRoot and manifestPath are required for official Full Historical Validation.",
      );
    }
    if (
      configurationFreeze.datasetDigest !== qualificationReceipt.datasetContentDigest ||
      configurationFreeze.manifestDigest !== qualificationReceipt.manifestSemanticDigest
    ) {
      throw new FhvFullHistoricalLaunchError(
        "DATASET_DIGEST_MISMATCH",
        "Configuration freeze digests must match qualified dataset receipt.",
      );
    }
  }

  if (
    configurationFreeze.strategyVersions.length === 0 ||
    configurationFreeze.strategyDigests.length === 0
  ) {
    throw new FhvFullHistoricalLaunchError(
      "STRATEGY_BINDINGS_REQUIRED",
      "strategyVersions and strategyDigests are required.",
    );
  }

  if (computeHtrFhvRunContractDigest() !== configurationFreeze.runContractDigest) {
    throw new FhvFullHistoricalLaunchError(
      "RUN_CONTRACT_DIGEST_MISMATCH",
      "Run contract digest mismatch.",
    );
  }

  return {
    configurationFreeze,
    freezeArtifact,
    qualificationReceipt,
    qualificationReceiptDigest: qualificationReceipt.qualificationReceiptDigest,
    controlReplayReceiptDigest,
    resolvedExecutionPurpose,
    syntheticScaleAuthority,
  };
}

export function resolveFhvFullLaunchRunDirectory(artifactRoot: string, runId: string): string {
  return join(artifactRoot, "RI-P7", "fhv-full-historical", runId);
}

export function writeFhvFullLaunchReceipt(input: {
  configurationFreeze: FhvConfigurationFreezeV1;
  authorizationReceiptDigest: string;
  datasetQualificationReceiptDigest: string;
  artifactRoot: string;
  runId: string;
  boundedFixture?: boolean;
  launchAtUtc?: string;
}): { receiptPath: string; receipt: FhvFullLaunchReceiptV1 } {
  const runDir = resolveFhvFullLaunchRunDirectory(input.artifactRoot, input.runId);
  if (existsSync(join(runDir, "fhv-full-launch-receipt.v1.json"))) {
    throw new FhvFullHistoricalLaunchError(
      "RUN_ID_REUSED",
      "Launch receipt already exists; refusing silent runId reuse.",
    );
  }
  mkdirSync(join(runDir, "control"), { recursive: true });

  const baseReceipt = {
    schemaVersion: FHV_FULL_LAUNCH_RECEIPT_SCHEMA_VERSION,
    mode: FHV_FULL_LAUNCH_MODE,
    launchAtUtc: input.launchAtUtc ?? new Date().toISOString(),
    authorizationReceiptDigest: input.authorizationReceiptDigest,
    datasetQualificationReceiptDigest: input.datasetQualificationReceiptDigest,
    configurationFreeze: input.configurationFreeze,
    ...(input.boundedFixture ? { boundedFixture: FHV_BOUNDED_FULL_HISTORICAL_FIXTURE_ID } : {}),
  };
  const receipt: FhvFullLaunchReceiptV1 = {
    ...baseReceipt,
    launchReceiptDigest: computeLaunchReceiptDigest(baseReceipt),
  };
  const receiptPath = join(runDir, "fhv-full-launch-receipt.v1.json");
  writeFileAtomicExclusive(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return { receiptPath, receipt };
}

async function runFhvFullHistoricalLaunchBacktest(input: {
  launchInput: FhvFullHistoricalLaunchInput;
  runDir: string;
  configurationFreeze: FhvConfigurationFreezeV1;
  qualificationReceipt: FhvDatasetQualificationReceiptV1;
  qualificationReceiptDigest: string;
  controlReplayReceiptDigest?: string;
  syntheticScaleAuthority?: FhvSyntheticScaleAuthorityV1;
  launchExecution: ReturnType<typeof prepareFhvOfficialLaunchExecution>;
  launchReceiptDigest: string;
  replaceLaunchResult?: boolean;
}): Promise<FhvFullHistoricalLaunchResult> {
  const includeHoldout = !input.launchInput.boundedFixture;
  let bars: readonly Bar[] | undefined;
  let datasetRoot: string | undefined;

  if (input.launchInput.boundedFixture) {
    bars = loadApprovedBenchmarkFixture().bars;
  } else if (input.qualificationReceipt.qualificationMode === "OFFICIAL_PRE_HOLDOUT_REAL_DATA") {
    throw new FhvFullHistoricalLaunchError(
      "PRE_HOLDOUT_CANNOT_AUTHORIZE_FULL_HISTORICAL",
      "OFFICIAL_PRE_HOLDOUT_REAL_DATA cannot authorize FULL_HISTORICAL.",
    );
  } else if (input.qualificationReceipt.qualificationMode === "OFFICIAL_MULTI_YEAR") {
    assertFhvOfficialV2DatasetArtifactsPresent({
      datasetRoot: input.launchInput.datasetRoot!,
      qualificationMode: input.qualificationReceipt.qualificationMode,
    });
    datasetRoot = input.launchInput.datasetRoot!;
  } else if (input.qualificationReceipt.qualificationMode === "SCHEMA_INTEGRATION_FIXTURE") {
    bars = loadOfficialSharedPortfolioBars({
      datasetRoot: input.launchInput.datasetRoot!,
      includeHoldout,
    });
  } else {
    throw new FhvFullHistoricalLaunchError(
      "UNSUPPORTED_QUALIFICATION_MODE",
      `Unsupported qualification mode for launch bar source: ${input.qualificationReceipt.qualificationMode}`,
    );
  }
  if (includeHoldout) {
    writeFhvHoldoutUnsealEvidence({
      runDir: input.runDir,
      releaseSha: input.launchInput.releaseSha,
      organizationId: input.launchInput.organizationId,
      operatorId: input.launchInput.operatorId,
      runId: input.launchInput.runId,
      datasetQualificationReceiptDigest: input.qualificationReceiptDigest,
      controlReplayReceiptDigest: input.controlReplayReceiptDigest,
    });
  }

  const sessionDbPath = resolveFhvGenerationSessionDbPath(
    input.runDir,
    input.launchExecution.authorizationClaim.fencingGeneration,
  );

  const backtest = await runFullHistoricalBacktest({
    runDir: input.runDir,
    runId: input.launchInput.runId,
    releaseSha: input.launchInput.releaseSha,
    organizationId: input.launchInput.organizationId,
    operatorId: input.launchInput.operatorId,
    configurationFreeze: input.configurationFreeze,
    bars,
    datasetRoot,
    qualificationMode: input.qualificationReceipt.qualificationMode,
    boundedFixture: input.launchInput.boundedFixture === true,
    includeHoldout,
    maxCycles: input.launchInput.maxCycles,
    targetCycleCount:
      input.syntheticScaleAuthority?.targetCycleCount ?? input.launchInput.maxCycles ?? null,
    artifactRoot: input.launchInput.artifactRoot,
    sessionDbPath,
    walWriter: input.launchExecution.walWriter,
    authorizationClaim: input.launchExecution.authorizationClaim,
    claimPath: input.launchExecution.claimPath,
    checkpointConfig: input.launchExecution.checkpointConfig,
    resumeFromCycle: input.launchExecution.resumeFromCycle,
  });
  const { hotPathWallTimeMs, ...backtestResult } = backtest;

  const digestStartedAt = performance.now();
  const semanticReproDigest = computeReplayReproContentDigest(
    stripRunIdentityForControlReplay(backtestResult.exportDocument),
  );
  if (process.env.FHV_IDHPS_TIMINGS === "1") {
    console.error(
      `[fhv-idhps-timings] semantic_repro_digest_ms=${(performance.now() - digestStartedAt).toFixed(1)}`,
    );
  }

  const sourceExhausted =
    input.launchInput.maxCycles == null
      ? true
      : backtestResult.cycleCount < input.launchInput.maxCycles;

  const paused =
    input.syntheticScaleAuthority?.technicalObservationMode === true &&
    input.launchInput.maxCycles != null &&
    input.syntheticScaleAuthority.maxCycles != null &&
    input.launchInput.maxCycles === input.syntheticScaleAuthority.maxCycles &&
    input.launchInput.maxCycles < input.syntheticScaleAuthority.targetCycleCount;

  const classification = resolveFhvFullHistoricalTerminalClassification({
    boundedFixture: input.launchInput.boundedFixture === true,
    qualificationReceipt: input.qualificationReceipt,
    maxCycles: input.launchInput.maxCycles,
    syntheticScaleAuthority: input.syntheticScaleAuthority,
    sourceExhausted,
    paused,
  });

  const launchResult = {
    schemaVersion: "fhv-full-launch-result/v1",
    classification,
    semanticReproDigest,
    cycleCount: backtestResult.cycleCount,
    evidenceChain: {
      qualificationReceiptDigest: input.qualificationReceiptDigest,
      controlReplayReceiptDigest: input.controlReplayReceiptDigest,
      configurationFreezeDigest: input.configurationFreeze.configurationFreezeDigest,
      authorizationReceiptDigest: input.launchInput.authorizationReceiptDigest,
      launchReceiptDigest: input.launchReceiptDigest,
      datasetContentDigest: input.configurationFreeze.datasetDigest,
      manifestSemanticDigest: input.configurationFreeze.manifestDigest,
      accountingStateDigest: backtestResult.accountingState
        ? computeAccountingSemanticDigest(backtestResult.accountingState)
        : undefined,
      htrPnlReportDigest: backtestResult.htrPnlReportV1
        ? computePayloadDigest(backtestResult.htrPnlReportV1 as unknown as Record<string, unknown>)
        : undefined,
      drawdownHwm: backtestResult.drawdownHwmState,
      checkpointRef: backtestResult.streamingManifestRef,
      fullHistoryRescanCount: getFullHistoryRescanCount(),
      holdoutUnsealEvidenceRef: includeHoldout
        ? join(input.runDir, "control", FHV_HOLDOUT_UNSEAL_EVIDENCE_FILENAME)
        : undefined,
    },
    accountingFrontierState: backtestResult.accountingFrontierState,
    htrPnlReportV1: backtestResult.htrPnlReportV1,
    sourceFrontier: backtestResult.sourceFrontier,
  };

  const launchResultPath = join(input.runDir, "fhv-full-launch-result.v1.json");
  const launchResultJson = `${JSON.stringify(launchResult, null, 2)}\n`;
  if (input.replaceLaunchResult && existsSync(launchResultPath)) {
    writeFileAtomicCompareAndReplace({
      finalPath: launchResultPath,
      expectedContent: readFileSync(launchResultPath, "utf8"),
      nextContent: launchResultJson,
    });
  } else {
    writeFileAtomicExclusive(launchResultPath, launchResultJson);
  }

  return {
    classification,
    receiptPath: join(input.runDir, "fhv-full-launch-receipt.v1.json"),
    runDir: input.runDir,
    semanticReproDigest,
    backtest: backtestResult,
    hotPathWallTimeMs,
  };
}

export async function executeFhvFullHistoricalLaunch(
  input: FhvFullHistoricalLaunchInput,
): Promise<FhvFullHistoricalLaunchResult> {
  if (input.executionPurpose === FHV_EXECUTION_PURPOSE_CONTROL_REPLAY) {
    throw new FhvFullHistoricalLaunchError(
      "CONTROL_REPLAY_USE_DEDICATED_ENTRY",
      "CONTROL_REPLAY must use executeFhvControlReplayLaunch, not executeFhvFullHistoricalLaunch.",
    );
  }

  const runDir = input.runDir ?? resolveFhvFullLaunchRunDirectory(input.artifactRoot, input.runId);
  assertCheckoutIdentity(input, runDir);

  const {
    configurationFreeze,
    qualificationReceipt,
    qualificationReceiptDigest,
    controlReplayReceiptDigest,
    syntheticScaleAuthority,
  } = validateFhvFullHistoricalLaunchInput(input);

  const timingsEnabled = process.env.FHV_IDHPS_TIMINGS === "1";
  const mark = (label: string, startedAt: number): number => {
    if (timingsEnabled) {
      console.error(
        `[fhv-idhps-timings] ${label}_ms=${(performance.now() - startedAt).toFixed(1)}`,
      );
    }
    return performance.now();
  };
  let timingCursor = performance.now();

  if (!input.boundedFixture && input.datasetRoot && input.manifestPath) {
    revalidateFhvDatasetAtLaunch({
      datasetQualificationReceiptPath: input.datasetQualificationReceiptPath,
      datasetRoot: input.datasetRoot,
      manifestPath: input.manifestPath,
    });
  }
  timingCursor = mark("revalidate_dataset", timingCursor);

  const { receiptPath, receipt } = writeFhvFullLaunchReceipt({
    configurationFreeze,
    authorizationReceiptDigest: input.authorizationReceiptDigest,
    datasetQualificationReceiptDigest: qualificationReceiptDigest,
    artifactRoot: input.artifactRoot,
    runId: input.runId,
    boundedFixture: input.boundedFixture,
  });

  consumeFhvFullHistoricalAuthorizationReceipt(input.authorizationReceiptPath);

  const launchExecution = prepareFhvOfficialLaunchExecution({
    runDir,
    runId: input.runId,
    executionPurpose: FHV_EXECUTION_PURPOSE_FULL_HISTORICAL,
    authorizationReceiptDigest: input.authorizationReceiptDigest,
    releaseSha: input.releaseSha,
    datasetContentDigest: configurationFreeze.datasetDigest,
    manifestSemanticDigest: configurationFreeze.manifestDigest,
    configurationFreeze,
    controlReplayReceiptDigest,
    leaseOwner: `${input.operatorId}@${input.organizationId}`,
  });
  timingCursor = mark("prepare_launch_execution", timingCursor);

  const result = await runFhvFullHistoricalLaunchBacktest({
    launchInput: input,
    runDir,
    configurationFreeze,
    qualificationReceipt,
    qualificationReceiptDigest,
    controlReplayReceiptDigest,
    syntheticScaleAuthority,
    launchExecution,
    launchReceiptDigest: receipt.launchReceiptDigest,
  });
  mark("run_launch_backtest_wrapper", timingCursor);

  return { ...result, receiptPath };
}

export async function resumeFhvFullHistoricalLaunch(
  input: FhvFullHistoricalLaunchInput,
): Promise<FhvFullHistoricalLaunchResult> {
  if (input.executionPurpose === FHV_EXECUTION_PURPOSE_CONTROL_REPLAY) {
    throw new FhvFullHistoricalLaunchError(
      "CONTROL_REPLAY_USE_DEDICATED_ENTRY",
      "CONTROL_REPLAY resume must use resumeFhvControlReplayLaunch.",
    );
  }

  const runDir = input.runDir ?? resolveFhvFullLaunchRunDirectory(input.artifactRoot, input.runId);
  const receiptPath = join(runDir, "fhv-full-launch-receipt.v1.json");
  if (!existsSync(receiptPath)) {
    throw new FhvFullHistoricalLaunchError(
      "LAUNCH_RECEIPT_MISSING",
      "Resume requires an existing launch receipt.",
    );
  }
  const existingReceipt = readFhvFullLaunchReceipt(receiptPath);
  const receiptBeforeMtime = readFileSync(receiptPath).toString();

  assertCheckoutIdentity(input, runDir);

  const authBefore = readFhvFullHistoricalAuthorizationReceipt(input.authorizationReceiptPath);

  const {
    configurationFreeze,
    qualificationReceipt,
    qualificationReceiptDigest,
    controlReplayReceiptDigest,
    syntheticScaleAuthority,
  } = validateFhvFullHistoricalLaunchInput(input, { resume: true });

  if (!input.boundedFixture && input.datasetRoot && input.manifestPath) {
    revalidateFhvDatasetAtLaunch({
      datasetQualificationReceiptPath: input.datasetQualificationReceiptPath,
      datasetRoot: input.datasetRoot,
      manifestPath: input.manifestPath,
    });
  }

  recoverFhvExecutionWalForResume(runDir);

  const claimPath = resolveFhvAuthorizationClaimPath(runDir);
  if (!existsSync(claimPath)) {
    throw new FhvFullHistoricalLaunchError(
      "AUTHORIZATION_CLAIM_MISSING",
      "Resume requires an existing authorization claim.",
    );
  }

  takeoverFhvAuthorizationRunning({
    claimPath,
    leaseOwner: `${input.operatorId}@${input.organizationId}`,
  });

  const launchExecution = prepareFhvOfficialLaunchExecution({
    runDir,
    runId: input.runId,
    executionPurpose: FHV_EXECUTION_PURPOSE_FULL_HISTORICAL,
    authorizationReceiptDigest: input.authorizationReceiptDigest,
    releaseSha: input.releaseSha,
    datasetContentDigest: configurationFreeze.datasetDigest,
    manifestSemanticDigest: configurationFreeze.manifestDigest,
    configurationFreeze,
    controlReplayReceiptDigest,
    leaseOwner: `${input.operatorId}@${input.organizationId}`,
  });

  const receiptAfterMtime = readFileSync(receiptPath).toString();
  if (receiptAfterMtime !== receiptBeforeMtime) {
    throw new FhvFullHistoricalLaunchError(
      "LAUNCH_RECEIPT_REWRITE_FORBIDDEN",
      "Resume must not rewrite the launch receipt.",
    );
  }

  const authAfter = readFhvFullHistoricalAuthorizationReceipt(input.authorizationReceiptPath);
  if (
    authAfter.consumedAtUtc !== authBefore.consumedAtUtc ||
    authAfter.authorizationReceiptDigest !== authBefore.authorizationReceiptDigest
  ) {
    throw new FhvFullHistoricalLaunchError(
      "AUTHORIZATION_RECONSUME_FORBIDDEN",
      "Resume must not re-consume authorization.",
    );
  }

  return runFhvFullHistoricalLaunchBacktest({
    launchInput: input,
    runDir,
    configurationFreeze,
    qualificationReceipt,
    qualificationReceiptDigest,
    controlReplayReceiptDigest,
    syntheticScaleAuthority,
    launchExecution,
    launchReceiptDigest: existingReceipt.launchReceiptDigest,
    replaceLaunchResult: true,
  });
}

export function readFhvFullLaunchReceipt(receiptPath: string): FhvFullLaunchReceiptV1 {
  const parsed = JSON.parse(readFileSync(receiptPath, "utf8")) as FhvFullLaunchReceiptV1;
  const { launchReceiptDigest: _digest, ...body } = parsed;
  const expected = computeLaunchReceiptDigest(body);
  if (expected !== parsed.launchReceiptDigest) {
    throw new FhvFullHistoricalLaunchError(
      "LAUNCH_RECEIPT_DIGEST_MISMATCH",
      "Launch receipt digest mismatch.",
    );
  }
  return parsed;
}
