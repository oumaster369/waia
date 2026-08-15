import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import type { FhvCycleBoundarySnapshot } from "@/lib/trader/backtest/backtest-runner";
import type {
  ReplayAccountingFrontierState,
  ReplayDrawdownHwmState,
} from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import type { MockExchangeConnectorCheckpointStateV1 } from "@/lib/trader/connectors/mock-exchange-connector";
import type { HypothesisSessionState } from "@/lib/trader/intelligence/mi-core.types";
import type { FhvOfficialDatasetCursorV2 } from "@/lib/trader/market-data/fhv-official-dataset-cursor";
import { computeFhvOfficialDatasetCursorDigest } from "@/lib/trader/market-data/fhv-official-dataset-cursor";
import type { FhvOfficialDatasetReader } from "@/lib/trader/market-data/fhv-official-dataset-reader";
import type { FhvEpochCommitSnapshotDigests } from "@/lib/trader/observability/fhv-execution-checkpoint";
import { computeOrderFillFrontierDigest } from "@/lib/trader/observability/fhv-execution-checkpoint";
import { readFhvExecutionCheckpointFile } from "@/lib/trader/observability/fhv-execution-checkpoint-bundle";
import type { InMemoryResearchBacktestSession } from "@/lib/trader/research/create-in-memory-research-backtest-session";
import {
  createDeterministicReplayIdFactory,
  type DeterministicReplayIdFactory,
  type FhvDeterministicIdFrontierV1,
} from "@/lib/trader/research/deterministic-replay-id-factory";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import type { FhvOrderRateStoreSnapshotV1 } from "@/lib/trader/risk/order-rate-store";
import { restoreIdhpsCompositeMirrorFromCheckpoint } from "@/lib/trader/execution/idhps-session-registry";

export const FHV_CHECKPOINT_SESSION_SQLITE = "session.sqlite" as const;
export const FHV_CHECKPOINT_SOURCE_CURSOR = "source-cursor.v2.json" as const;
export const FHV_CHECKPOINT_RATE_STORE = "rate-store.v2.json" as const;
export const FHV_CHECKPOINT_MOCK_EXCHANGE = "mock-exchange.v2.json" as const;
export const FHV_CHECKPOINT_IDENTITY_FRONTIERS = "identity-frontiers.v2.json" as const;
export const FHV_CHECKPOINT_EXECUTION_FRONTIER = "execution-frontier.v2.json" as const;
export const FHV_CHECKPOINT_HYPOTHESIS_SESSION = "hypothesis-session.v2.json" as const;
export const FHV_CHECKPOINT_REPLAY_CLOCK = "replay-clock.v2.json" as const;

const BENCHMARK_ID_NAMESPACE = 436_000;

export type FhvCheckpointIdentityFrontiersV2 = Readonly<{
  schemaVersion: "fhv-identity-frontiers/v2";
  sessionLifecycleIdFrontier: FhvDeterministicIdFrontierV1;
  orderIdFrontier: FhvDeterministicIdFrontierV1;
  decisionIdFrontier: FhvDeterministicIdFrontierV1;
  benchmarkIdFrontier: FhvDeterministicIdFrontierV1;
  contentDigest: string;
}>;

export type FhvCheckpointReplayClockV2 = Readonly<{
  schemaVersion: "fhv-replay-clock/v2";
  nowMs: number;
  decisionBarIndex: number;
  contentDigest: string;
}>;

export type FhvCheckpointExecutionFrontierV2 = Readonly<{
  schemaVersion: "fhv-execution-frontier/v2";
  accountingFrontierState?: ReplayAccountingFrontierState;
  drawdownHwmState?: ReplayDrawdownHwmState;
  contentDigest: string;
}>;

export type FhvRestoredCheckpointRuntime = Readonly<{
  sourceCursor?: FhvOfficialDatasetCursorV2;
  hypothesisSessionState?: HypothesisSessionState;
  accountingFrontierState?: ReplayAccountingFrontierState;
  drawdownHwmState?: ReplayDrawdownHwmState;
  benchmarkNewId: DeterministicReplayIdFactory;
}>;

