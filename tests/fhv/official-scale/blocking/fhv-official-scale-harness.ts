import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statfsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { readReplayRunChainProjections } from "@/lib/trader/backtest/streaming-evidence/replay-run-chain-reader";
import { readReplayCheckpoint } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import { assertFhvDatasetSealed } from "@/lib/trader/market-data/fhv-dataset-seal";
import { resolveFhvDatasetManifestV2Path } from "@/lib/trader/market-data/fhv-dataset-manifest-v2";
import { FHV_OFFICIAL_TOTAL_BARS } from "@/lib/trader/market-data/fhv-official-scale-corpus";
import {
  FHV_PRELAUNCH_MAX_PROJECTED_RUNTIME_S,
  projectFhvGrowthAwareRuntime,
} from "@/lib/trader/observability/fhv-growth-law";
import type { FhvSourceFrontier } from "@/lib/trader/market-data/fhv-source-frontier";
import {
  FHV_CHECKPOINT_READY_MARKER,
  readFhvExecutionCheckpointBundle,
  resolveFhvEpochCheckpointDir,
} from "@/lib/trader/observability/fhv-execution-checkpoint-bundle";
import type { FhvFullHistoricalLaunchInput } from "@/lib/trader/observability/fhv-full-historical-launch";
import { resolveFhvFullLaunchRunDirectory } from "@/lib/trader/observability/fhv-full-historical-launch";
import { readFhvLaunchJournal } from "@/lib/trader/observability/fhv-launch-journal";
import {
  buildFhvSyntheticScaleAuthority,
  FHV_SYNTHETIC_SCALE_AUTHORITY_FILENAME,
  writeFhvSyntheticScaleAuthorityAtomic,
  type FhvSyntheticScaleAuthorityV1,
} from "@/lib/trader/observability/fhv-synthetic-scale-authority";
import { measureBoundedDirectoryBytes } from "@/lib/trader/observability/fhv-telemetry-probes";
import {
  buildFhvOfficialV2ScaleDataset,
  FHV_OFFICIAL_V2_SCALE_RELEASE_SHA,
  FHV_TEST_ORG_ID,
  FHV_TEST_OPERATOR_ID,
  FHV_TEST_RELEASE_TAG,
  setupFhvOfficialV2MultiYearLaunchArtifacts,
} from "@/tests/helpers/fhv-official-path-test-fixtures";
import {
  acquireFhvManagedDatasetRoot,
  releaseFhvManagedDatasetRoot,
} from "@/tests/helpers/fhv-temp-root-registry";

import {
  CHECKPOINT_EVERY_CYCLES,
  LAST_COMMITTED_CYCLE_INDEX,
  TARGET_CYCLE_COUNT,
} from "./fhv-official-scale-constants";

export const FHV_OFFICIAL_SCALE_METRICS_FILENAME = "fhv-official-scale-metrics.v1.json";
/** Plan §8 canonical CI / full-corpus hard throughput floor (= 6_312_960 / 7200). */
export const MIN_THROUGHPUT_CPS = 877;
/**
 * Plan Phase 10 local feasibility headroom target (≥1000 bars/s).
 * Visible/reporting only — must not redefine blocking feasibilityTimePass.
 */
export const DEFAULT_PROBE_TARGET_CPS = 1000;
/** @deprecated Alias of {@link DEFAULT_PROBE_TARGET_CPS}; do not treat as blocking floor. */
export const DEFAULT_PROBE_MIN_THROUGHPUT_CPS = DEFAULT_PROBE_TARGET_CPS;
export const MAX_PROJECTED_FULL_CORPUS_RUNTIME_S = 7200;

/**
 * Resolve the visible Phase-10 probe headroom target.
 * Env `FHV_IDHPS_PROBE_MIN_BARS_PER_SECOND` may adjust the reported target only; it must never
 * enter {@link evaluateFhvOfficialScaleTimeFeasibility} / `feasibilityTimePass`.
 */
export function resolveProbeTargetCps(): number {
  const raw = process.env.FHV_IDHPS_PROBE_MIN_BARS_PER_SECOND;
  if (raw == null || raw === "") {
    return DEFAULT_PROBE_TARGET_CPS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_PROBE_TARGET_CPS;
  }
  return parsed;
}

/** @deprecated Use {@link resolveProbeTargetCps}; name historically implied a blocking floor. */
export function resolveProbeMinThroughputCps(): number {
  return resolveProbeTargetCps();
}
export const DISK_PROJECTED_MAX_FRACTION_OF_AVAILABLE = 0.7;
export const DISK_MIN_FREE_RESERVE_FRACTION = 0.3;
export const MIN_FILLS_AT_CHECKPOINT = 313;
export const MIN_ACCOUNTING_SEQUENCE_AT_CHECKPOINT = 4311;
export const MIN_WP17_OPEN_AT_CHECKPOINT = 1;

