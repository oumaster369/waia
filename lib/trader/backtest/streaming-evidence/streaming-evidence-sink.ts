import type { PaperCycleResult } from "@/lib/trader/paper/paper-cycle.types";
import {
  createStreamingEvidenceWriter,
  type CreateStreamingEvidenceWriterInput,
  type StreamingEvidenceWriter,
} from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-writer";
import type { StreamingEvidenceManifestRef } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence.types";

export type ReplayEvidenceSink = {
  onCycle(cycleIndex: number, result: PaperCycleResult): void | Promise<void>;
  sealComplete(expectedCycleCount: number): Promise<StreamingEvidenceManifestRef>;
  sealPartial(expectedCycleCount: number, reason: string): Promise<StreamingEvidenceManifestRef>;
  peakRetainedCycles(): number;
};

export const NOOP_REPLAY_EVIDENCE_SINK: ReplayEvidenceSink = {
  onCycle() {},
  async sealComplete(expectedCycleCount) {
    return {
      runDir: "",
      manifest: {
        schemaVersion: "htr-wp04-evidence-manifest/v1",
        runId: "noop",
        terminalState: "STREAMING_EVIDENCE_OK",
        chainDigest: "",
        expectedCycleCount,
        chunkCount: 0,
        sealedThroughCycleIndex: -1,
        timelineChunkCount: 0,
        provenance: {
          gitSha: null,
          environment: "noop",
          dbConnectionMode: null,
          sealedAt: new Date(0).toISOString(),
          sealReason: null,
        },
      },
    };
  },
  async sealPartial(expectedCycleCount, reason) {
    const ref = await this.sealComplete(expectedCycleCount);
    return {
      ...ref,
      manifest: {
        ...ref.manifest,
        terminalState: "STREAMING_EVIDENCE_SEALED_PARTIAL",
        provenance: { ...ref.manifest.provenance, sealReason: reason },
      },
    };
  },
  peakRetainedCycles() {
    return 0;
  },
};

export function createStreamingEvidenceSink(
  input: CreateStreamingEvidenceWriterInput,
): ReplayEvidenceSink {
  const writer = createStreamingEvidenceWriter(input);
  return {
    onCycle(cycleIndex, result) {
      writer.onCycle(cycleIndex, result);
    },
    async sealComplete(expectedCycleCount) {
      return writer.sealComplete(expectedCycleCount);
    },
    async sealPartial(expectedCycleCount, reason) {
      return writer.sealPartial(expectedCycleCount, reason);
    },
    peakRetainedCycles() {
      return writer.peakRetainedCycles();
    },
  };
}

export type ShutdownCoordinator = {
  requestShutdown(signal: "SIGTERM" | "SIGINT"): void;
  onShutdown(callback: () => void | Promise<void>): void;
  isShuttingDown(): boolean;
};

export function createShutdownCoordinator(options?: {
  timeoutMs?: number;
  onTimeout?: () => void;
}): ShutdownCoordinator {
  const timeoutMs = options?.timeoutMs ?? 5000;
  let shuttingDown = false;
  let sealed = false;
  let callback: (() => void | Promise<void>) | null = null;
  let timeoutHandle: NodeJS.Timeout | null = null;

  return {
    onShutdown(cb) {
      callback = cb;
    },
    isShuttingDown() {
      return shuttingDown;
    },
    requestShutdown(_signal) {
      if (shuttingDown) {
        process.exit(130);
        return;
      }
      shuttingDown = true;
      timeoutHandle = setTimeout(() => {
        options?.onTimeout?.();
        process.exit(1);
      }, timeoutMs);
      void (async () => {
        try {
          if (!sealed && callback) {
            sealed = true;
            await callback();
          }
        } finally {
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }
        }
      })();
    },
  };
}

export type { StreamingEvidenceWriter, CreateStreamingEvidenceWriterInput };