function sha256Payload(content: Buffer | string): string {
  const payload = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  return createHash("sha256").update(payload).digest("hex");
}

function serializeCheckpointJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readDecisionBarIndex(session: InMemoryResearchBacktestSession): number {
  return session.deps.researchReplayDeterminism?.getDecisionBarIndex?.() ?? 0;
}

export function createFhvBenchmarkNewIdFactory(
  restoredFrontier?: FhvDeterministicIdFrontierV1,
): DeterministicReplayIdFactory {
  const factory = createDeterministicReplayIdFactory(BENCHMARK_ID_NAMESPACE);
  if (restoredFrontier) {
    factory.restoreFrontier(restoredFrontier);
  }
  return factory;
}

export function captureFhvExecutionCheckpointFiles(input: {
  session: InMemoryResearchBacktestSession;
  officialReader?: FhvOfficialDatasetReader;
  boundarySnapshot?: FhvCycleBoundarySnapshot;
  benchmarkNewId: DeterministicReplayIdFactory;
}): Record<string, Buffer | string> {
  const files: Record<string, Buffer | string> = {};

  if (input.officialReader) {
    const cursor = input.officialReader.captureCursor();
    files[FHV_CHECKPOINT_SOURCE_CURSOR] = serializeCheckpointJson(cursor);
  }

  files[FHV_CHECKPOINT_RATE_STORE] = serializeCheckpointJson(
    input.session.rateStore.captureSnapshot(),
  );
  files[FHV_CHECKPOINT_MOCK_EXCHANGE] = serializeCheckpointJson(
    input.session.connector.captureCheckpointState(),
  );

  const identityBody = {
    schemaVersion: "fhv-identity-frontiers/v2" as const,
    sessionLifecycleIdFrontier: input.session.sessionNewId.captureFrontier(),
    orderIdFrontier: input.session.orderNewId.captureFrontier(),
    decisionIdFrontier: input.session.newDecisionId.captureFrontier(),
    benchmarkIdFrontier: input.benchmarkNewId.captureFrontier(),
  };
  files[FHV_CHECKPOINT_IDENTITY_FRONTIERS] = serializeCheckpointJson({
    ...identityBody,
    contentDigest: computeStableJsonDigest(identityBody),
  });

  const replayClockBody = {
    schemaVersion: "fhv-replay-clock/v2" as const,
    nowMs: input.session.replayClock.nowMs(),
    decisionBarIndex: readDecisionBarIndex(input.session),
  };
  files[FHV_CHECKPOINT_REPLAY_CLOCK] = serializeCheckpointJson({
    ...replayClockBody,
    contentDigest: computeStableJsonDigest(replayClockBody),
  });

  const executionFrontierBody = {
    schemaVersion: "fhv-execution-frontier/v2" as const,
    ...(input.boundarySnapshot?.accountingFrontierState
      ? { accountingFrontierState: input.boundarySnapshot.accountingFrontierState }
      : {}),
    ...(input.boundarySnapshot?.drawdownHwmState
      ? { drawdownHwmState: input.boundarySnapshot.drawdownHwmState }
      : {}),
  };
  if (
    executionFrontierBody.accountingFrontierState !== undefined ||
    executionFrontierBody.drawdownHwmState !== undefined
  ) {
    files[FHV_CHECKPOINT_EXECUTION_FRONTIER] = serializeCheckpointJson({
      ...executionFrontierBody,
      contentDigest: computeStableJsonDigest(executionFrontierBody),
    });
  }

  if (input.boundarySnapshot?.hypothesisSessionState) {
    files[FHV_CHECKPOINT_HYPOTHESIS_SESSION] = serializeCheckpointJson(
      input.boundarySnapshot.hypothesisSessionState,
    );
  }

  return files;
}

