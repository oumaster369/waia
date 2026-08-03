import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { computeSemanticParityDigest } from "@/lib/trader/backtest/streaming-evidence/semantic-parity-digest";
import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import { reconstructStreamingEvidence } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-reconstructor";
import { StreamingEvidenceReader } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-reader";
import type {
  ReplayCycleEvidenceProjection,
  StreamingEvidenceTerminalState,
} from "@/lib/trader/backtest/streaming-evidence/streaming-evidence.types";
import { canonicalJsonString } from "@/lib/trader/research/digest";

export const REPLAY_CHECKPOINT_SCHEMA_VERSION = "htr-wp17-replay-checkpoint/v3" as const;
export const REPLAY_RUN_CHAIN_MANIFEST_SCHEMA_VERSION = "htr-wp05-run-chain/v2" as const;

export type ResearchReplayPhase = "validation" | `walk-forward:${number}` | "blind" | "none";

export type ReplayRunTerminalState =
  | "REPLAY_RUN_OK"
  | "REPLAY_RUN_SEALED_PARTIAL_RESUMABLE"
  | "REPLAY_RUN_INFRA_DISCONNECT"
  | "REPLAY_RUN_FAILED_NONRESUMABLE";

export type ReplayCheckpointErrorCode =
  | "REPLAY_RESUME_IDENTITY_MISMATCH"
  | "REPLAY_CHECKPOINT_CORRUPT"
  | "REPLAY_CHECKPOINT_DIGEST_MISMATCH"
  | "REPLAY_FRONTIER_MISMATCH"
  | "REPLAY_PHASE_CYCLE_GAP"
  | "REPLAY_RUN_CHAIN_INVALID";

export class ReplayCheckpointError extends Error {
  readonly code: ReplayCheckpointErrorCode;

  constructor(code: ReplayCheckpointErrorCode, message: string) {
    super(message);
    this.name = "ReplayCheckpointError";
    this.code = code;
  }
}

import type { HistoricalExecutionCheckpointSlice } from "@/lib/trader/execution/historical-execution-model.types";
import type { FhvCampaignIdentityFrontierState } from "@/lib/trader/observability/fhv-campaign-identity";
import type { FhvRehearsalEconomicFrontierV1 } from "@/lib/trader/observability/fhv-rehearsal-economic-frontier";

export type ReplayDrawdownHwmState = {
  accountPeakHwm: string;
  monthlyPeakHwm: string;
  monthKey: string;
  breachState: "NONE" | "CLOSE_ONLY" | "STOP_ACCOUNT";
  strategyPeaks: Readonly<Record<string, string>>;
  strategyDrawdownBpsByKey: Readonly<Record<string, number>>;
  monthlyDrawdownBps: number;
  accountDrawdownBps: number;
};

export type ReplayAccountingFrontierState = {
  accountingSequence: number;
  frontierAsOf: string;
  cash: string;
  equity: string;
  equityHwm: string;
  monthlyPeakHwm: string;
  monthKey: string;
  accountDrawdownBps: number;
  monthlyDrawdownBps: number;
  strategyPeakHwmByKey: Record<string, string>;
  strategyDrawdownBpsByKey: Record<string, number>;
  marksJson: Record<string, { price: string; barCloseTime: string }>;
  positionsJson: Record<
    string,
    { quantity: string; grossPositionBasis: string; netPositionBasis: string }
  >;
  consumedFillIds: string[];
  cashEventsJson: Array<{ fillId: string; netCashEffect: string }>;
  /** IDHPS: cash base for epoch-bounded cashEvents (defaults to starting cash on restore). */
  cashLedgerBaseUsdt?: string;
  grossRealizedPnl: string;
  netRealizedPnl: string;
  semanticContentDigest: string;
};

export function buildReplayAccountingFrontierState(input: {
  accountingSequence: number;
  frontierAsOf: string;
  cash: string;
  equity: string;
  equityHwm: string;
  monthlyPeakHwm: string;
  monthKey: string;
  accountDrawdownBps: number;
  monthlyDrawdownBps: number;
  strategyPeakHwmByKey: Record<string, string>;
  strategyDrawdownBpsByKey: Record<string, number>;
  marksJson: Record<string, { price: string; barCloseTime: string }>;
  positionsJson: Record<
    string,
    { quantity: string; grossPositionBasis: string; netPositionBasis: string }
  >;
  consumedFillIds: string[];
  cashEventsJson: Array<{ fillId: string; netCashEffect: string }>;
  cashLedgerBaseUsdt?: string;
  grossRealizedPnl: string;
  netRealizedPnl: string;
  semanticContentDigest: string;
}): ReplayAccountingFrontierState {
  return { ...input };
}