export type FhvOfficialScaleMetricsV1 = Readonly<{
  schemaVersion: "fhv-official-scale-metrics/v1";
  capturedAtUtc: string;
  cycleCount: number;
  barsProcessed: number;
  wallTimeMs: number;
  cps: number;
  projectedRuntimeS: number;
  checkpointBytes: number | null;
  checkpointBackupDurationMs: number | null;
  classification: string;
  /** Blocking: cps≥877 and projectedRuntimeS≤7200 (plan §8 canonical CI / full-corpus). */
  feasibilityTimePass: boolean;
  feasibilityDiskPass: boolean;
  /** Plan Phase 10 headroom target (default 1000); never the blocking CI floor. */
  probeTargetCps: number;
  /** Whether measured cps met the visible Phase-10 target (non-blocking). */
  probeTargetPass: boolean;
  probeGateClassification: string;
}>;

export type FhvOfficialScaleHarnessContext = Readonly<{
  datasetRoot: string;
  manifestPath: string;
  /** True when the dataset root is operator-pinned and must not be torn down. */
  externallyOwned: boolean;
  artifactRoot: string;
  releaseSha: string;
  releaseTag: string;
  organizationId: string;
  operatorId: string;
}>;

export type FhvOfficialScaleLaunchPaths = Readonly<{
  runId: string;
  runDir: string;
  artifactRoot: string;
  releaseSha: string;
  releaseTag: string;
  organizationId: string;
  operatorId: string;
  datasetRoot: string;
  manifestPath: string;
  qualificationReceiptPath: string;
  configurationFreezePath: string;
  authorizationReceiptPath: string;
  authorizationReceiptDigest: string;
  checkoutIdentityProofPath: string;
  controlReplayReceiptPath: string;
  syntheticScaleAuthorityPath: string;
}>;

export type FhvOfficialScaleParitySnapshot = Readonly<{
  semanticReproDigest: string;
  authoritativeEvidenceDigest: string;
  accountingStateDigest?: string;
  sourceFrontierDigest: string;
  globalEventSequence: number;
  sourceExhausted: boolean;
  accountingSequence: number;
  fillsCount: number;
  wp17OpenCount: number;
  identityFrontierDigest: string | null;
  classification: string;
}>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isValidCachedDatasetRoot(datasetRoot: string): boolean {
  if (!datasetRoot.trim() || !existsSync(datasetRoot)) {
    return false;
  }
  try {
    assertFhvDatasetSealed(datasetRoot);
    return existsSync(resolveFhvDatasetManifestV2Path(datasetRoot));
  } catch {
    return false;
  }
}

export function resolveFhvOfficialScaleArtifactRoot(): string {
  const configured = process.env.FHV_OFFICIAL_SCALE_ARTIFACT_ROOT?.trim();
  if (configured) {
    mkdirSync(configured, { recursive: true });
    return configured;
  }
  const root = join(process.cwd(), ".artifacts", "fhv-official-scale");
  mkdirSync(root, { recursive: true });
  return root;
}

export function resolveOrBuildFhvOfficialScaleDataset(): {
  datasetRoot: string;
  manifestPath: string;
  /** True when the root is operator-pinned and must never be torn down by this process. */
  externallyOwned: boolean;
} {
  const cached = process.env.FHV_OFFICIAL_SCALE_DATASET_ROOT?.trim();
  if (cached && isValidCachedDatasetRoot(cached)) {
    return {
      datasetRoot: cached,
      manifestPath: resolveFhvDatasetManifestV2Path(cached),
      externallyOwned: true,
    };
  }
  const { datasetRoot } = acquireFhvManagedDatasetRoot({
    prefix: "fhv-official-scale-dataset-",
    build: (root) => {
      buildFhvOfficialV2ScaleDataset(root);
    },
    releaseSha: FHV_OFFICIAL_V2_SCALE_RELEASE_SHA,
  });
  return {
    datasetRoot,
    manifestPath: resolveFhvDatasetManifestV2Path(datasetRoot),
    externallyOwned: false,
  };
}

export function buildFhvOfficialScaleHarnessContext(): FhvOfficialScaleHarnessContext {
  const { datasetRoot, manifestPath, externallyOwned } = resolveOrBuildFhvOfficialScaleDataset();
  return {
    datasetRoot,
    manifestPath,
    externallyOwned,
    artifactRoot: resolveFhvOfficialScaleArtifactRoot(),
    releaseSha: FHV_OFFICIAL_V2_SCALE_RELEASE_SHA,
    releaseTag: FHV_TEST_RELEASE_TAG,
    organizationId: FHV_TEST_ORG_ID,
    operatorId: FHV_TEST_OPERATOR_ID,
  };
}

/**
 * Release the harness dataset root. Safe to call from `afterAll` and from script `finally`
 * blocks; operator-pinned roots (`FHV_OFFICIAL_SCALE_DATASET_ROOT`) are never removed.
 */
export function teardownFhvOfficialScaleHarnessContext(
  harness: Pick<FhvOfficialScaleHarnessContext, "datasetRoot" | "externallyOwned">,
  outcome: "PASS" | "FAIL" = "PASS",
): void {
  if (harness.externallyOwned) {
    return;
  }
  releaseFhvManagedDatasetRoot(harness.datasetRoot, outcome);
}

