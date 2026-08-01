import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  loadApprovedBenchmarkFixture,
  readGitCodeSha,
  seedBenchmarkSession,
} from "@/lib/trader/backtest/replay-benchmark-harness";
import { runBacktest, type RunBacktestResult } from "@/lib/trader/backtest/backtest-runner";
import { createStreamingEvidenceSink } from "@/lib/trader/backtest/streaming-evidence";
import {
  costModelV1FromAuthority,
  createHtrHistoricalCostModelAuthorityV1,
} from "@/lib/trader/execution/cost-model";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { MEAN_REVERSION_V0 } from "@/lib/trader/intelligence/types";
import { HistoricalBarReplaySource } from "@/lib/trader/market-data/historical-bar-replay-source";
import { FHV_DATASET_PARTITIONS_V1 } from "@/lib/trader/market-data/dataset/fhv-dataset-manifest";
import { assertFhvReplayNotLiveExchangePath } from "@/lib/trader/observability/fhv-campaign-semantic-abort";
import {
  buildFhvConfigurationFreeze,
  type FhvConfigurationFreezeV1,
} from "@/lib/trader/observability/fhv-configuration-freeze";
import { assertFhvFullHistoricalValidationAuthorization } from "@/lib/trader/observability/fhv-full-historical-auth";
import {
  computeHtrFhvRunContractDigest,
  HTR_FHV_DATASET_MANIFEST_SEMANTIC_DIGEST_PIN,
  HTR_FHV_RUN_CONTRACT_INITIAL_CASH_USDT,
  HTR_FHV_RUN_CONTRACT_V0,
} from "@/lib/trader/readiness/htr-fhv-run-contract-v0";
import { computeReplayReproContentDigest } from "@/lib/trader/research/replay-repro-digest";
import { buildResearchValidationCycleIdPrefix } from "@/lib/trader/research/research-backtest-cycle-id";
import { HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT } from "@/lib/trader/research/htr-initial-portfolio-contract";

export const FHV_FULL_LAUNCH_RECEIPT_SCHEMA_VERSION = "fhv-full-launch-receipt/v1" as const;
export const FHV_FULL_LAUNCH_MODE = "FULL_HISTORICAL_VALIDATION" as const;
export const FHV_BOUNDED_FULL_HISTORICAL_FIXTURE_ID = "HTR_WP03_BENCHMARK" as const;

const BENCHMARK_STRATEGY_VERSION = "0.1.0";
const FULL_SHA = /^[0-9a-f]{40}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

export type FhvFullLaunchReceiptV1 = Readonly<{
  schemaVersion: typeof FHV_FULL_LAUNCH_RECEIPT_SCHEMA_VERSION;
  mode: typeof FHV_FULL_LAUNCH_MODE;
  launchAtUtc: string;
  authorizationLiteral: "AUTHORIZE-FULL-HISTORICAL-VALIDATION";
  configurationFreeze: FhvConfigurationFreezeV1;
  boundedFixture?: typeof FHV_BOUNDED_FULL_HISTORICAL_FIXTURE_ID;
  launchReceiptDigest: string;
}>;

export type FhvFullHistoricalLaunchInput = Readonly<{
  authorization: string;
  releaseSha: string;
  releaseTag?: string;
  runId: string;
  organizationId: string;
  operatorId: string;
  datasetDigest: string;
  manifestDigest: string;
  strategyVersions: readonly string[];
  strategyDigests: readonly string[];
  checkpointDigest: string;
  configurationFreezeDigest: string;
  artifactRoot: string;
  rehearsalMode?: boolean;
  livePathInvoked?: boolean;
  holdoutAccessRequested?: boolean;
  boundedFixture?: boolean;
  maxCycles?: number;
}>;