export type ReplayCheckpointRecord = {
  schemaVersion: typeof REPLAY_CHECKPOINT_SCHEMA_VERSION;
  backtestRunId: string;
  datasetContentDigest: string;
  datasetId: string;
  codeSha: string;
  activePhase: ResearchReplayPhase;
  dbDurableThroughPhase: ResearchReplayPhase;
  evidenceDurableThroughCycleIndex: number;
  safeResumeThroughCycleIndex: number;
  evidenceRunDir: string;
  evidenceChainDigest: string | null;
  evidenceTerminalState: StreamingEvidenceTerminalState;
  dbConnectionMode: string | null;
  replayTerminalState: ReplayRunTerminalState;
  fixtureSha256?: string;
  canvasStateRef?: string;
  /** HTR-WP16: restart-safe drawdown HWM checkpoint slice. */
  drawdownHwmState?: ReplayDrawdownHwmState;
  /** HTR-WP17: in-flight historical execution open-order metadata. */
  executionState?: HistoricalExecutionCheckpointSlice;
  /** HTR-WP18: accounting frontier restart slice. */
  accountingFrontierState?: ReplayAccountingFrontierState;
  /** DEE-431: cross-process campaign identity generator frontier (integrity-protected). */
  campaignIdentityFrontierState?: FhvCampaignIdentityFrontierState;
  /** DEE-431: quiescent economic frontier required for bounded T4 resumable checkpoints. */
  rehearsalEconomicFrontierState?: FhvRehearsalEconomicFrontierV1;
  checkpointDigest: string;
};

/**
 * Segment role in the authoritative semantic projection stream (HTR-WP05 §continuation).
 * - `authoritative`: contributes to the composed semantic parity stream, metrics, and reproducibility.
 * - `superseded`: an immutable audit attempt (e.g. an interrupted partial segment) that is preserved
 *   and verifiable but explicitly EXCLUDED from authoritative composition. Overlap may exist between a
 *   superseded attempt and its authoritative replacement, but never inside the authoritative stream.
 */
export type ReplayRunChainSegmentRole = "authoritative" | "superseded";

export type ReplayRunChainSegment = {
  runDir: string;
  chainDigest: string;
  /** Authoritative vs preserved-but-superseded audit attempt (defaults to authoritative when absent). */
  role?: ReplayRunChainSegmentRole;
  continuesFromRunDir?: string;
  continuesFromChainDigest?: string;
  terminalState: StreamingEvidenceTerminalState;
  sealedThroughCycleIndex: number;
};

export function segmentRole(segment: ReplayRunChainSegment): ReplayRunChainSegmentRole {
  return segment.role ?? "authoritative";
}

export type ReplayRunChainManifest = {
  schemaVersion: typeof REPLAY_RUN_CHAIN_MANIFEST_SCHEMA_VERSION;
  backtestRunId: string;
  activePhase: ResearchReplayPhase;
  segments: ReplayRunChainSegment[];
  /**
   * Legacy composed chain digest over all segment chainDigests (backward compatible).
   * Prefer `authoritativeSemanticDigest` for uninterrupted vs resumed parity comparison.
   */
  composedChainDigest: string;
  /** Digest of authoritative projection stream only (semantic parity). Required in v2. */
  authoritativeSemanticDigest: string;
  /** Digest of full audit lineage including superseded segment metadata. Required in v2. */
  auditLineageDigest: string;
};

export type DbPhaseFrontier = {
  dbDurableThroughPhase: ResearchReplayPhase;
  /** Highest cycle index (inclusive) of the DB-durable phase; -1 when none. */
  lastCycleIndexOfDbDurablePhase: number;
  validationResultCommitted: boolean;
  walkForwardWindowCount: number;
  blindResultCommitted: boolean;
};

export type ResolveResumeBoundaryInput = {
  activePhase: ResearchReplayPhase;
  /** Evidence runDir for the DB-durable phase (when committed). */
  dbDurablePhaseRunDir: string | null;
  dbFrontier: DbPhaseFrontier;
  /** Last cycle index (inclusive) per phase when that phase completed. */
  phaseLastCycleIndex: Partial<Record<ResearchReplayPhase, number>>;
};