export function writeFhvOfficialScaleSyntheticAuthority(input: {
  authorityDir: string;
  runId: string;
  organizationId: string;
  releaseSha: string;
  datasetContentDigest: string;
  manifestSemanticDigest: string;
  maxCycles: number | null;
  targetCycleCount: number;
  checkpointEveryCycles?: number;
  technicalObservationMode?: boolean;
  overwrite?: boolean;
}): string {
  mkdirSync(input.authorityDir, { recursive: true });
  const authorityPath = join(input.authorityDir, FHV_SYNTHETIC_SCALE_AUTHORITY_FILENAME);
  if (existsSync(authorityPath) && !input.overwrite) {
    return authorityPath;
  }
  const authority = buildFhvSyntheticScaleAuthority({
    runId: input.runId,
    organizationId: input.organizationId,
    releaseSha: input.releaseSha,
    datasetContentDigest: input.datasetContentDigest,
    manifestSemanticDigest: input.manifestSemanticDigest,
    maxCycles: input.maxCycles,
    targetCycleCount: input.targetCycleCount,
    checkpointEveryCycles: input.checkpointEveryCycles ?? CHECKPOINT_EVERY_CYCLES,
    technicalObservationMode: input.technicalObservationMode ?? false,
  });
  if (existsSync(authorityPath)) {
    writeFileSync(authorityPath, `${JSON.stringify(authority, null, 2)}\n`);
  } else {
    writeFhvSyntheticScaleAuthorityAtomic(authorityPath, authority);
  }
  return authorityPath;
}

export function setupFhvOfficialScaleLaunchPaths(input: {
  harness: FhvOfficialScaleHarnessContext;
  runId: string;
  maxCycles: number | null;
  targetCycleCount: number;
  technicalObservationMode?: boolean;
  checkpointEveryCycles?: number;
}): FhvOfficialScaleLaunchPaths {
  const prep = setupFhvOfficialV2MultiYearLaunchArtifacts({
    artifactRoot: input.harness.artifactRoot,
    runId: input.runId,
    datasetRoot: input.harness.datasetRoot,
    manifestPath: input.harness.manifestPath,
    releaseSha: input.harness.releaseSha,
    organizationId: input.harness.organizationId,
    operatorId: input.harness.operatorId,
    checkpointEveryCycles: input.checkpointEveryCycles ?? CHECKPOINT_EVERY_CYCLES,
  });
  const authorityDir = join(input.harness.artifactRoot, "prep", input.runId);
  const sealed = assertFhvDatasetSealed(input.harness.datasetRoot);
  const syntheticScaleAuthorityPath = writeFhvOfficialScaleSyntheticAuthority({
    authorityDir,
    runId: input.runId,
    organizationId: input.harness.organizationId,
    releaseSha: input.harness.releaseSha,
    datasetContentDigest: sealed.manifest.datasetContentDigest,
    manifestSemanticDigest: sealed.manifest.manifestSemanticDigest,
    maxCycles: input.maxCycles,
    targetCycleCount: input.targetCycleCount,
    checkpointEveryCycles: input.checkpointEveryCycles ?? CHECKPOINT_EVERY_CYCLES,
    technicalObservationMode: input.technicalObservationMode,
  });
  const runDir = resolveFhvFullLaunchRunDirectory(input.harness.artifactRoot, input.runId);
  return {
    runId: input.runId,
    runDir,
    artifactRoot: input.harness.artifactRoot,
    releaseSha: input.harness.releaseSha,
    releaseTag: input.harness.releaseTag,
    organizationId: input.harness.organizationId,
    operatorId: input.harness.operatorId,
    datasetRoot: input.harness.datasetRoot,
    manifestPath: input.harness.manifestPath,
    qualificationReceiptPath: prep.qualificationReceiptPath,
    configurationFreezePath: prep.configurationFreezePath,
    authorizationReceiptPath: prep.authorizationReceiptPath,
    authorizationReceiptDigest: prep.authorizationReceiptDigest,
    checkoutIdentityProofPath: prep.checkoutIdentityProofPath,
    controlReplayReceiptPath: prep.controlReplayReceiptPath,
    syntheticScaleAuthorityPath,
  };
}

export function toFhvOfficialScaleLaunchInput(
  paths: FhvOfficialScaleLaunchPaths,
  input?: { maxCycles?: number; resume?: boolean },
): FhvFullHistoricalLaunchInput & { resume?: boolean } {
  return {
    releaseSha: paths.releaseSha,
    releaseTag: paths.releaseTag,
    runId: paths.runId,
    organizationId: paths.organizationId,
    operatorId: paths.operatorId,
    artifactRoot: paths.artifactRoot,
    configurationFreezePath: paths.configurationFreezePath,
    authorizationReceiptPath: paths.authorizationReceiptPath,
    authorizationReceiptDigest: paths.authorizationReceiptDigest,
    datasetQualificationReceiptPath: paths.qualificationReceiptPath,
    datasetRoot: paths.datasetRoot,
    manifestPath: paths.manifestPath,
    checkoutIdentityProofPath: paths.checkoutIdentityProofPath,
    controlReplayReceiptPath: paths.controlReplayReceiptPath,
    syntheticScaleAuthorityPath: paths.syntheticScaleAuthorityPath,
    runDir: paths.runDir,
    boundedFixture: false,
    ...(input?.maxCycles != null ? { maxCycles: input.maxCycles } : {}),
    ...(input?.resume ? { resume: true } : {}),
  };
}

