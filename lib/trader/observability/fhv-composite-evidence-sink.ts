import { existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  createFhvTraceEvidenceSink,
  createStreamingEvidenceSink,
  type CreateFhvTraceEvidenceSinkInput,
  type FhvTraceReplayEvidenceSink,
  type ReplayEvidenceSink,
} from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-sink";
import type { StreamingEvidenceManifestRef } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence.types";
import type { PaperCycleResult } from "@/lib/trader/paper/paper-cycle.types";

export type CreateFhvCompositeEvidenceSinkInput = Readonly<
  {
    runDir: string;
    runId: string;
    gitSha: string;
    environment: string;
    epochId: number;
    generation: number;
    /** When false, skip fhv-trace dual-write (STREAM_ONLY official scale hot path). */
    enableTraceEvidence?: boolean;
  } & Omit<CreateFhvTraceEvidenceSinkInput, "runLogRoot"> & {
      runLogRoot: string;
    }
>;

export type FhvCompositeEvidenceSink = ReplayEvidenceSink & {
  readonly currentSegmentDir: string;
  commitEpochSegment(expectedCycleCount: number): Promise<StreamingEvidenceManifestRef>;
  beginNextEpochSegment(input: { epochId: number; generation: number }): void;
  getTraceSink(): FhvTraceReplayEvidenceSink;
  getSegmentManifests(): readonly StreamingEvidenceManifestRef[];
  promoteSealedEpochEvidence(input: { epochId: number; generation: number }): string;
};

export class FhvEvidenceLifecycleError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvEvidenceLifecycleError";
  }
}

/** Canonical sealed evidence directory. Never used for an active writer. */
export function resolveFhvEpochEvidenceSegmentDir(
  runDir: string,
  epochId: number,
  generation: number,
): string {
  return join(runDir, "evidence", `epoch-${epochId}`, `generation-${generation}`);
}

/** Active epoch writers live here for their entire lifetime. Never relocated while active. */
export function resolveFhvSpeculativeEpochEvidenceSegmentDir(
  runDir: string,
  epochId: number,
  generation: number,
): string {
  return join(runDir, "evidence", ".speculative", `epoch-${epochId}`, `generation-${generation}`);
}

/**
 * Promote a sealed, inactive speculative directory to the canonical path.
 * Must not be called while the writer is still active.
 */
export function promoteSealedFhvEpochEvidenceDir(input: {
  runDir: string;
  epochId: number;
  generation: number;
}): string {
  const speculative = resolveFhvSpeculativeEpochEvidenceSegmentDir(
    input.runDir,
    input.epochId,
    input.generation,
  );
  const canonical = resolveFhvEpochEvidenceSegmentDir(
    input.runDir,
    input.epochId,
    input.generation,
  );
  if (!existsSync(speculative)) {
    throw new FhvEvidenceLifecycleError(
      "FHV_EVIDENCE_PROMOTION_SOURCE_MISSING",
      `sealed speculative evidence missing: ${speculative}`,
    );
  }
  if (existsSync(canonical)) {
    throw new FhvEvidenceLifecycleError(
      "FHV_EVIDENCE_PROMOTION_TARGET_EXISTS",
      `canonical evidence already exists: ${canonical}`,
    );
  }
  mkdirSync(dirname(canonical), { recursive: true });
  renameSync(speculative, canonical);
  return canonical;
}

