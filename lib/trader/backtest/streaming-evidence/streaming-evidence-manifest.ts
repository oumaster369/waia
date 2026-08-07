import { createHash } from "node:crypto";

import type {
  StreamingEvidenceChunkEnvelope,
  StreamingEvidenceManifest,
  StreamingEvidenceTerminalState,
} from "@/lib/trader/backtest/streaming-evidence/streaming-evidence.types";
import { EVIDENCE_MANIFEST_SCHEMA_VERSION } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence.types";

export function computeChunkDigest(
  envelope: Omit<StreamingEvidenceChunkEnvelope, "chunkDigest">,
): string {
  return createHash("sha256").update(JSON.stringify(envelope), "utf8").digest("hex");
}

export function computeStreamingEvidenceChainDigest(chunkDigests: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(chunkDigests), "utf8").digest("hex");
}

export function computePayloadDigest(payload: unknown): string {
  // Hot-path digest: projections are built with stable key insertion order.
  // Avoid canonicalJsonString deep key-sort (IDHPS evidence budget).
  return createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
}

export type BuildStreamingEvidenceManifestInput = {
  runId: string;
  terminalState: StreamingEvidenceTerminalState;
  chainDigest: string;
  expectedCycleCount: number;
  chunkCount: number;
  sealedThroughCycleIndex: number;
  timelineChunkCount: number;
  gitSha?: string | null;
  environment?: string;
  dbConnectionMode?: string | null;
  sealReason?: string | null;
  sealedAt?: string;
};

export function buildStreamingEvidenceManifest(
  input: BuildStreamingEvidenceManifestInput,
): StreamingEvidenceManifest {
  return {
    schemaVersion: EVIDENCE_MANIFEST_SCHEMA_VERSION,
    runId: input.runId,
    terminalState: input.terminalState,
    chainDigest: input.chainDigest,
    expectedCycleCount: input.expectedCycleCount,
    chunkCount: input.chunkCount,
    sealedThroughCycleIndex: input.sealedThroughCycleIndex,
    timelineChunkCount: input.timelineChunkCount,
    provenance: {
      gitSha: input.gitSha ?? null,
      environment: input.environment ?? "local",
      dbConnectionMode: input.dbConnectionMode ?? null,
      sealedAt: input.sealedAt ?? new Date().toISOString(),
      sealReason: input.sealReason ?? null,
    },
  };
}