export function buildFhvOfficialScaleCliArgs(
  paths: FhvOfficialScaleLaunchPaths,
  input?: { maxCycles?: number; resume?: boolean },
): string[] {
  const args = [
    "trader:fhv:run",
    "--",
    "--release-sha",
    paths.releaseSha,
    "--release-tag",
    paths.releaseTag,
    "--run-id",
    paths.runId,
    "--organization-id",
    paths.organizationId,
    "--operator-id",
    paths.operatorId,
    "--artifact-root",
    paths.artifactRoot,
    "--configuration-freeze-path",
    paths.configurationFreezePath,
    "--authorization-receipt-path",
    paths.authorizationReceiptPath,
    "--authorization-receipt-digest",
    paths.authorizationReceiptDigest,
    "--dataset-qualification-receipt-path",
    paths.qualificationReceiptPath,
    "--dataset-root",
    paths.datasetRoot,
    "--manifest-path",
    paths.manifestPath,
    "--checkout-identity-proof-path",
    paths.checkoutIdentityProofPath,
    "--control-replay-receipt-path",
    paths.controlReplayReceiptPath,
    "--synthetic-scale-authority-path",
    paths.syntheticScaleAuthorityPath,
    "--run-dir",
    paths.runDir,
  ];
  if (input?.maxCycles != null) {
    args.push("--max-cycles", String(input.maxCycles));
  }
  if (input?.resume) {
    args.push("--resume");
  }
  return args;
}

export type FhvOfficialScaleCliResult = Readonly<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
  signal: NodeJS.Signals | null;
}>;

export function runFhvOfficialScaleCli(
  paths: FhvOfficialScaleLaunchPaths,
  input?: { maxCycles?: number; resume?: boolean; env?: NodeJS.ProcessEnv },
): Promise<FhvOfficialScaleCliResult> {
  const args = buildFhvOfficialScaleCliArgs(paths, input);
  return new Promise((resolve) => {
    const child = spawn("pnpm", args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        WAIA_TRADER_CLI: "1",
        NODE_ENV: "test",
        ...input?.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (exitCode, signal) => {
      resolve({ exitCode, stdout, stderr, signal });
    });
  });
}

