import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { buildReplayCycleEvidenceProjection } from "@/lib/trader/backtest/streaming-evidence/cycle-evidence-projection";
import {
  buildStreamingEvidenceManifest,
  computeChunkDigest,
  computePayloadDigest,
  computeStreamingEvidenceChainDigest,
} from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import {
  resolveEvidenceBatchCycles,
  STREAMING_EVIDENCE_SCHEMA_VERSION,
  StreamingEvidenceError,
  type ReplayCycleEvidenceProjection,
  type StreamingEvidenceChunkEnvelope,
  type StreamingEvidenceManifest,
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

function writeChunkFile(chunksDir: string, envelope: StreamingEvidenceChunkEnvelope): void {
  writeFileAtomic(
    join(chunksDir, `chunk-${formatSeq(envelope.seq)}.json`),
    JSON.stringify(envelope),
  );
}

export function createStreamingEvidenceWriter(
  input: CreateStreamingEvidenceWriterInput,
): StreamingEvidenceWriter & { timelineWriter: StreamingRegimeTimelineWriterHandle } {
  const chunksDir = join(input.runDir, "chunks");
  mkdirSync(chunksDir, { recursive: true });

  const timelineWriter = new StreamingRegimeTimelineWriter(input.runDir);

  let batch: ReplayCycleEvidenceProjection[] = [];
  let nextSeq = 0;
  let lastChunkDigest: string | null = null;
  const chunkDigests: string[] = [];
  let sealedThroughCycleIndex = -1;
  let peakBuffered = 0;
  const batchLimit = resolveEvidenceBatchCycles();
  // First seal wins: a complete seal must never overwrite a prior partial seal, and a complete
  // seal must occur at most once (§7 invariant). Subsequent seals return the sealed ref idempotently.
  let sealedRef: StreamingEvidenceManifestRef | null = null;

  const flushBatch = (): void => {
    if (batch.length === 0) {
      return;
    }

    const payloadDigest = computePayloadDigest(batch);
    const envelopeWithoutDigest: Omit<StreamingEvidenceChunkEnvelope, "chunkDigest"> = {
      schemaVersion: STREAMING_EVIDENCE_SCHEMA_VERSION,
      seq: nextSeq,
      cycleIndexRange: {
        startInclusive: batch[0]!.cycleIndex,
        endInclusive: batch.at(-1)!.cycleIndex,
      },
      payload: batch,
      payloadDigest,
      prevChunkDigest: lastChunkDigest,
    };
    const chunkDigest = computeChunkDigest(envelopeWithoutDigest);
    const envelope: StreamingEvidenceChunkEnvelope = {
      ...envelopeWithoutDigest,
      chunkDigest,
    };

    const finalPath = join(chunksDir, `chunk-${formatSeq(nextSeq)}.json`);
    if (existsSync(finalPath)) {
      const existing = JSON.parse(
        readFileSync(finalPath, "utf8"),
      ) as StreamingEvidenceChunkEnvelope;
      if (existing.payloadDigest !== payloadDigest) {
        throw new StreamingEvidenceError(
          "STREAMING_EVIDENCE_SEQ_CONFLICT",
          `[streaming-evidence] seq ${nextSeq} conflict`,
        );
      }
    } else {
      writeChunkFile(chunksDir, envelope);
    }

    lastChunkDigest = chunkDigest;
    chunkDigests.push(chunkDigest);
    sealedThroughCycleIndex = batch.at(-1)!.cycleIndex;
    nextSeq += 1;
    batch = [];
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
      if (process.env.FHV_IDHPS_SKIP_REGIME_TIMELINE !== "1") {
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
