import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { buildReplayCycleEvidenceProjection } from "@/lib/trader/backtest/streaming-evidence/cycle-evidence-projection";
import {
  buildStreamingEvidenceManifest,
  computeStreamingEvidenceChainDigest,
} from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import {
  resolveEvidenceBatchCycles,
  STREAMING_EVIDENCE_SCHEMA_VERSION,
  StreamingEvidenceError,
  type ReplayCycleEvidenceProjection,
  type StreamingEvidenceChunkEnvelope,
  type StreamingEvidenceManifestRef,
  type StreamingEvidenceTerminalState,
} from "@/lib/trader/backtest/streaming-evidence/streaming-evidence.types";
import {
  StreamingRegimeTimelineWriter,
  type StreamingRegimeTimelineWriterHandle,
} from "@/lib/trader/backtest/streaming-evidence/streaming-regime-timeline";
import type { PaperCycleResult } from "@/lib/trader/paper/paper-cycle.types";

export type CreateStreamingEvidenceWriterInput = {
  runDir: string;
  runId: string;
  gitSha?: string | null;
  environment?: string;
  dbConnectionMode?: string | null;
};

export type StreamingEvidenceWriter = {
  onCycle(cycleIndex: number, result: PaperCycleResult): void;
  /**
   * High-water mark of the in-flight projection batch (buffered ReplayCycleEvidenceProjection
   * objects), NOT retained PaperCycleResult objects. Bounded by MAX_BATCH_CYCLES (=32) regardless
   * of total cycle count. STREAM_ONLY retains zero PaperCycleResult objects (see backtest-runner).
   */
  peakBufferedProjections(): number;
  sealComplete(expectedCycleCount: number): StreamingEvidenceManifestRef;
  sealPartial(expectedCycleCount: number, reason: string): StreamingEvidenceManifestRef;
};

function formatSeq(seq: number): string {
  return String(seq).padStart(6, "0");
}

/**
 * Serialize a chunk envelope once: payload JSON is embedded (not re-stringified), digests match
 * the historical `JSON.stringify(envelope)` / `computePayloadDigest` / `computeChunkDigest` bytes.
 */
export function serializeStreamingEvidenceChunkEnvelope(input: {
  seq: number;
  batch: readonly ReplayCycleEvidenceProjection[];
  prevChunkDigest: string | null;
}): { payloadDigest: string; chunkDigest: string; envelopeJson: string } {
  const payloadJson = JSON.stringify(input.batch);
  const payloadDigest = createHash("sha256").update(payloadJson, "utf8").digest("hex");
  const startInclusive = input.batch[0]!.cycleIndex;
  const endInclusive = input.batch[input.batch.length - 1]!.cycleIndex;
  const envelopeJsonWithoutDigest =
    `{"schemaVersion":${JSON.stringify(STREAMING_EVIDENCE_SCHEMA_VERSION)},` +
    `"seq":${input.seq},` +
    `"cycleIndexRange":{"startInclusive":${startInclusive},"endInclusive":${endInclusive}},` +
    `"payload":${payloadJson},` +
    `"payloadDigest":${JSON.stringify(payloadDigest)},` +
    `"prevChunkDigest":${JSON.stringify(input.prevChunkDigest)}}`;
  const chunkDigest = createHash("sha256").update(envelopeJsonWithoutDigest, "utf8").digest("hex");
  const envelopeJson = `${envelopeJsonWithoutDigest.slice(0, -1)},"chunkDigest":${JSON.stringify(chunkDigest)}}`;
  return { payloadDigest, chunkDigest, envelopeJson };
}