export function createFhvCompositeEvidenceSink(
  input: CreateFhvCompositeEvidenceSinkInput,
): FhvCompositeEvidenceSink {
  const segmentManifests: StreamingEvidenceManifestRef[] = [];
  const sealedEpochs = new Set<string>();
  let activeEpochId = input.epochId;
  let activeGeneration = input.generation;
  let segmentDir = resolveFhvSpeculativeEpochEvidenceSegmentDir(
    input.runDir,
    input.epochId,
    input.generation,
  );

  const enableTraceEvidence = input.enableTraceEvidence !== false;
  const traceSink = enableTraceEvidence
    ? createFhvTraceEvidenceSink({
        runLogRoot: input.runLogRoot,
        organizationId: input.organizationId,
        accountKey: input.accountKey,
        runId: input.runId,
        resumeSeq: input.resumeSeq,
        provenance: input.provenance,
        getFinalizeContext: input.getFinalizeContext,
      })
    : null;

  let streamingSink = createStreamingEvidenceSink({
    runDir: segmentDir,
    runId: input.runId,
    gitSha: input.gitSha,
    environment: input.environment,
  });

  const epochKey = (epochId: number, generation: number): string => `${epochId}:${generation}`;

  const forwardOnCycle = (cycleIndex: number, result: PaperCycleResult): void => {
    streamingSink.onCycle(cycleIndex, result);
    traceSink?.onCycle(cycleIndex, result);
  };

  return {
    get currentSegmentDir() {
      return segmentDir;
    },
    onCycle(cycleIndex, result) {
      forwardOnCycle(cycleIndex, result);
    },
    async sealComplete(expectedCycleCount) {
      const streamingRef = await streamingSink.sealComplete(expectedCycleCount);
      if (traceSink) {
        const traceRef = await traceSink.sealComplete!(expectedCycleCount);
        return streamingRef.runDir ? streamingRef : traceRef;
      }
      return streamingRef;
    },
    async sealPartial(expectedCycleCount, reason) {
      const streamingRef = await streamingSink.sealPartial(expectedCycleCount, reason);
      if (traceSink) {
        await traceSink.sealPartial!(expectedCycleCount, reason);
      }
      return streamingRef;
    },
    peakBufferedProjections() {
      return streamingSink.peakBufferedProjections();
    },
    async commitEpochSegment(expectedCycleCount) {
      const ref = await streamingSink.sealComplete(expectedCycleCount);
      sealedEpochs.add(epochKey(activeEpochId, activeGeneration));
      segmentManifests.push(ref);
      return ref;
    },
    beginNextEpochSegment(next) {
      activeEpochId = next.epochId;
      activeGeneration = next.generation;
      segmentDir = resolveFhvSpeculativeEpochEvidenceSegmentDir(
        input.runDir,
        next.epochId,
        next.generation,
      );
      streamingSink = createStreamingEvidenceSink({
        runDir: segmentDir,
        runId: input.runId,
        gitSha: input.gitSha,
        environment: input.environment,
      });
    },
    promoteSealedEpochEvidence(next) {
      const key = epochKey(next.epochId, next.generation);
      const isActiveUnsealed =
        next.epochId === activeEpochId &&
        next.generation === activeGeneration &&
        !sealedEpochs.has(key);
      if (isActiveUnsealed) {
        throw new FhvEvidenceLifecycleError(
          "FHV_EVIDENCE_ACTIVE_WRITER_RELOCATE_FORBIDDEN",
          `refusing to relocate active evidence writer epoch=${next.epochId}`,
        );
      }
      if (!sealedEpochs.has(key)) {
        throw new FhvEvidenceLifecycleError(
          "FHV_EVIDENCE_PROMOTION_BEFORE_SEAL",
          `refusing to promote unsealed evidence epoch=${next.epochId}`,
        );
      }
      const speculative = resolveFhvSpeculativeEpochEvidenceSegmentDir(
        input.runDir,
        next.epochId,
        next.generation,
      );
      const canonical = promoteSealedFhvEpochEvidenceDir({
        runDir: input.runDir,
        epochId: next.epochId,
        generation: next.generation,
      });
      for (let index = 0; index < segmentManifests.length; index += 1) {
        const ref = segmentManifests[index];
        if (ref?.runDir === speculative) {
          segmentManifests[index] = { ...ref, runDir: canonical };
        }
      }
      sealedEpochs.delete(key);
      return canonical;
    },
    getTraceSink() {
      if (!traceSink) {
        throw new Error("BLOCKED_BY_H_ARCH_1_TRACE_EVIDENCE_DISABLED");
      }
      return traceSink;
    },
    getSegmentManifests() {
      return segmentManifests;
    },
  };
}