export type ResumeBoundary = {
  evidenceDurableThroughCycleIndex: number;
  dbDurableThroughCycleIndex: number;
  safeResumeThroughCycleIndex: number;
  dbDurableThroughPhase: ResearchReplayPhase;
  evidenceChainDigest: string | null;
  evidenceTerminalState: StreamingEvidenceTerminalState;
};

export type ReplayResumeIdentity = {
  backtestRunId: string;
  datasetContentDigest: string;
  codeSha: string;
};

export type ResumableStateSnapshot = {
  schemaVersion: "htr-wp05-resumable-state/v1";
  canvasStateRef?: string;
  drawdownHwmState?: ReplayDrawdownHwmState;
};

const CHECKPOINT_FILENAME = "replay-checkpoint.json";
const RUN_CHAIN_FILENAME = "run-chain.json";

function digestCheckpointPayload(record: Omit<ReplayCheckpointRecord, "checkpointDigest">): string {
  return computePayloadDigest(record);
}

function parseCheckpoint(raw: unknown): ReplayCheckpointRecord {
  const record = raw as ReplayCheckpointRecord;
  if (record.schemaVersion !== REPLAY_CHECKPOINT_SCHEMA_VERSION) {
    throw new ReplayCheckpointError(
      "REPLAY_CHECKPOINT_CORRUPT",
      `unsupported checkpoint schema: ${String(record.schemaVersion)}`,
    );
  }
  const { checkpointDigest, ...withoutDigest } = record;
  const expected = digestCheckpointPayload(withoutDigest);
  if (expected !== checkpointDigest) {
    throw new ReplayCheckpointError(
      "REPLAY_CHECKPOINT_DIGEST_MISMATCH",
      "checkpoint digest mismatch",
    );
  }
  return record;
}

export function compareReplayResumeIdentity(
  expected: ReplayResumeIdentity,
  actual: ReplayResumeIdentity,
): void {
  if (
    expected.backtestRunId !== actual.backtestRunId ||
    expected.datasetContentDigest !== actual.datasetContentDigest ||
    expected.codeSha !== actual.codeSha
  ) {
    throw new ReplayCheckpointError(
      "REPLAY_RESUME_IDENTITY_MISMATCH",
      "replay resume identity mismatch",
    );
  }
}

export function resolveEvidenceFrontier(activePhaseRunDir: string): {
  evidenceDurableThroughCycleIndex: number;
  evidenceChainDigest: string | null;
  evidenceTerminalState: StreamingEvidenceTerminalState;
} {
  const reconstruction = reconstructStreamingEvidence(activePhaseRunDir);
  if (reconstruction.outcome === "QUARANTINED" || reconstruction.outcome === "EMPTY") {
    return {
      evidenceDurableThroughCycleIndex: -1,
      evidenceChainDigest: reconstruction.chainDigest,
      evidenceTerminalState: "STREAMING_EVIDENCE_FAILED",
    };
  }
  const evidenceTerminalState: StreamingEvidenceTerminalState =
    reconstruction.outcome === "RECOVERED_COMPLETE"
      ? "STREAMING_EVIDENCE_OK"
      : "STREAMING_EVIDENCE_SEALED_PARTIAL";
  return {
    evidenceDurableThroughCycleIndex: reconstruction.sealedThroughCycleIndex,
    evidenceChainDigest: reconstruction.chainDigest,
    evidenceTerminalState,
  };
}

export function resolveResumeBoundary(input: ResolveResumeBoundaryInput): ResumeBoundary {
  const dbPhase = input.dbFrontier.dbDurableThroughPhase;
  const dbDurableThroughCycleIndex = input.dbFrontier.lastCycleIndexOfDbDurablePhase;

  let evidenceDurableThroughCycleIndex = -1;
  let evidenceChainDigest: string | null = null;
  let evidenceTerminalState: StreamingEvidenceTerminalState = "STREAMING_EVIDENCE_FAILED";

  if (dbPhase !== "none" && input.dbDurablePhaseRunDir && existsSync(input.dbDurablePhaseRunDir)) {
    const evidence = resolveEvidenceFrontier(input.dbDurablePhaseRunDir);
    evidenceDurableThroughCycleIndex = evidence.evidenceDurableThroughCycleIndex;
    evidenceChainDigest = evidence.evidenceChainDigest;
    evidenceTerminalState = evidence.evidenceTerminalState;
  }

  const safeResumeThroughCycleIndex = Math.min(
    dbDurableThroughCycleIndex,
    dbPhase === "none" ? -1 : evidenceDurableThroughCycleIndex,
  );

  return {
    evidenceDurableThroughCycleIndex,
    dbDurableThroughCycleIndex,
    safeResumeThroughCycleIndex,
    dbDurableThroughPhase: dbPhase,
    evidenceChainDigest,
    evidenceTerminalState,
  };
}

