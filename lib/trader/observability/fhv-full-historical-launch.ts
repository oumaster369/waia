import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { computeAccountingSemanticDigest } from "@/lib/trader/accounting";
import { loadApprovedBenchmarkFixture } from "@/lib/trader/backtest/replay-benchmark-harness";
import { runBacktest, type RunBacktestResult } from "@/lib/trader/backtest/backtest-runner";
import { getFullHistoryRescanCount } from "@/lib/trader/backtest/replay-runtime-metrics";
import { writeFileAtomicExclusive } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { createStreamingEvidenceSink } from "@/lib/trader/backtest/streaming-evidence";
import {
  costModelV1FromAuthority,
  createHtrHistoricalCostModelAuthorityV1,
} from "@/lib/trader/execution/cost-model";
import { HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1 } from "@/lib/trader/intelligence/historical-profile/htr-historical-intelligence-profile-v1";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type { Bar } from "@/lib/trader/intelligence/types";
import { FhvSharedPortfolioBarReplaySource } from "@/lib/trader/market-data/fhv-shared-portfolio-bar-replay-source";
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
} from "@/lib/trader/observability/fhv-dataset-qualification";
import { revalidateFhvDatasetAtLaunch } from "@/lib/trader/observability/fhv-dataset-launch-guard";
import {
  assertFhvFullHistoricalAuthorizationReceiptForLaunch,
  consumeFhvFullHistoricalAuthorizationReceipt,
} from "@/lib/trader/observability/fhv-full-historical-auth";
import { seedFhvHistoricalExecutionSession } from "@/lib/trader/observability/fhv-historical-execution-session";
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
import { buildResearchValidationCycleIdPrefix } from "@/lib/trader/research/research-backtest-cycle-id";
import { createHtrInitialAccountRiskState } from "@/lib/trader/research/htr-initial-portfolio-contract";
import { HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT } from "@/lib/trader/research/htr-initial-portfolio-contract";
import { buildResearchV2PortfolioContext } from "@/lib/trader/research/research-portfolio-config";

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
}>;

