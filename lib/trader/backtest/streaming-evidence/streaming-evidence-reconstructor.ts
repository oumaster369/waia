import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import {
  computeChunkDigest,
  computeStreamingEvidenceChainDigest,
} from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import {
  StreamingEvidenceError,
  type ReconstructionOutcome,
  type StreamingEvidenceChunkEnvelope,
  type StreamingEvidenceManifest,
} from "@/lib/trader/backtest/streaming-evidence/streaming-evidence.types";

export type ReconstructionResult = {
  outcome: ReconstructionOutcome;
  terminalState: StreamingEvidenceManifest["terminalState"] | "STREAMING_EVIDENCE_FAILED";
  validChunkCount: number;
  sealedThroughCycleIndex: number;
  chainDigest: string | null;
  orphanTempDeleted: number;
  quarantinedSeqs: number[];
  reportPath: string;
};

function isTempFile(name: string): boolean {
  return name.includes(".tmp-");
}

function parseChunkSeq(name: string): number | null {
  const match = /^chunk-(\d{6})\.json$/.exec(name);
  if (!match) {
    return null;
  }
  return Number.parseInt(match[1]!, 10);
}

export function reconstructStreamingEvidence(runDir: string): ReconstructionResult {
  const chunksDir = join(runDir, "chunks");
  const quarantineDir = join(runDir, "quarantine");
  mkdirSync(chunksDir, { recursive: true });

  let orphanTempDeleted = 0;
  const orphanReport: Array<{ path: string; action: "deleted" }> = [];

  if (existsSync(chunksDir)) {
    for (const name of readdirSync(chunksDir)) {
      const fullPath = join(chunksDir, name);
      if (!isTempFile(name)) {
        continue;
      }
      const finalName = name.split(".tmp-")[0]!;
      const finalPath = join(chunksDir, finalName);
      unlinkSync(fullPath);
      orphanTempDeleted += 1;
      orphanReport.push({ path: name, action: "deleted" });
    }
  }

  if (orphanReport.length > 0) {
    writeFileSync(
      join(runDir, "orphan-temp-report.json"),
      JSON.stringify({ schemaVersion: "htr-wp04-orphan-temp/v1", entries: orphanReport }, null, 2),
    );
  }

  const chunkFiles = existsSync(chunksDir)
    ? readdirSync(chunksDir)
        .filter((name) => name.startsWith("chunk-") && name.endsWith(".json") && !isTempFile(name))
        .sort((a, b) => a.localeCompare(b))
    : [];

  const validChunks: StreamingEvidenceChunkEnvelope[] = [];
  const quarantinedSeqs: number[] = [];
  let prevDigest: string | null = null;

  for (const file of chunkFiles) {
    const seq = parseChunkSeq(file);
    if (seq === null) {
      continue;
    }
    const envelope = JSON.parse(
      readFileSync(join(chunksDir, file), "utf8"),
    ) as StreamingEvidenceChunkEnvelope;

    try {
      const withoutDigest: Omit<StreamingEvidenceChunkEnvelope, "chunkDigest"> = {
        schemaVersion: envelope.schemaVersion,
        seq: envelope.seq,
        cycleIndexRange: envelope.cycleIndexRange,
        payload: envelope.payload,
        payloadDigest: envelope.payloadDigest,
        prevChunkDigest: envelope.prevChunkDigest,
      };
      if (computeChunkDigest(withoutDigest) !== envelope.chunkDigest) {
        throw new StreamingEvidenceError("STREAMING_EVIDENCE_CHECKSUM_MISMATCH", `chunk ${seq}`);
      }
      if (envelope.prevChunkDigest !== prevDigest) {
        throw new StreamingEvidenceError(
          "STREAMING_EVIDENCE_CHAIN_BREAK",
          `chunk ${seq} chain break`,
        );
      }
      if (validChunks.length > 0 && envelope.seq !== validChunks.at(-1)!.seq + 1) {
        throw new StreamingEvidenceError(
          "STREAMING_EVIDENCE_CHAIN_BREAK",
          `chunk seq gap at ${seq}`,
        );
      }
      validChunks.push(envelope);
      prevDigest = envelope.chunkDigest;
    } catch {
      mkdirSync(quarantineDir, { recursive: true });
      for (const remaining of chunkFiles.slice(chunkFiles.indexOf(file))) {
        const remainingSeq = parseChunkSeq(remaining);
        if (remainingSeq === null) {
          continue;
        }
        renameSync(join(chunksDir, remaining), join(quarantineDir, remaining));
        quarantinedSeqs.push(remainingSeq);
      }
      writeFileSync(
        join(runDir, "corruption-report.json"),
        JSON.stringify(
          {
            schemaVersion: "htr-wp04-corruption/v1",
            firstBadSeq: seq,
            reason: "checksum_or_chain_break",
            quarantinedSeqs,
          },
          null,
          2,
        ),
      );
      break;
    }
  }

  const chainDigest =
    validChunks.length > 0
      ? computeStreamingEvidenceChainDigest(validChunks.map((chunk) => chunk.chunkDigest))
      : null;

  const manifestPath = join(runDir, "manifest.json");
  const partialPath = join(runDir, "manifest.partial.json");
  let manifest: StreamingEvidenceManifest | null = null;
  if (existsSync(manifestPath)) {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as StreamingEvidenceManifest;
  } else if (existsSync(partialPath)) {
    manifest = JSON.parse(readFileSync(partialPath, "utf8")) as StreamingEvidenceManifest;
  }

  const sealedThroughCycleIndex =
    validChunks.length > 0 ? validChunks.at(-1)!.cycleIndexRange.endInclusive : -1;

  let outcome: ReconstructionOutcome = "EMPTY";
  let terminalState: ReconstructionResult["terminalState"] = "STREAMING_EVIDENCE_FAILED";

  if (validChunks.length === 0 && quarantinedSeqs.length === 0) {
    outcome = "EMPTY";
    terminalState = "STREAMING_EVIDENCE_FAILED";
  } else if (quarantinedSeqs.length > 0) {
    outcome = "QUARANTINED";
    terminalState = "STREAMING_EVIDENCE_FAILED";
  } else if (
    manifest &&
    manifest.terminalState === "STREAMING_EVIDENCE_OK" &&
    manifest.chainDigest === chainDigest
  ) {
    outcome = "RECOVERED_COMPLETE";
    terminalState = "STREAMING_EVIDENCE_OK";
  } else {
    outcome = "RECOVERED_PARTIAL";
    terminalState = manifest?.terminalState ?? "STREAMING_EVIDENCE_SEALED_PARTIAL";
  }

  const reportPath = join(runDir, "reconstruction-report.json");
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        schemaVersion: "htr-wp04-reconstruction/v1",
        outcome,
        terminalState,
        validChunkCount: validChunks.length,
        sealedThroughCycleIndex,
        chainDigest,
        orphanTempDeleted,
        quarantinedSeqs,
      },
      null,
      2,
    ),
  );

  return {
    outcome,
    terminalState,
    validChunkCount: validChunks.length,
    sealedThroughCycleIndex,
    chainDigest,
    orphanTempDeleted,
    quarantinedSeqs,
    reportPath,
  };
}

export type StreamingEvidenceReconstructor = {
  reconstruct(runDir: string): ReconstructionResult;
};

export const StreamingEvidenceReconstructor: StreamingEvidenceReconstructor = {
  reconstruct: reconstructStreamingEvidence,
};
