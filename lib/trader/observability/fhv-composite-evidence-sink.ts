import { join } from "node:path";

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
};

/** Epoch-scoped streaming projection evidence directory (segment-local chunk seq starts at 0). */
export function resolveFhvEpochEvidenceSegmentDir(
  runDir: string,
  epochId: number,
  generation: number,
): string {
  return join(runDir, "evidence", `epoch-${epochId}`, `generation-${generation}`);
}

export function createFhvCompositeEvidenceSink(
  input: CreateFhvCompositeEvidenceSinkInput,
): FhvCompositeEvidenceSink {
  const segmentManifests: StreamingEvidenceManifestRef[] = [];
  let segmentDir = resolveFhvEpochEvidenceSegmentDir(input.runDir, input.epochId, input.generation);

  const traceSink = createFhvTraceEvidenceSink({
    runLogRoot: input.runLogRoot,
    organizationId: input.organizationId,
    accountKey: input.accountKey,
    runId: input.runId,
    resumeSeq: input.resumeSeq,
    provenance: input.provenance,
    getFinalizeContext: input.getFinalizeContext,
  });

  let streamingSink = createStreamingEvidenceSink({
    runDir: segmentDir,
    runId: input.runId,
    gitSha: input.gitSha,
    environment: input.environment,
  });

  const forwardOnCycle = (cycleIndex: number, result: PaperCycleResult): void => {
    streamingSink.onCycle(cycleIndex, result);
    traceSink.onCycle(cycleIndex, result);
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
      const traceRef = await traceSink.sealComplete!(expectedCycleCount);
      return streamingRef.runDir ? streamingRef : traceRef;
    },
    async sealPartial(expectedCycleCount, reason) {
      const streamingRef = await streamingSink.sealPartial(expectedCycleCount, reason);
      await traceSink.sealPartial!(expectedCycleCount, reason);
      return streamingRef;
    },
    peakBufferedProjections() {
      return streamingSink.peakBufferedProjections();
    },
    async commitEpochSegment(expectedCycleCount) {
      const ref = await streamingSink.sealComplete(expectedCycleCount);
      segmentManifests.push(ref);
      return ref;
    },
    beginNextEpochSegment(next) {
      segmentDir = resolveFhvEpochEvidenceSegmentDir(input.runDir, next.epochId, next.generation);
      streamingSink = createStreamingEvidenceSink({
        runDir: segmentDir,
        runId: input.runId,
        gitSha: input.gitSha,
        environment: input.environment,
      });
    },
    getTraceSink() {
      return traceSink;
    },
    getSegmentManifests() {
      return segmentManifests;
    },
  };
}