export function serializeCheckpoint(
  record: Omit<ReplayCheckpointRecord, "checkpointDigest">,
): ReplayCheckpointRecord {
  const digest = digestCheckpointPayload(record);
  return { ...record, checkpointDigest: digest };
}

export function deserializeCheckpoint(raw: unknown): ReplayCheckpointRecord {
  return parseCheckpoint(raw);
}

export function writeReplayCheckpoint(runRootDir: string, record: ReplayCheckpointRecord): void {
  mkdirSync(runRootDir, { recursive: true });
  const { checkpointDigest: _ignored, ...withoutDigest } = record;
  const digest = digestCheckpointPayload(withoutDigest);
  const payload: ReplayCheckpointRecord = { ...record, checkpointDigest: digest };
  writeFileAtomic(join(runRootDir, CHECKPOINT_FILENAME), JSON.stringify(payload, null, 2));
}

export function readReplayCheckpoint(runRootDir: string): ReplayCheckpointRecord | null {
  const path = join(runRootDir, CHECKPOINT_FILENAME);
  if (!existsSync(path)) {
    return null;
  }
  return parseCheckpoint(JSON.parse(readFileSync(path, "utf8")) as unknown);
}

export function assertCheckpointExecutionState(
  record: ReplayCheckpointRecord,
  hasOpenHistoricalOrdersAtFrontier: boolean,
): void {
  if (!hasOpenHistoricalOrdersAtFrontier) {
    return;
  }
  if (!record.executionState) {
    throw new ReplayCheckpointError(
      "REPLAY_CHECKPOINT_CORRUPT",
      "checkpoint missing required executionState for open historical orders",
    );
  }
  if (
    record.executionState.executionModelSchemaVersion !==
    "waia.trader.historical-execution-model.v1"
  ) {
    throw new ReplayCheckpointError(
      "REPLAY_CHECKPOINT_CORRUPT",
      "unsupported execution model schema in checkpoint executionState",
    );
  }
}

export function writeReplayRunChainManifest(
  runRootDir: string,
  manifest: ReplayRunChainManifest,
): void {
  mkdirSync(runRootDir, { recursive: true });
  writeFileAtomic(join(runRootDir, RUN_CHAIN_FILENAME), JSON.stringify(manifest, null, 2));
}

export function readReplayRunChainManifest(runRootDir: string): ReplayRunChainManifest | null {
  const path = join(runRootDir, RUN_CHAIN_FILENAME);
  if (!existsSync(path)) {
    return null;
  }
  const manifest = JSON.parse(readFileSync(path, "utf8")) as ReplayRunChainManifest;
  if (manifest.schemaVersion !== REPLAY_RUN_CHAIN_MANIFEST_SCHEMA_VERSION) {
    throw new ReplayCheckpointError(
      "REPLAY_RUN_CHAIN_INVALID",
      `unsupported run-chain schema: ${String(manifest.schemaVersion)}`,
    );
  }
  return manifest;
}

export function computeRunChainComposedDigest(segmentChainDigests: readonly string[]): string {
  return computePayloadDigest(segmentChainDigests);
}

export function computeAuditLineageDigest(segments: readonly ReplayRunChainSegment[]): string {
  return computePayloadDigest(
    segments.map((segment) => ({
      runDir: segment.runDir,
      chainDigest: segment.chainDigest,
      role: segmentRole(segment),
      continuesFromChainDigest: segment.continuesFromChainDigest ?? null,
      continuesFromRunDir: segment.continuesFromRunDir ?? null,
      terminalState: segment.terminalState,
      sealedThroughCycleIndex: segment.sealedThroughCycleIndex,
    })),
  );
}