export type FhvFullHistoricalLaunchResult = Readonly<{
  classification:
    | "BOUNDED_FULL_HISTORICAL_END_TO_END_PASS"
    | "FULL_HISTORICAL_LAUNCH_RECEIPT_WRITTEN"
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

export function validateFhvFullHistoricalLaunchInput(input: FhvFullHistoricalLaunchInput): void {
  assertFhvRunContractIntervalsMatchPartitions();

  if (input.rehearsalMode === true) {
    throw new FhvFullHistoricalLaunchError(
      "REHEARSAL_MODE_REJECTED",
      "FHV_REHEARSAL_MODE=true is rejected for Full Historical Validation launch.",
    );
  }

  assertFhvFullHistoricalValidationAuthorization(input.authorization);
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

  if (input.holdoutAccessRequested === true) {
    throw new FhvFullHistoricalLaunchError(
      "HOLDOUT_ACCESS_PROHIBITED",
      "Premature blind holdout access is prohibited.",
    );
  }

  const freeze = buildFhvConfigurationFreeze({
    releaseSha: input.releaseSha,
    releaseTag: input.releaseTag,
    runId: input.runId,
    organizationId: input.organizationId,
    operatorId: input.operatorId,
    datasetDigest: input.datasetDigest,
    manifestDigest: input.manifestDigest,
    strategyVersions: input.strategyVersions,
    strategyDigests: input.strategyDigests,
    checkpointDigest: input.checkpointDigest,
  });

  if (freeze.configurationFreezeDigest !== input.configurationFreezeDigest) {
    throw new FhvFullHistoricalLaunchError(
      "CONFIGURATION_FREEZE_DIGEST_MISMATCH",
      "configurationFreezeDigest mismatch.",
    );
  }

  if (freeze.initialCapitalUsdt !== HTR_FHV_RUN_CONTRACT_INITIAL_CASH_USDT) {
    throw new FhvFullHistoricalLaunchError(
      "INITIAL_CAPITAL_MISMATCH",
      `Initial capital must be exactly ${HTR_FHV_RUN_CONTRACT_INITIAL_CASH_USDT} USDT.`,
    );
  }

  if (
    input.datasetDigest !== HTR_FHV_DATASET_MANIFEST_SEMANTIC_DIGEST_PIN &&
    !input.boundedFixture
  ) {
    throw new FhvFullHistoricalLaunchError(
      "DATASET_DIGEST_MISMATCH",
      "datasetDigest must match pinned manifest digest for official multi-year launch.",
    );
  }

  if (
    input.manifestDigest !== HTR_FHV_DATASET_MANIFEST_SEMANTIC_DIGEST_PIN &&
    !input.boundedFixture
  ) {
    throw new FhvFullHistoricalLaunchError(
      "MANIFEST_DIGEST_MISMATCH",
      "manifestDigest must match pinned manifest digest for official multi-year launch.",
    );
  }

  if (input.strategyVersions.length === 0 || input.strategyDigests.length === 0) {
    throw new FhvFullHistoricalLaunchError(
      "STRATEGY_BINDINGS_REQUIRED",
      "strategyVersions and strategyDigests are required.",
    );
  }

  if (computeHtrFhvRunContractDigest() !== freeze.runContractDigest) {
    throw new FhvFullHistoricalLaunchError(
      "RUN_CONTRACT_DIGEST_MISMATCH",
      "Run contract digest mismatch.",
    );
  }
}

export function resolveFhvFullLaunchRunDirectory(artifactRoot: string, runId: string): string {
  return join(artifactRoot, "RI-P7", "fhv-full-historical", runId);
}

export function writeFhvFullLaunchReceipt(input: {
  configurationFreeze: FhvConfigurationFreezeV1;
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
    authorizationLiteral: "AUTHORIZE-FULL-HISTORICAL-VALIDATION" as const,
    configurationFreeze: input.configurationFreeze,
    ...(input.boundedFixture ? { boundedFixture: FHV_BOUNDED_FULL_HISTORICAL_FIXTURE_ID } : {}),
  };
  const receipt: FhvFullLaunchReceiptV1 = {
    ...baseReceipt,
    launchReceiptDigest: computeLaunchReceiptDigest(baseReceipt),
  };
  const receiptPath = join(runDir, "fhv-full-launch-receipt.v1.json");
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  return { receiptPath, receipt };
}

function createBenchmarkNewIdFactory(): () => string {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `00000000-0000-4000-8000-${String(436000 + sequence).padStart(12, "0")}`;
  };
}

