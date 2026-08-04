import type { Regime } from "@/lib/trader/intelligence/types";
import type { PaperCycleSkipReason } from "@/lib/trader/paper/paper-cycle.types";

export const STREAMING_EVIDENCE_SCHEMA_VERSION = "htr-wp04-streaming-evidence/v1" as const;
export const CYCLE_PROJECTION_SCHEMA_VERSION = "htr-wp04-cycle-projection/v1" as const;
export const EVIDENCE_MANIFEST_SCHEMA_VERSION = "htr-wp04-evidence-manifest/v1" as const;
export const REGIME_TIMELINE_SCHEMA_VERSION = "htr-wp04-regime-timeline/v1" as const;

/** Evidence chunk flush threshold — bounded memory (D11B / unit soak contract). */
export const MAX_BATCH_CYCLES = 32;

/**
 * Hot-path flush size. Defaults to {@link MAX_BATCH_CYCLES}; official-scale CI may raise via
 * `FHV_IDHPS_EVIDENCE_BATCH_CYCLES` (peak buffer still reported via peakBufferedProjections).
 */
export function resolveEvidenceBatchCycles(): number {
  const raw = process.env.FHV_IDHPS_EVIDENCE_BATCH_CYCLES;
  if (raw == null || raw === "") {
    return MAX_BATCH_CYCLES;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < MAX_BATCH_CYCLES) {
    return MAX_BATCH_CYCLES;
  }
  return Math.min(Math.floor(parsed), 1024);
}

export type ReplayRetentionMode = "FULL" | "STREAM_ONLY";

export type StreamingEvidenceTerminalState =
  | "STREAMING_EVIDENCE_OK"
  | "STREAMING_EVIDENCE_SEALED_PARTIAL"
  | "STREAMING_EVIDENCE_FAILED";

export type ReconstructionOutcome =
  | "RECOVERED_COMPLETE"
  | "RECOVERED_PARTIAL"
  | "QUARANTINED"
  | "EMPTY";

export type StreamingEvidenceErrorCode =
  | "STREAMING_EVIDENCE_SEQ_CONFLICT"
  | "STREAMING_EVIDENCE_CHECKSUM_MISMATCH"
  | "STREAMING_EVIDENCE_CHAIN_BREAK"
  | "STREAMING_EVIDENCE_ATOMIC_WRITE_FAILED"
  | "STREAMING_EVIDENCE_QUARANTINED"
  | "WP04_STREAMING_INCOMPATIBLE_ANALYTICS_HOOK";

export type ReplayCycleStrategyExecutionProjection = {
  signalId: string;
  side: string | null;
  submitBlocked: boolean;
  skipReason: PaperCycleSkipReason | null;
  executionStatus: string | null;
  orderState: string | null;
  orderId: string | null;
};

export type ReplayCycleGuardianProjection = {
  evaluationCount: number;
  exitIntentCount: number;
  guardianExecutionCount: number;
};

export type ReplayCycleEvidenceProjection = {
  schemaVersion: typeof CYCLE_PROJECTION_SCHEMA_VERSION;
  cycleIndex: number;
  evaluatedAtMs: number;
  regime: Regime;
  skipReason: PaperCycleSkipReason | null;
  strategyExecutions: ReplayCycleStrategyExecutionProjection[];
  guardian: ReplayCycleGuardianProjection | null;
  msv: Record<string, unknown>;
  /** Compact M9 export payload captured before the in-memory cycle is released. */
  m9Trace: Record<string, unknown> | null;
};

export type StreamingEvidenceChunkEnvelope = {
  schemaVersion: typeof STREAMING_EVIDENCE_SCHEMA_VERSION;
  seq: number;
  cycleIndexRange: { startInclusive: number; endInclusive: number };
  payload: ReplayCycleEvidenceProjection[];
  payloadDigest: string;
  prevChunkDigest: string | null;
  chunkDigest: string;
};

export type RegimeTimelineEntry = {
  evaluatedAtMs: number;
  regime: Regime;
};

export type RegimeTimelineChunkEnvelope = {
  schemaVersion: typeof REGIME_TIMELINE_SCHEMA_VERSION;
  seq: number;
  entries: RegimeTimelineEntry[];
  payloadDigest: string;
  chunkDigest: string;
};

export type StreamingEvidenceManifest = {
  schemaVersion: typeof EVIDENCE_MANIFEST_SCHEMA_VERSION;
  runId: string;
  terminalState: StreamingEvidenceTerminalState;
  chainDigest: string;
  expectedCycleCount: number;
  chunkCount: number;
  sealedThroughCycleIndex: number;
  timelineChunkCount: number;
  provenance: {
    gitSha: string | null;
    environment: string;
    dbConnectionMode: string | null;
    sealedAt: string;
    sealReason: string | null;
  };
};

export type StreamingEvidenceManifestRef = {
  runDir: string;
  manifest: StreamingEvidenceManifest;
};

export class StreamingEvidenceError extends Error {
  readonly code: StreamingEvidenceErrorCode;

  constructor(code: StreamingEvidenceErrorCode, message: string) {
    super(message);
    this.name = "StreamingEvidenceError";
    this.code = code;
  }
}