function readAuthoritativeSegmentProjections(runDir: string): ReplayCycleEvidenceProjection[] {
  if (!existsSync(runDir)) {
    return [];
  }
  const direct = [...new StreamingEvidenceReader(runDir).iterateProjections()];
  if (direct.length > 0) {
    return direct;
  }
  const evidenceRoot = join(runDir, "evidence");
  if (!existsSync(evidenceRoot)) {
    return direct;
  }
  const projections: ReplayCycleEvidenceProjection[] = [];
  const epochDirs = readdirSync(evidenceRoot)
    .filter((name) => name.startsWith("epoch-"))
    .sort((a, b) => Number(a.slice("epoch-".length)) - Number(b.slice("epoch-".length)));
  for (const epochDir of epochDirs) {
    const epochPath = join(evidenceRoot, epochDir);
    if (!statSync(epochPath).isDirectory()) continue;
    const generationDirs = readdirSync(epochPath)
      .filter((name) => name.startsWith("generation-"))
      .sort(
        (a, b) => Number(a.slice("generation-".length)) - Number(b.slice("generation-".length)),
      );
    for (const generationDir of generationDirs) {
      const segmentDir = join(epochPath, generationDir);
      if (!statSync(segmentDir).isDirectory()) continue;
      projections.push(...new StreamingEvidenceReader(segmentDir).iterateProjections());
    }
  }
  return projections;
}

export function buildReplayRunChainManifest(input: {
  backtestRunId: string;
  activePhase: ResearchReplayPhase;
  segments: ReplayRunChainSegment[];
  authoritativeSemanticDigest?: string;
}): ReplayRunChainManifest {
  const composedChainDigest = computeRunChainComposedDigest(
    input.segments.map((segment) => segment.chainDigest),
  );
  const auditLineageDigest = computeAuditLineageDigest(input.segments);
  let authoritativeSemanticDigest = input.authoritativeSemanticDigest;
  if (!authoritativeSemanticDigest) {
    const projections: ReplayCycleEvidenceProjection[] = [];
    for (const segment of input.segments) {
      if (segmentRole(segment) !== "authoritative") continue;
      projections.push(...readAuthoritativeSegmentProjections(segment.runDir));
    }
    authoritativeSemanticDigest = computeSemanticParityDigest(projections);
  }
  return {
    schemaVersion: REPLAY_RUN_CHAIN_MANIFEST_SCHEMA_VERSION,
    backtestRunId: input.backtestRunId,
    activePhase: input.activePhase,
    segments: input.segments,
    composedChainDigest,
    auditLineageDigest,
    authoritativeSemanticDigest,
  };
}

export function serializeResumableState(snapshot?: ResumableStateSnapshot): string {
  const body: ResumableStateSnapshot = snapshot ?? { schemaVersion: "htr-wp05-resumable-state/v1" };
  return canonicalJsonString(body);
}

export function restoreResumableState(serialized: string): ResumableStateSnapshot {
  return JSON.parse(serialized) as ResumableStateSnapshot;
}

export function emptyDbPhaseFrontier(): DbPhaseFrontier {
  return {
    dbDurableThroughPhase: "none",
    lastCycleIndexOfDbDurablePhase: -1,
    validationResultCommitted: false,
    walkForwardWindowCount: 0,
    blindResultCommitted: false,
  };
}

export function dbPhaseFrontierFromCommittedPhases(input: {
  validationResultCommitted: boolean;
  validationLastCycleIndex: number;
  walkForwardWindowCount: number;
  walkForwardLastCycleIndex: number;
  blindResultCommitted: boolean;
  blindLastCycleIndex: number;
}): DbPhaseFrontier {
  if (input.blindResultCommitted) {
    return {
      dbDurableThroughPhase: "blind",
      lastCycleIndexOfDbDurablePhase: input.blindLastCycleIndex,
      validationResultCommitted: true,
      walkForwardWindowCount: input.walkForwardWindowCount,
      blindResultCommitted: true,
    };
  }
  if (input.walkForwardWindowCount > 0) {
    return {
      dbDurableThroughPhase: `walk-forward:${input.walkForwardWindowCount - 1}`,
      lastCycleIndexOfDbDurablePhase: input.walkForwardLastCycleIndex,
      validationResultCommitted: input.validationResultCommitted,
      walkForwardWindowCount: input.walkForwardWindowCount,
      blindResultCommitted: false,
    };
  }
  if (input.validationResultCommitted) {
    return {
      dbDurableThroughPhase: "validation",
      lastCycleIndexOfDbDurablePhase: input.validationLastCycleIndex,
      validationResultCommitted: true,
      walkForwardWindowCount: 0,
      blindResultCommitted: false,
    };
  }
  return emptyDbPhaseFrontier();
}