export function computeFhvCheckpointSnapshotDigests(input: {
  checkpointFiles: Readonly<Record<string, Buffer | string>>;
  fallbackSourceCursorDigest: string;
}): FhvEpochCommitSnapshotDigests {
  const digestForFile = (filename: string, fallback = "0".repeat(64)): string => {
    const content = input.checkpointFiles[filename];
    if (content === undefined) {
      return fallback;
    }
    return sha256Payload(content);
  };

  const sourceCursorContent = input.checkpointFiles[FHV_CHECKPOINT_SOURCE_CURSOR];
  let sourceCursorDigest = input.fallbackSourceCursorDigest;
  if (sourceCursorContent !== undefined) {
    try {
      const parsed = JSON.parse(
        typeof sourceCursorContent === "string"
          ? sourceCursorContent
          : sourceCursorContent.toString("utf8"),
      ) as FhvOfficialDatasetCursorV2;
      sourceCursorDigest = computeFhvOfficialDatasetCursorDigest(parsed);
    } catch {
      sourceCursorDigest = sha256Payload(sourceCursorContent);
    }
  }

  return {
    sourceCursorDigest,
    executionStateDigest: digestForFile(FHV_CHECKPOINT_MOCK_EXCHANGE),
    accountingFrontierDigest: digestForFile(FHV_CHECKPOINT_EXECUTION_FRONTIER),
    identityFrontierDigest: digestForFile(FHV_CHECKPOINT_IDENTITY_FRONTIERS),
    orderFillFrontierDigest: resolveOrderFillFrontierDigestFromCheckpointFiles(
      input.checkpointFiles,
    ),
  };
}

function resolveOrderFillFrontierDigestFromCheckpointFiles(
  checkpointFiles: Readonly<Record<string, Buffer | string>>,
): string {
  const content = checkpointFiles[FHV_CHECKPOINT_EXECUTION_FRONTIER];
  if (content === undefined) {
    return computeOrderFillFrontierDigest([]);
  }
  try {
    const parsed = JSON.parse(typeof content === "string" ? content : content.toString("utf8")) as {
      accountingFrontierState?: { consumedFillIds?: string[] };
    };
    return computeOrderFillFrontierDigest(parsed.accountingFrontierState?.consumedFillIds ?? []);
  } catch {
    return computeOrderFillFrontierDigest([]);
  }
}

export function restoreFhvCheckpointSessionDatabase(input: {
  checkpointDir: string;
  sessionDbPath: string;
}): void {
  const sourcePath = join(input.checkpointDir, FHV_CHECKPOINT_SESSION_SQLITE);
  if (!existsSync(sourcePath)) {
    throw new Error(`[fhv] checkpoint session.sqlite missing: ${sourcePath}`);
  }
  mkdirSync(dirname(input.sessionDbPath), { recursive: true });
  copyFileSync(sourcePath, input.sessionDbPath);
  // Checkpoint dest is chmod 0444 (immutable identity). Live resume must be writable.
  chmodSync(input.sessionDbPath, 0o644);
}

function parseCheckpointJson<T>(checkpointDir: string, relativePath: string): T | undefined {
  if (!existsSync(join(checkpointDir, relativePath))) {
    return undefined;
  }
  return readFhvExecutionCheckpointFile<T>(checkpointDir, relativePath);
}