export function spawnFhvOfficialScaleCli(
  paths: FhvOfficialScaleLaunchPaths,
  input?: { maxCycles?: number; resume?: boolean; env?: NodeJS.ProcessEnv },
): { pid: number; promise: Promise<FhvOfficialScaleCliResult> } {
  const args = buildFhvOfficialScaleCliArgs(paths, input);
  const child = spawn("pnpm", args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      WAIA_TRADER_CLI: "1",
      NODE_ENV: "test",
      ...input?.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const promise = new Promise<FhvOfficialScaleCliResult>((resolve) => {
    child.on("close", (exitCode, signal) => {
      resolve({ exitCode, stdout, stderr, signal });
    });
  });
  return { pid: child.pid ?? -1, promise };
}

/** Raised when the child process dies before producing the checkpoint the caller is waiting for. */
export class FhvOfficialScaleChildExitedError extends Error {
  constructor(
    readonly detail: Readonly<{
      runId: string;
      expectedCycle: number;
      exitCode: number | null;
      signal: NodeJS.Signals | null;
      stdout: string;
      stderr: string;
      elapsedMs: number;
    }>,
  ) {
    super(
      `[fhv-official-scale] child exited before checkpoint: runId=${detail.runId} ` +
        `expectedCycle=${detail.expectedCycle} exitCode=${String(detail.exitCode)} ` +
        `signal=${String(detail.signal)} elapsedMs=${detail.elapsedMs}\n` +
        `--- stdout ---\n${detail.stdout}\n--- stderr ---\n${detail.stderr}`,
    );
    this.name = "FhvOfficialScaleChildExitedError";
  }
}

/**
 * Wait for a checkpoint, racing the child's own termination.
 *
 * Polling the filesystem alone cannot tell "still working" from "already dead", so a child that
 * crashed in its first second still burned the full 1,800,000 ms timeout and then reported only
 * `expected 1 to be 0`. Racing termination against checkpoint readiness surfaces the real exit
 * code, signal and output within the poll interval instead.
 */
export async function waitForFhvOfficialScaleCheckpoint(input: {
  runDir: string;
  lastCommittedCycle?: number;
  timeoutMs: number;
  /** When supplied, early child termination fails immediately instead of waiting for the timeout. */
  child?: { promise: Promise<FhvOfficialScaleCliResult> };
  runId?: string;
  /** Test seam so the timeout path can be exercised without a 30-minute wait. */
  pollIntervalMs?: number;
}): Promise<{ lastCommittedCycle: number; lastCommittedEpoch: number }> {
  const targetCycle = input.lastCommittedCycle ?? LAST_COMMITTED_CYCLE_INDEX;
  const startedAt = Date.now();
  const deadline = startedAt + input.timeoutMs;
  const pollIntervalMs = input.pollIntervalMs ?? 500;

  let childResult: FhvOfficialScaleCliResult | undefined;
  // Attaching once avoids a listener leak across poll iterations. The child promise resolves on
  // close and never rejects, so this cannot produce an unhandled rejection.
  void input.child?.promise.then((result) => {
    childResult = result;
  });

  const probeCheckpoint = (): { lastCommittedCycle: number; lastCommittedEpoch: number } | null => {
    if (!existsSync(join(input.runDir, "fhv-launch-journal.v1.json"))) {
      return null;
    }
    const journal = readFhvLaunchJournal(input.runDir);
    if (journal.lastCommittedCycle < targetCycle) {
      return null;
    }
    const checkpointDir = resolveFhvEpochCheckpointDir(input.runDir, journal.lastCommittedEpoch);
    if (!existsSync(join(checkpointDir, FHV_CHECKPOINT_READY_MARKER))) {
      return null;
    }
    return {
      lastCommittedCycle: journal.lastCommittedCycle,
      lastCommittedEpoch: journal.lastCommittedEpoch,
    };
  };

  while (Date.now() < deadline) {
    const observed = probeCheckpoint();
    if (observed) {
      return observed;
    }

    const exited: FhvOfficialScaleCliResult | undefined = childResult;
    if (exited) {
      /*
       * A bounded child legitimately checkpoints and then exits PAUSED, and it can do both between
       * two polls. Re-probe once so that ordinary completion is not misreported as an early death.
       */
      const afterExit = probeCheckpoint();
      if (afterExit) {
        return afterExit;
      }
      throw new FhvOfficialScaleChildExitedError({
        runId: input.runId ?? "unknown",
        expectedCycle: targetCycle,
        exitCode: exited.exitCode,
        signal: exited.signal,
        stdout: exited.stdout,
        stderr: exited.stderr,
        elapsedMs: Date.now() - startedAt,
      });
    }
    await sleep(pollIntervalMs);
  }
  throw new Error(
    `[fhv-official-scale] timed out waiting for checkpoint lastCommittedCycle>=${targetCycle}`,
  );
}

export function readFhvOfficialScaleMetricsPath(artifactRoot: string): string {
  return join(artifactRoot, FHV_OFFICIAL_SCALE_METRICS_FILENAME);
}

export function readFhvOfficialScaleMetrics(
  artifactRoot: string,
): FhvOfficialScaleMetricsV1 | null {
  const metricsPath = readFhvOfficialScaleMetricsPath(artifactRoot);
  if (!existsSync(metricsPath)) {
    return null;
  }
  return JSON.parse(readFileSync(metricsPath, "utf8")) as FhvOfficialScaleMetricsV1;
}

export function writeFhvOfficialScaleMetrics(
  artifactRoot: string,
  metrics: FhvOfficialScaleMetricsV1,
): string {
  const metricsPath = readFhvOfficialScaleMetricsPath(artifactRoot);
  writeFileSync(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`);
  return metricsPath;
}

export function resolveFhvOfficialScaleCheckpointBytes(runDir: string): {
  checkpointBytes: number | null;
  checkpointBackupDurationMs: number | null;
} {
  if (!existsSync(join(runDir, "fhv-launch-journal.v1.json"))) {
    return { checkpointBytes: null, checkpointBackupDurationMs: null };
  }
  const journal = readFhvLaunchJournal(runDir);
  const checkpointDir = resolveFhvEpochCheckpointDir(runDir, journal.lastCommittedEpoch);
  try {
    const bundle = readFhvExecutionCheckpointBundle(checkpointDir);
    const checkpointBytes = bundle.manifest.files.reduce((sum, entry) => sum + entry.byteCount, 0);
    let checkpointBackupDurationMs: number | null = null;
    const metricsPath = join(checkpointDir, "idhps-checkpoint-metrics.v1.json");
    if (existsSync(metricsPath)) {
      const metrics = JSON.parse(readFileSync(metricsPath, "utf8")) as {
        checkpointBackupDurationMs?: number;
      };
      checkpointBackupDurationMs =
        typeof metrics.checkpointBackupDurationMs === "number"
          ? metrics.checkpointBackupDurationMs
          : null;
    }
    return { checkpointBytes, checkpointBackupDurationMs };
  } catch {
    return { checkpointBytes: null, checkpointBackupDurationMs: null };
  }
}

export function evaluateFhvOfficialScaleTimeFeasibility(input: {
  barsProcessed: number;
  wallTimeMs: number;
  /**
   * Blocking floor only. Defaults to {@link MIN_THROUGHPUT_CPS} (=877).
   * Callers must not pass the Phase-10 1000 target here.
   */
  minThroughputCps?: number;
  /**
   * Growth-aware inputs (WP-8). Supplying them adds a second projection that models checkpoint
   * cost rising with database size instead of assuming constant cost per bar. The legacy
   * projection and the blocking constants are unchanged.
   */
  growth?: {
    checkpointWallTimeMs: number;
    checkpointCount: number;
    sessionGrowthBytesPerCycle: number;
    checkpointInterceptMs: number;
    checkpointMsPerGigabyte: number;
    checkpointEveryCycles: number;
  };
}): {
  cps: number;
  projectedRuntimeS: number;
  pass: boolean;
  projectedRuntimeSecondsWithGrowth: number | null;
  prelaunchPass: boolean | null;
  prelaunchClassification: string;
  probeRepresentativenessWarning: string | null;
} {
  const wallTimeS = Math.max(input.wallTimeMs / 1000, 0.001);
  const cps = input.barsProcessed / wallTimeS;
  const projectedRuntimeS = FHV_OFFICIAL_TOTAL_BARS / Math.max(cps, Number.EPSILON);
  // Hard floor cannot be weakened below the canonical CI / full-corpus contract.
  const minThroughputCps = Math.max(
    input.minThroughputCps ?? MIN_THROUGHPUT_CPS,
    MIN_THROUGHPUT_CPS,
  );
  const pass = cps >= minThroughputCps && projectedRuntimeS <= MAX_PROJECTED_FULL_CORPUS_RUNTIME_S;

  if (!input.growth) {
    return {
      cps,
      projectedRuntimeS,
      pass,
      projectedRuntimeSecondsWithGrowth: null,
      prelaunchPass: null,
      prelaunchClassification: "FHV_PRELAUNCH_PROJECTION_UNAVAILABLE",
      probeRepresentativenessWarning:
        "growth-aware projection unavailable: probe supplied no checkpoint cost series",
    };
  }

  /*
   * `projectedRuntimeS` divides total bars by an average that already contains checkpoint time, so
   * it assumes cost per bar is constant. It is not: checkpoint cost is Θ(database size) and the
   * database grows with the run, which is why run 31011816726 over-predicted feasibility by 1.562x.
   * Model the two terms separately instead.
   */
  const hotPathWallTimeS = Math.max(
    (input.wallTimeMs - input.growth.checkpointWallTimeMs) / 1000,
    0.001,
  );
  const projection = projectFhvGrowthAwareRuntime({
    hotPathBarsPerSecond: input.barsProcessed / hotPathWallTimeS,
    sessionGrowthBytesPerCycle: input.growth.sessionGrowthBytesPerCycle,
    checkpointInterceptMs: input.growth.checkpointInterceptMs,
    checkpointMsPerGigabyte: input.growth.checkpointMsPerGigabyte,
    checkpointEveryCycles: input.growth.checkpointEveryCycles,
  });

  // A segment with fewer than two checkpoints cannot show how checkpoint cost grows, so its
  // growth term is an extrapolation from a single point.
  const probeRepresentativenessWarning =
    input.growth.checkpointCount < 2
      ? `probe segment contains ${input.growth.checkpointCount} checkpoint(s); growth term is extrapolated from too few points`
      : null;

  // Distinct from the canonical 7,200 s terminal acceptance: 6,480 s is the pre-launch margin.
  const prelaunchPass = projection.projectedRuntimeSeconds <= FHV_PRELAUNCH_MAX_PROJECTED_RUNTIME_S;
  return {
    cps,
    projectedRuntimeS,
    pass,
    projectedRuntimeSecondsWithGrowth: projection.projectedRuntimeSeconds,
    prelaunchPass,
    prelaunchClassification: prelaunchPass
      ? "FHV_PRELAUNCH_PROJECTION_WITHIN_6480S"
      : "FHV_PRELAUNCH_PROJECTION_EXCEEDS_6480S",
    probeRepresentativenessWarning,
  };
}

export function evaluateFhvOfficialScaleDiskFeasibility(input: {
  artifactRoot: string;
  runDir: string;
  cycleCount: number;
}): { projectedAdditionalBytes: number; pass: boolean } {
  const stats = statfsSync(input.artifactRoot);
  const blockSize = stats.bsize;
  // Prefer bavail (unprivileged available); fall back to bfree.
  const diskFreeBytes = Number(stats.bavail ?? stats.bfree) * Number(blockSize);
  const runDirBytes = measureBoundedDirectoryBytes(input.runDir) ?? 0;
  const projectedAdditionalBytes = Math.ceil(
    (runDirBytes / Math.max(input.cycleCount, 1)) * FHV_OFFICIAL_TOTAL_BARS,
  );
  // Plan §9: peak ≤ 70% of availableBytes AND free-after-peak ≥ 30% of availableBytes
  // (equivalent inequalities when free-after = available − peak).
  const withinAvailable =
    projectedAdditionalBytes <= diskFreeBytes * DISK_PROJECTED_MAX_FRACTION_OF_AVAILABLE;
  const projectedFreeBytesAfterPeak = diskFreeBytes - projectedAdditionalBytes;
  const reserveAfter = projectedFreeBytesAfterPeak / Math.max(diskFreeBytes, Number.EPSILON);
  const pass = withinAvailable && reserveAfter >= DISK_MIN_FREE_RESERVE_FRACTION;
  return { projectedAdditionalBytes, pass };
}

export function assertFhvOfficialScaleTimeFeasibility(input: {
  barsProcessed: number;
  wallTimeMs: number;
}): { cps: number; projectedRuntimeS: number } {
  const result = evaluateFhvOfficialScaleTimeFeasibility(input);
  if (!result.pass) {
    throw new Error(
      `BLOCKED_BY_CI_SCALE_TIME_FEASIBILITY: cps=${result.cps.toFixed(3)} projected_runtime_s=${result.projectedRuntimeS.toFixed(1)} (requires cps>=${MIN_THROUGHPUT_CPS} and projected_runtime_s<=${MAX_PROJECTED_FULL_CORPUS_RUNTIME_S})`,
    );
  }
  return { cps: result.cps, projectedRuntimeS: result.projectedRuntimeS };
}

export function assertFhvOfficialScaleDiskFeasibility(input: {
  artifactRoot: string;
  runDir: string;
  cycleCount: number;
}): void {
  const result = evaluateFhvOfficialScaleDiskFeasibility(input);
  if (!result.pass) {
    throw new Error(
      `BLOCKED_BY_CI_SCALE_DISK_FEASIBILITY: projected_additional_bytes=${result.projectedAdditionalBytes}`,
    );
  }
}

export function extractFhvOfficialScaleParitySnapshot(input: {
  runDir: string;
  sourceFrontier?: FhvSourceFrontier;
  semanticReproDigest?: string;
  classification: string;
  accountingSequence?: number;
  fillsCount?: number;
  wp17OpenCount?: number;
}): FhvOfficialScaleParitySnapshot {
  const launchResultPath = join(input.runDir, "fhv-full-launch-result.v1.json");
  const launchResult = existsSync(launchResultPath)
    ? (JSON.parse(readFileSync(launchResultPath, "utf8")) as {
        semanticReproDigest?: string;
        accountingFrontierState?: { accountingSequence?: number; consumedFillIds?: string[] };
        evidenceChain?: {
          accountingStateDigest?: string;
          checkpointRef?: { manifest?: { chainDigest?: string } };
        };
        sourceFrontier?: FhvSourceFrontier;
      })
    : {};
  let authoritativeEvidenceDigest = "";
  try {
    authoritativeEvidenceDigest = readReplayRunChainProjections(input.runDir).semanticParityDigest;
  } catch {
    authoritativeEvidenceDigest =
      launchResult.evidenceChain?.checkpointRef?.manifest?.chainDigest ?? "";
  }
  const sourceFrontier = input.sourceFrontier ?? launchResult.sourceFrontier;
  let identityFrontierDigest: string | null = null;
  let sourceFrontierDigest = sourceFrontier?.terminalCursorDigest ?? "";
  if (existsSync(join(input.runDir, "fhv-launch-journal.v1.json"))) {
    const journal = readFhvLaunchJournal(input.runDir);
    try {
      const bundle = readFhvExecutionCheckpointBundle(
        resolveFhvEpochCheckpointDir(input.runDir, journal.lastCommittedEpoch),
      );
      identityFrontierDigest = bundle.manifest.identityFrontierDigest;
      if (!sourceFrontierDigest) {
        sourceFrontierDigest = bundle.manifest.sourceCursorDigest;
      }
    } catch {
      identityFrontierDigest = null;
    }
  }
  const accountingSequence =
    input.accountingSequence ?? launchResult.accountingFrontierState?.accountingSequence ?? 0;
  const fillsCount =
    input.fillsCount ?? launchResult.accountingFrontierState?.consumedFillIds?.length ?? 0;
  return {
    semanticReproDigest: input.semanticReproDigest ?? launchResult.semanticReproDigest ?? "",
    authoritativeEvidenceDigest,
    accountingStateDigest: launchResult.evidenceChain?.accountingStateDigest,
    sourceFrontierDigest,
    globalEventSequence: sourceFrontier?.globalEventSequence ?? 0,
    sourceExhausted: sourceFrontier?.sourceExhausted ?? false,
    accountingSequence,
    fillsCount,
    wp17OpenCount: input.wp17OpenCount ?? 0,
    identityFrontierDigest,
    classification: input.classification,
  };
}

export function assertFhvOfficialScaleParityMatch(
  control: FhvOfficialScaleParitySnapshot,
  candidate: FhvOfficialScaleParitySnapshot,
): void {
  const mismatches: string[] = [];
  if (candidate.semanticReproDigest !== control.semanticReproDigest) {
    mismatches.push("semanticReproDigest");
  }
  if (candidate.authoritativeEvidenceDigest !== control.authoritativeEvidenceDigest) {
    mismatches.push("authoritativeEvidenceDigest");
  }
  if (
    control.accountingStateDigest &&
    candidate.accountingStateDigest &&
    candidate.accountingStateDigest !== control.accountingStateDigest
  ) {
    mismatches.push("accountingStateDigest");
  }
  if (candidate.sourceFrontierDigest !== control.sourceFrontierDigest) {
    mismatches.push("sourceFrontierDigest");
  }
  if (candidate.globalEventSequence !== control.globalEventSequence) {
    mismatches.push("globalEventSequence");
  }
  if (candidate.sourceExhausted !== control.sourceExhausted) {
    mismatches.push("sourceExhausted");
  }
  if (candidate.accountingSequence !== control.accountingSequence) {
    mismatches.push("accountingSequence");
  }
  if (candidate.fillsCount !== control.fillsCount) {
    mismatches.push("fillsCount");
  }
  if (candidate.wp17OpenCount !== control.wp17OpenCount) {
    mismatches.push("wp17OpenCount");
  }
  if (
    control.identityFrontierDigest &&
    candidate.identityFrontierDigest &&
    candidate.identityFrontierDigest !== control.identityFrontierDigest
  ) {
    mismatches.push("identityFrontierDigest");
  }
  if (candidate.classification !== control.classification) {
    mismatches.push("classification");
  }
  if (mismatches.length > 0) {
    throw new Error(`[fhv-official-scale] parity mismatch fields: ${mismatches.join(", ")}`);
  }
}

export function assertFhvOfficialScaleProcessParityMatch(
  control: FhvOfficialScaleParitySnapshot,
  candidate: FhvOfficialScaleParitySnapshot,
): void {
  const mismatches: string[] = [];
  if (candidate.accountingSequence !== control.accountingSequence) {
    mismatches.push("accountingSequence");
  }
  if (candidate.fillsCount !== control.fillsCount) {
    mismatches.push("fillsCount");
  }
  if (candidate.wp17OpenCount !== control.wp17OpenCount) {
    mismatches.push("wp17OpenCount");
  }
  if (
    control.identityFrontierDigest &&
    candidate.identityFrontierDigest &&
    candidate.identityFrontierDigest !== control.identityFrontierDigest
  ) {
    mismatches.push("identityFrontierDigest");
  }
  if (mismatches.length > 0) {
    throw new Error(
      `[fhv-official-scale] process parity mismatch fields: ${mismatches.join(", ")}`,
    );
  }
}

export function assertFhvOfficialScaleProbeNonTrivialCheckpoint(input: {
  fillsCount: number;
  accountingSequence: number;
  wp17OpenCount?: number | null;
  reachedCheckpoint: boolean;
}): void {
  if (!input.reachedCheckpoint) {
    return;
  }
  if (input.fillsCount < MIN_FILLS_AT_CHECKPOINT) {
    throw new Error(`[fhv-official-scale] fills ${input.fillsCount} < ${MIN_FILLS_AT_CHECKPOINT}`);
  }
  if (input.accountingSequence < MIN_ACCOUNTING_SEQUENCE_AT_CHECKPOINT) {
    throw new Error(
      `[fhv-official-scale] accountingSequence ${input.accountingSequence} < ${MIN_ACCOUNTING_SEQUENCE_AT_CHECKPOINT}`,
    );
  }
  if (input.wp17OpenCount != null && input.wp17OpenCount < MIN_WP17_OPEN_AT_CHECKPOINT) {
    throw new Error(
      `[fhv-official-scale] wp17Open ${input.wp17OpenCount} < ${MIN_WP17_OPEN_AT_CHECKPOINT}`,
    );
  }
}

export function resolveWp17OpenCount(runDir: string): number | null {
  try {
    const checkpoint = readReplayCheckpoint(runDir);
    if (!checkpoint) {
      return null;
    }
    return checkpoint.executionState?.openOrders.length ?? null;
  } catch {
    return null;
  }
}

export function resolveBarsProcessed(input: {
  sourceFrontier?: FhvSourceFrontier;
  cycleCount?: number;
}): number {
  return input.sourceFrontier?.globalEventSequence ?? input.cycleCount ?? 0;
}

export function buildFhvOfficialScaleMetrics(input: {
  cycleCount: number;
  barsProcessed: number;
  wallTimeMs: number;
  classification: string;
  checkpointBytes: number | null;
  checkpointBackupDurationMs: number | null;
  artifactRoot: string;
  runDir: string;
}): FhvOfficialScaleMetricsV1 {
  // Blocking gate: plan §8 canonical CI floor (877) + projected ≤7200. Env must not enter here.
  const time = evaluateFhvOfficialScaleTimeFeasibility({
    barsProcessed: input.barsProcessed,
    wallTimeMs: input.wallTimeMs,
    minThroughputCps: MIN_THROUGHPUT_CPS,
  });
  const disk = evaluateFhvOfficialScaleDiskFeasibility({
    artifactRoot: input.artifactRoot,
    runDir: input.runDir,
    cycleCount: input.cycleCount,
  });
  const probeTargetCps = resolveProbeTargetCps();
  const probeTargetPass = time.cps >= probeTargetCps;
  return {
    schemaVersion: "fhv-official-scale-metrics/v1",
    capturedAtUtc: new Date().toISOString(),
    cycleCount: input.cycleCount,
    barsProcessed: input.barsProcessed,
    wallTimeMs: input.wallTimeMs,
    cps: time.cps,
    projectedRuntimeS: time.projectedRuntimeS,
    checkpointBytes: input.checkpointBytes,
    checkpointBackupDurationMs: input.checkpointBackupDurationMs,
    classification: input.classification,
    feasibilityTimePass: time.pass,
    feasibilityDiskPass: disk.pass,
    probeTargetCps,
    probeTargetPass,
    // Gate PASS tracks blocking feasibility only; Phase-10 1000 target remains visible above.
    probeGateClassification:
      time.pass && disk.pass
        ? "FHV_OFFICIAL_ENGINE_THROUGHPUT_PROBE_PASS"
        : time.pass
          ? "BLOCKED_BY_CI_SCALE_DISK_FEASIBILITY"
          : "BLOCKED_BY_CI_SCALE_TIME_FEASIBILITY",
  };
}

export function readFhvOfficialScaleAuthority(authorityPath: string): FhvSyntheticScaleAuthorityV1 {
  return JSON.parse(readFileSync(authorityPath, "utf8")) as FhvSyntheticScaleAuthorityV1;
}

export function replaceFhvOfficialScaleAuthority(input: {
  authorityPath: string;
  authority: FhvSyntheticScaleAuthorityV1;
}): void {
  writeFileSync(input.authorityPath, `${JSON.stringify(input.authority, null, 2)}\n`);
}

export {
  CHECKPOINT_EVERY_CYCLES,
  LAST_COMMITTED_CYCLE_INDEX,
  TARGET_CYCLE_COUNT,
} from "./fhv-official-scale-constants";
