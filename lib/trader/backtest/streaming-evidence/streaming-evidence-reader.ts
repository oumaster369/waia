import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { computeChunkDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import {
  StreamingEvidenceError,
  type ReplayCycleEvidenceProjection,
  type StreamingEvidenceChunkEnvelope,
  type StreamingEvidenceManifest,
} from "@/lib/trader/backtest/streaming-evidence/streaming-evidence.types";
import type { PaperCycleResult } from "@/lib/trader/paper/paper-cycle.types";

function formatSeq(seq: number): string {
  return String(seq).padStart(6, "0");
}

function listChunkFiles(chunksDir: string): string[] {
  if (!existsSync(chunksDir)) {
    return [];
  }
  return readdirSync(chunksDir)
    .filter((name) => name.startsWith("chunk-") && name.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b));
}

function verifyChunk(envelope: StreamingEvidenceChunkEnvelope): void {
  const withoutDigest: Omit<StreamingEvidenceChunkEnvelope, "chunkDigest"> = {
    schemaVersion: envelope.schemaVersion,
    seq: envelope.seq,
    cycleIndexRange: envelope.cycleIndexRange,
    payload: envelope.payload,
    payloadDigest: envelope.payloadDigest,
    prevChunkDigest: envelope.prevChunkDigest,
  };
  const expected = computeChunkDigest(withoutDigest);
  if (expected !== envelope.chunkDigest) {
    throw new StreamingEvidenceError(
      "STREAMING_EVIDENCE_CHECKSUM_MISMATCH",
      `[streaming-evidence] chunk ${envelope.seq} checksum mismatch`,
    );
  }
}

export class StreamingEvidenceReader {
  private readonly runDir: string;

  constructor(runDir: string) {
    this.runDir = runDir;
  }

  get runDirectory(): string {
    return this.runDir;
  }

  loadManifest(): StreamingEvidenceManifest | null {
    const completePath = join(this.runDir, "manifest.json");
    const partialPath = join(this.runDir, "manifest.partial.json");
    if (existsSync(completePath)) {
      return JSON.parse(readFileSync(completePath, "utf8")) as StreamingEvidenceManifest;
    }
    if (existsSync(partialPath)) {
      return JSON.parse(readFileSync(partialPath, "utf8")) as StreamingEvidenceManifest;
    }
    return null;
  }

  *iterateProjections(): Generator<ReplayCycleEvidenceProjection> {
    const chunksDir = join(this.runDir, "chunks");
    for (const file of listChunkFiles(chunksDir)) {
      const envelope = JSON.parse(
        readFileSync(join(chunksDir, file), "utf8"),
      ) as StreamingEvidenceChunkEnvelope;
      verifyChunk(envelope);
      for (const projection of envelope.payload) {
        yield projection;
      }
    }
  }

  *iteratePaperCycleResults(): Generator<PaperCycleResult> {
    for (const projection of this.iterateProjections()) {
      yield projectionToPaperCycleResult(projection);
    }
  }

  projectionCount(): number {
    let count = 0;
    for (const _ of this.iterateProjections()) {
      count += 1;
    }
    return count;
  }
}

export function projectionToPaperCycleResult(
  projection: ReplayCycleEvidenceProjection,
): PaperCycleResult {
  const msvPayload = projection.msv as PaperCycleResult["evaluation"]["msv"];
  const trace = projection.m9Trace as {
    evaluatedAt?: string;
    fused?: PaperCycleResult["evaluation"]["fusedContext"];
    understanding?: PaperCycleResult["evaluation"]["understanding"];
    decisionChain?: PaperCycleResult["evaluation"]["decisionChain"];
    signal?: PaperCycleResult["evaluation"]["signal"];
    guardian?: PaperCycleResult["guardian"];
    guardianExecutions?: PaperCycleResult["guardianExecutions"];
  } | null;

  const signal = trace?.signal ?? {
    strategyId: projection.strategyExecutions[0]?.signalId ?? "unknown",
    outcome: "skipped" as const,
    side: projection.strategyExecutions[0]
      ?.side as PaperCycleResult["evaluation"]["signal"]["side"],
  };

  return {
    evaluation: {
      features: {
        evaluatedAt: trace?.evaluatedAt ?? new Date(projection.evaluatedAtMs).toISOString(),
        featureSetId: "streaming-projection",
        values: {},
      },
      msv: msvPayload,
      signal,
      fusedContext: trace?.fused,
      understanding: trace?.understanding,
      decisionChain: trace?.decisionChain,
    },
    strategyExecutions: projection.strategyExecutions.map((entry) => ({
      signal: {
        strategyId: entry.signalId,
        outcome: entry.executionStatus === "submitted" ? "submitted" : "skipped",
        side: entry.side as PaperCycleResult["strategyExecutions"][number]["signal"]["side"],
      },
      submitBlocked: entry.submitBlocked,
      skipReason: entry.skipReason ?? undefined,
      execution: null,
      reconciliation: null,
    })),
    submitBlocked: projection.strategyExecutions.every((entry) => entry.submitBlocked),
    skipReason: projection.skipReason ?? undefined,
    execution: null,
    reconciliation: null,
    guardian: trace?.guardian,
    guardianExecutions: trace?.guardianExecutions,
  } as unknown as PaperCycleResult;
}

export function cycleResultsFromStreamingReader(
  reader: StreamingEvidenceReader,
): PaperCycleResult[] {
  return [...reader.iteratePaperCycleResults()];
}