export function restoreFhvExecutionCheckpointRuntime(input: {
  checkpointDir: string;
  session: InMemoryResearchBacktestSession;
}): FhvRestoredCheckpointRuntime {
  const identityFrontiers = parseCheckpointJson<FhvCheckpointIdentityFrontiersV2>(
    input.checkpointDir,
    FHV_CHECKPOINT_IDENTITY_FRONTIERS,
  );
  if (identityFrontiers) {
    const body = {
      schemaVersion: identityFrontiers.schemaVersion,
      sessionLifecycleIdFrontier: identityFrontiers.sessionLifecycleIdFrontier,
      orderIdFrontier: identityFrontiers.orderIdFrontier,
      decisionIdFrontier: identityFrontiers.decisionIdFrontier,
      benchmarkIdFrontier: identityFrontiers.benchmarkIdFrontier,
    };
    if (computeStableJsonDigest(body) !== identityFrontiers.contentDigest) {
      throw new Error("[fhv] identity frontiers checkpoint contentDigest mismatch");
    }
    input.session.sessionNewId.restoreFrontier(identityFrontiers.sessionLifecycleIdFrontier);
    input.session.orderNewId.restoreFrontier(identityFrontiers.orderIdFrontier);
    input.session.newDecisionId.restoreFrontier(identityFrontiers.decisionIdFrontier);
  }

  const rateStoreSnapshot = parseCheckpointJson<FhvOrderRateStoreSnapshotV1>(
    input.checkpointDir,
    FHV_CHECKPOINT_RATE_STORE,
  );
  if (rateStoreSnapshot) {
    input.session.rateStore.restoreSnapshot(rateStoreSnapshot);
  }

  const mockExchangeSnapshot = parseCheckpointJson<MockExchangeConnectorCheckpointStateV1>(
    input.checkpointDir,
    FHV_CHECKPOINT_MOCK_EXCHANGE,
  );
  if (mockExchangeSnapshot) {
    input.session.connector.restoreCheckpointState(mockExchangeSnapshot);
  }

  const replayClockSnapshot = parseCheckpointJson<FhvCheckpointReplayClockV2>(
    input.checkpointDir,
    FHV_CHECKPOINT_REPLAY_CLOCK,
  );
  if (replayClockSnapshot) {
    const body = {
      schemaVersion: replayClockSnapshot.schemaVersion,
      nowMs: replayClockSnapshot.nowMs,
      decisionBarIndex: replayClockSnapshot.decisionBarIndex,
    };
    if (computeStableJsonDigest(body) !== replayClockSnapshot.contentDigest) {
      throw new Error("[fhv] replay clock checkpoint contentDigest mismatch");
    }
    input.session.replayClock.setNowMs(replayClockSnapshot.nowMs);
    input.session.deps.researchReplayDeterminism?.setDecisionBarIndex?.(
      replayClockSnapshot.decisionBarIndex,
    );
  }

  const executionFrontier = parseCheckpointJson<FhvCheckpointExecutionFrontierV2>(
    input.checkpointDir,
    FHV_CHECKPOINT_EXECUTION_FRONTIER,
  );
  if (executionFrontier) {
    const body = {
      schemaVersion: executionFrontier.schemaVersion,
      ...(executionFrontier.accountingFrontierState
        ? { accountingFrontierState: executionFrontier.accountingFrontierState }
        : {}),
      ...(executionFrontier.drawdownHwmState
        ? { drawdownHwmState: executionFrontier.drawdownHwmState }
        : {}),
    };
    if (computeStableJsonDigest(body) !== executionFrontier.contentDigest) {
      throw new Error("[fhv] execution frontier checkpoint contentDigest mismatch");
    }
  }

  const hypothesisSessionState = parseCheckpointJson<HypothesisSessionState>(
    input.checkpointDir,
    FHV_CHECKPOINT_HYPOTHESIS_SESSION,
  );

  const sourceCursor = parseCheckpointJson<FhvOfficialDatasetCursorV2>(
    input.checkpointDir,
    FHV_CHECKPOINT_SOURCE_CURSOR,
  );

  const benchmarkNewId = createFhvBenchmarkNewIdFactory(identityFrontiers?.benchmarkIdFrontier);

  // Resume after durable EPOCH_COMMIT: restore post-step-10 IDHPS mirrors.
  restoreIdhpsCompositeMirrorFromCheckpoint(input.checkpointDir);

  return {
    ...(sourceCursor ? { sourceCursor } : {}),
    ...(hypothesisSessionState ? { hypothesisSessionState } : {}),
    ...(executionFrontier?.accountingFrontierState
      ? { accountingFrontierState: executionFrontier.accountingFrontierState }
      : {}),
    ...(executionFrontier?.drawdownHwmState
      ? { drawdownHwmState: executionFrontier.drawdownHwmState }
      : {}),
    benchmarkNewId,
  };
}