export function createStreamingEvidenceWriter(
  input: CreateStreamingEvidenceWriterInput,
): StreamingEvidenceWriter & { timelineWriter: StreamingRegimeTimelineWriterHandle } {
  const chunksDir = join(input.runDir, "chunks");
  mkdirSync(chunksDir, { recursive: true });

  const timelineWriter = new StreamingRegimeTimelineWriter(input.runDir);

  const batch: ReplayCycleEvidenceProjection[] = [];
  let nextSeq = 0;
  let lastChunkDigest: string | null = null;
  const chunkDigests: string[] = [];
  let sealedThroughCycleIndex = -1;
  let peakBuffered = 0;
  const batchLimit = resolveEvidenceBatchCycles();
  // Capture once: process.env reads on every cycle are avoidable hot-path tax.
  const skipRegimeTimeline = process.env.FHV_IDHPS_SKIP_REGIME_TIMELINE === "1";
  // First seal wins: a complete seal must never overwrite a prior partial seal, and a complete
  // seal must occur at most once (§7 invariant). Subsequent seals return the sealed ref idempotently.
  let sealedRef: StreamingEvidenceManifestRef | null = null;

  const flushBatch = (): void => {
    if (batch.length === 0) {
      return;
    }

    const endInclusive = batch[batch.length - 1]!.cycleIndex;
    const { payloadDigest, chunkDigest, envelopeJson } = serializeStreamingEvidenceChunkEnvelope({
      seq: nextSeq,
      batch,
      prevChunkDigest: lastChunkDigest,
    });

    const finalPath = join(chunksDir, `chunk-${formatSeq(nextSeq)}.json`);
    // Official-scale STREAM_ONLY uses a fresh runDir per launch; skip per-flush existsSync
    // (directory-stat tax grows with ~197k GS-10 chunks). Conflict check remains for resume/reuse.
    if (!skipRegimeTimeline && existsSync(finalPath)) {
      const existing = JSON.parse(
        readFileSync(finalPath, "utf8"),
      ) as StreamingEvidenceChunkEnvelope;
      if (existing.payloadDigest !== payloadDigest) {
        throw new StreamingEvidenceError(
          "STREAMING_EVIDENCE_SEQ_CONFLICT",
          `[streaming-evidence] seq ${nextSeq} conflict`,
        );
      }
    } else if (skipRegimeTimeline || !existsSync(finalPath)) {
      writeFileAtomic(finalPath, envelopeJson);
    }

    lastChunkDigest = chunkDigest;
    chunkDigests.push(chunkDigest);
    sealedThroughCycleIndex = endInclusive;
    nextSeq += 1;
    // Reuse the batch array (avoid reallocating the container each flush).
    batch.length = 0;
  };

  const seal = (
    terminalState: StreamingEvidenceTerminalState,
    expectedCycleCount: number,
    reason: string | null,
  ): StreamingEvidenceManifestRef => {
    if (sealedRef) {
      return sealedRef;
    }
    flushBatch();
    timelineWriter.flush();

    const manifest = buildStreamingEvidenceManifest({
      runId: input.runId,
      terminalState,
      chainDigest: computeStreamingEvidenceChainDigest(chunkDigests),
      expectedCycleCount,
      chunkCount: chunkDigests.length,
      sealedThroughCycleIndex:
        sealedThroughCycleIndex >= 0 ? sealedThroughCycleIndex : expectedCycleCount === 0 ? -1 : -1,
      timelineChunkCount: timelineWriter.chunkCount(),
      gitSha: input.gitSha ?? null,
      environment: input.environment,
      dbConnectionMode: input.dbConnectionMode ?? null,
      sealReason: reason,
    });

    const manifestName =
      terminalState === "STREAMING_EVIDENCE_SEALED_PARTIAL"
        ? "manifest.partial.json"
        : "manifest.json";
    writeFileAtomic(join(input.runDir, manifestName), JSON.stringify(manifest));

    sealedRef = { runDir: input.runDir, manifest };
    return sealedRef;
  };

  return {
    timelineWriter,
    onCycle(cycleIndex: number, result: PaperCycleResult): void {
      const projection = buildReplayCycleEvidenceProjection(cycleIndex, result);
      batch.push(projection);
      // IDHPS STREAM_ONLY official scale: projections are authority; skip regime timeline I/O.
      if (!skipRegimeTimeline) {
        timelineWriter.append(cycleIndex, result);
      }
      peakBuffered = Math.max(peakBuffered, batch.length);
      if (batch.length >= batchLimit) {
        flushBatch();
      }
    },
    peakBufferedProjections(): number {
      return Math.max(peakBuffered, batch.length);
    },
    sealComplete(expectedCycleCount: number): StreamingEvidenceManifestRef {
      return seal("STREAMING_EVIDENCE_OK", expectedCycleCount, null);
    },
    sealPartial(expectedCycleCount: number, reason: string): StreamingEvidenceManifestRef {
      return seal("STREAMING_EVIDENCE_SEALED_PARTIAL", expectedCycleCount, reason);
    },
  };
}