async function runBoundedFullHistoricalBacktest(input: {
  runDir: string;
  runId: string;
  organizationId: string;
  releaseSha: string;
  configurationFreeze: FhvConfigurationFreezeV1;
  maxCycles?: number;
}): Promise<RunBacktestResult> {
  const fixture = loadApprovedBenchmarkFixture();
  const { session, context } = await seedBenchmarkSession();
  mkdirSync(input.runDir, { recursive: true });
  const evidenceSink = createStreamingEvidenceSink({
    runDir: input.runDir,
    runId: input.runId,
    gitSha: input.releaseSha,
    environment: "fhv-full-historical-bounded",
  });
  const window = {
    start: new Date(fixture.bars[0]!.barOpenTime),
    end: new Date(fixture.bars.at(-1)!.barCloseTime),
  };
  const cycleIdPrefix = buildResearchValidationCycleIdPrefix(input.runId);
  const barSource = new HistoricalBarReplaySource({
    bars: fixture.bars,
    quote: fixture.latestQuote,
    cycleIdPrefix,
  });

  try {
    return await runBacktest({
      context,
      barSource,
      deps: session.deps,
      orderRepository: session.orderRepository,
      accountKey: "fhv-full-historical",
      defaultQuantity: "0.01",
      costModel: costModelV1FromAuthority(createHtrHistoricalCostModelAuthorityV1()),
      strategySignalIds: [MEAN_REVERSION_V0],
      strategyId: MEAN_REVERSION_V0,
      strategyVersion: BENCHMARK_STRATEGY_VERSION,
      regimeLabel: "AGGREGATE",
      datasetId: "fhv-full-historical-bounded",
      runId: input.runId,
      split: "validation",
      window,
      accountState: {
        positions: [],
        openOrderCount: 0,
        dailyPnl: "0",
        drawdown: "0",
        quoteExposureByCurrency: {},
      },
      exportedAt: new Date(window.end),
      activeStrategyIds: [MEAN_REVERSION_V0],
      newId: createBenchmarkNewIdFactory(),
      retentionMode: "STREAM_ONLY",
      evidenceSink,
      maxCycles: input.maxCycles ?? 20,
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
    session.cleanup();
  }
}

export async function executeFhvFullHistoricalLaunch(
  input: FhvFullHistoricalLaunchInput,
): Promise<FhvFullHistoricalLaunchResult> {
  validateFhvFullHistoricalLaunchInput(input);

  const configurationFreeze = buildFhvConfigurationFreeze({
    releaseSha: input.releaseSha,
    releaseTag: input.releaseTag,
    runId: input.runId,
    organizationId: input.organizationId,
    operatorId: input.operatorId,
    datasetDigest: input.datasetDigest,
    manifestDigest: input.manifestDigest,
    strategyVersions: input.strategyVersions,
    strategyDigests: input.strategyDigests,
    checkpointDigest: input.checkpointDigest,
  });

  const { receiptPath } = writeFhvFullLaunchReceipt({
    configurationFreeze,
    artifactRoot: input.artifactRoot,
    runId: input.runId,
    boundedFixture: input.boundedFixture,
  });

  const runDir = resolveFhvFullLaunchRunDirectory(input.artifactRoot, input.runId);

  if (!input.boundedFixture) {
    return {
      classification: "FULL_HISTORICAL_LAUNCH_RECEIPT_WRITTEN",
      receiptPath,
      runDir,
    };
  }

  const backtest = await runBoundedFullHistoricalBacktest({
    runDir,
    runId: input.runId,
    organizationId: input.organizationId,
    releaseSha: input.releaseSha,
    configurationFreeze,
    maxCycles: input.maxCycles,
  });

  // Economic/semantic digest must exclude per-run identity (runId) so two-run
  // control replay can prove deterministic Full-mode outputs. contentDigest is
  // recomputed from the stripped body, so strip runId before hashing.
  const semanticReproDigest = computeReplayReproContentDigest(
    stripRunIdentityForControlReplay(backtest.exportDocument),
  );

  writeFileSync(
    join(runDir, "fhv-full-launch-result.v1.json"),
    `${JSON.stringify(
      {
        schemaVersion: "fhv-full-launch-result/v1",
        classification: "BOUNDED_FULL_HISTORICAL_END_TO_END_PASS",
        semanticReproDigest,
        cycleCount: backtest.cycleCount,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return {
    classification: "BOUNDED_FULL_HISTORICAL_END_TO_END_PASS",
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