export type FhvFullHistoricalLaunchResult = Readonly<{
  classification:
    | "BOUNDED_FULL_HISTORICAL_END_TO_END_PASS"
    | "FULL_HISTORICAL_VALIDATION_COMPLETED"
    | "FULL_HISTORICAL_LAUNCH_FAILED";
  receiptPath: string;
  runDir: string;
  semanticReproDigest?: string;
  backtest?: RunBacktestResult;
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
      if (key === "runId" || key === "contentDigest") {
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

function assertCheckoutIdentity(input: FhvFullHistoricalLaunchInput, _runDir: string): void {
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

export function validateFhvFullHistoricalLaunchInput(input: FhvFullHistoricalLaunchInput): {
  configurationFreeze: FhvConfigurationFreezeV1;
  freezeArtifact: FhvConfigurationFreezeArtifactV1;
  qualificationReceiptDigest: string;
  controlReplayReceiptDigest?: string;
} {
  assertFhvRunContractIntervalsMatchPartitions();

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

  const qualificationReceipt = readFhvDatasetQualificationReceipt(
    input.datasetQualificationReceiptPath,
  );
  if (qualificationReceipt.classification !== "DATASET_QUALIFICATION=PASS") {
    throw new FhvFullHistoricalLaunchError(
      "DATASET_QUALIFICATION_FAILED",
      "Dataset qualification receipt must classify PASS.",
    );
  }

  const includeHoldout = !input.boundedFixture;
  const controlReplayReceiptDigest = resolveControlReplayReceiptDigest(input);
  if (includeHoldout && !controlReplayReceiptDigest) {
    throw new FhvFullHistoricalLaunchError(
      "CONTROL_REPLAY_RECEIPT_REQUIRED",
      "Official holdout launch requires controlReplayReceiptPath with PASS receipt.",
    );
  }

  const freezeArtifact = readFhvConfigurationFreezeArtifact(input.configurationFreezePath);
  const configurationFreeze = freezeArtifact.configurationFreeze;

  if (
    freezeArtifact.datasetQualificationReceiptDigest !==
    qualificationReceipt.qualificationReceiptDigest
  ) {
    throw new FhvFullHistoricalLaunchError(
      "FREEZE_QUALIFICATION_DIGEST_MISMATCH",
      "Configuration freeze artifact must bind dataset qualification receipt digest.",
    );
  }

  assertFhvFullHistoricalAuthorizationReceiptForLaunch({
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
  });

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
    qualificationReceiptDigest: qualificationReceipt.qualificationReceiptDigest,
    controlReplayReceiptDigest,
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

function createBenchmarkNewIdFactory(): () => string {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `00000000-0000-4000-8000-${String(436000 + sequence).padStart(12, "0")}`;
  };
}

async function runFullHistoricalBacktest(input: {
  runDir: string;
  runId: string;
  releaseSha: string;
  organizationId: string;
  operatorId: string;
  configurationFreeze: FhvConfigurationFreezeV1;
  bars: readonly Bar[];
  latestQuote?: { symbol: string; bid: string; ask: string; last: string; timestamp: string };
  boundedFixture: boolean;
  includeHoldout: boolean;
  maxCycles?: number;
}): Promise<RunBacktestResult> {
  const costModel = costModelV1FromAuthority(createHtrHistoricalCostModelAuthorityV1());
  const portfolio = buildResearchV2PortfolioContext(costModel);
  const accountKey = "fhv-full-historical";
  const { session, context, cleanup } = await seedFhvHistoricalExecutionSession({
    organizationId: input.organizationId,
    operatorId: input.operatorId,
    slot: 436,
  });
  mkdirSync(input.runDir, { recursive: true });
  const evidenceSink = createStreamingEvidenceSink({
    runDir: input.runDir,
    runId: input.runId,
    gitSha: input.releaseSha,
    environment: input.boundedFixture
      ? "fhv-full-historical-bounded"
      : "fhv-full-historical-official",
  });
  const window = {
    start: new Date(input.bars[0]!.barOpenTime),
    end: new Date(input.bars.at(-1)!.barCloseTime),
  };
  const cycleIdPrefix = buildResearchValidationCycleIdPrefix(input.runId);
  const barSource = new FhvSharedPortfolioBarReplaySource(input.bars, cycleIdPrefix);
  const strategies = resolveStrategyBindings(input.configurationFreeze);
  const accountState = createHtrInitialAccountRiskState();

  try {
    return await runBacktest({
      context,
      barSource,
      deps: session.deps,
      orderRepository: session.orderRepository,
      accountKey,
      defaultQuantity: "0.01",
      costModel,
      portfolio,
      strategySignalIds: strategies.strategySignalIds,
      strategyId: strategies.primaryStrategyId,
      strategyVersion: strategies.primaryStrategyVersion,
      regimeLabel: "AGGREGATE",
      datasetId: input.boundedFixture
        ? "fhv-full-historical-bounded"
        : "fhv-full-historical-official",
      runId: input.runId,
      split: input.includeHoldout ? "blind" : "validation",
      window,
      accountState,
      exportedAt: new Date(window.end),
      activeStrategyIds: strategies.strategySignalIds,
      newId: createBenchmarkNewIdFactory(),
      retentionMode: "STREAM_ONLY",
      evidenceSink,
      maxCycles: input.maxCycles ?? (input.boundedFixture ? 20 : undefined),
      enableReplayFusedContext: false,
      historicalExecutionProfile: session.historicalExecutionProfile,
      historicalProfile: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1,
      wp16: {
        runId: input.runId,
        portfolioId: accountKey,
        historicalProfile: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1,
      },
      checkpointRunRoot: input.runDir,
      fhvObservability: {
        runLogRoot: join(input.runDir, "fhv-trace"),
        provenance: {
          codeSha: input.releaseSha,
          dirtyTree: false,
          datasetManifestDigest: input.configurationFreeze.manifestDigest,
          runConfigDigest: input.configurationFreeze.configurationFreezeDigest,
          strategyVersions: [...input.configurationFreeze.strategyVersions],
          costModelVersion: "waia.trader.historical-execution-model.v1",
          riskPolicyVersion: input.configurationFreeze.drawdownPolicyVersion,
          initialPortfolioDigest: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
        },
      },
    });
  } finally {
    cleanup();
  }
}

export async function executeFhvFullHistoricalLaunch(
  input: FhvFullHistoricalLaunchInput,
): Promise<FhvFullHistoricalLaunchResult> {
  const runDir = resolveFhvFullLaunchRunDirectory(input.artifactRoot, input.runId);
  assertCheckoutIdentity(input, runDir);

  const { configurationFreeze, qualificationReceiptDigest, controlReplayReceiptDigest } =
    validateFhvFullHistoricalLaunchInput(input);

  if (!input.boundedFixture && input.datasetRoot && input.manifestPath) {
    revalidateFhvDatasetAtLaunch({
      datasetQualificationReceiptPath: input.datasetQualificationReceiptPath,
      datasetRoot: input.datasetRoot,
      manifestPath: input.manifestPath,
    });
  }

  const { receiptPath, receipt } = writeFhvFullLaunchReceipt({
    configurationFreeze,
    authorizationReceiptDigest: input.authorizationReceiptDigest,
    datasetQualificationReceiptDigest: qualificationReceiptDigest,
    artifactRoot: input.artifactRoot,
    runId: input.runId,
    boundedFixture: input.boundedFixture,
  });

  consumeFhvFullHistoricalAuthorizationReceipt(input.authorizationReceiptPath);

  let bars: readonly Bar[];
  let latestQuote: ReturnType<typeof loadApprovedBenchmarkFixture>["latestQuote"] | undefined;
  const includeHoldout = !input.boundedFixture;

  if (input.boundedFixture) {
    const fixture = loadApprovedBenchmarkFixture();
    bars = fixture.bars;
    latestQuote = fixture.latestQuote;
  } else {
    bars = loadOfficialSharedPortfolioBars({
      datasetRoot: input.datasetRoot!,
      includeHoldout,
    });
    if (includeHoldout) {
      writeFhvHoldoutUnsealEvidence({
        runDir,
        releaseSha: input.releaseSha,
        organizationId: input.organizationId,
        operatorId: input.operatorId,
        runId: input.runId,
        datasetQualificationReceiptDigest: qualificationReceiptDigest,
        controlReplayReceiptDigest,
      });
    }
  }

  const backtest = await runFullHistoricalBacktest({
    runDir,
    runId: input.runId,
    releaseSha: input.releaseSha,
    organizationId: input.organizationId,
    operatorId: input.operatorId,
    configurationFreeze,
    bars,
    latestQuote,
    boundedFixture: input.boundedFixture === true,
    includeHoldout,
    maxCycles: input.maxCycles,
  });

  const semanticReproDigest = computeReplayReproContentDigest(
    stripRunIdentityForControlReplay(backtest.exportDocument),
  );

  const classification = input.boundedFixture
    ? ("BOUNDED_FULL_HISTORICAL_END_TO_END_PASS" as const)
    : ("FULL_HISTORICAL_VALIDATION_COMPLETED" as const);

  const launchResult = {
    schemaVersion: "fhv-full-launch-result/v1",
    classification,
    semanticReproDigest,
    cycleCount: backtest.cycleCount,
    evidenceChain: {
      qualificationReceiptDigest,
      controlReplayReceiptDigest,
      configurationFreezeDigest: configurationFreeze.configurationFreezeDigest,
      authorizationReceiptDigest: input.authorizationReceiptDigest,
      launchReceiptDigest: receipt.launchReceiptDigest,
      datasetContentDigest: configurationFreeze.datasetDigest,
      manifestSemanticDigest: configurationFreeze.manifestDigest,
      accountingStateDigest: backtest.accountingState
        ? computeAccountingSemanticDigest(backtest.accountingState)
        : undefined,
      htrPnlReportDigest: backtest.htrPnlReportV1
        ? computePayloadDigest(backtest.htrPnlReportV1 as unknown as Record<string, unknown>)
        : undefined,
      drawdownHwm: backtest.drawdownHwmState,
      checkpointRef: backtest.streamingManifestRef,
      fullHistoryRescanCount: getFullHistoryRescanCount(),
      holdoutUnsealEvidenceRef: includeHoldout
        ? join(runDir, "control", FHV_HOLDOUT_UNSEAL_EVIDENCE_FILENAME)
        : undefined,
    },
    accountingFrontierState: backtest.accountingFrontierState,
    htrPnlReportV1: backtest.htrPnlReportV1,
  };

  writeFileAtomicExclusive(
    join(runDir, "fhv-full-launch-result.v1.json"),
    `${JSON.stringify(launchResult, null, 2)}\n`,
  );

  return {
    classification,
    receiptPath,
    runDir,
    semanticReproDigest,
    backtest,
  };
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
