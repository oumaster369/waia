import { mkdirSync } from "node:fs";
import path from "node:path";

import { writeFileAtomic } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import type { PaperCycleResult } from "@/lib/trader/paper/paper-cycle.types";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  createFhvRuntimeTraceWriter,
  type FhvRuntimeTraceWriter,
} from "@/lib/trader/observability/fhv-runtime-trace-writer";
import {
  FHV_LOG_SUBDIRS,
  FHV_REPORT_FILE_NAMES,
  resolveFhvReportsDir,
  resolveFhvRunLogRoot,
} from "@/lib/trader/observability/fhv-run-log-layout";
import type { FhvSemanticEventV1 } from "@/lib/trader/observability/fhv-semantic-event.types";
import { buildFhvDecisionTraceReportV1 } from "@/lib/trader/readiness/build-fhv-decision-trace-report.v1";
import { buildFhvExecutionAndPositionReportV1 } from "@/lib/trader/readiness/build-fhv-execution-position-report.v1";
import { buildFhvKnowledgeAndCalibrationReportV1 } from "@/lib/trader/readiness/build-fhv-knowledge-calibration-report.v1";
import { buildFhvModuleHealthReportV1 } from "@/lib/trader/readiness/build-fhv-module-health-report.v1";
import { buildFhvPnlReportV1 } from "@/lib/trader/readiness/build-fhv-pnl-report.v1";
import { buildFhvReconciliationReportV1 } from "@/lib/trader/readiness/build-fhv-reconciliation-report.v1";
import {
  buildHtrOperatorReportV1,
  type BuildHtrOperatorReportInputV1,
} from "@/lib/trader/readiness/build-htr-operator-report.v1";
import type { HtrOperatorReportProvenanceSection } from "@/lib/trader/readiness/htr-operator-report-schema.v1";
import {
  createStreamingEvidenceWriter,
  type CreateStreamingEvidenceWriterInput,
  type StreamingEvidenceWriter,
} from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-writer";
import type { StreamingEvidenceManifestRef } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence.types";

/** Precomputed digest for empty semantic state payloads (hot-path constant). */
const EMPTY_SEMANTIC_STATE_DIGEST = computeSemanticSha256Hex([]);

export type ReplayEvidenceSink = {
  onCycle(cycleIndex: number, result: PaperCycleResult): void | Promise<void>;
  sealComplete(expectedCycleCount: number): Promise<StreamingEvidenceManifestRef>;
  sealPartial(expectedCycleCount: number, reason: string): Promise<StreamingEvidenceManifestRef>;
  /**
   * High-water mark of buffered evidence projections (bounded by MAX_BATCH_CYCLES), not retained
   * PaperCycleResult objects. STREAM_ONLY retains zero PaperCycleResult objects.
   */
  peakBufferedProjections(): number;
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
  peakBufferedProjections() {
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
    peakBufferedProjections() {
      return writer.peakBufferedProjections();
    },
  };
}

export function paperCycleResultToSemanticEvents(input: {
  runId: string;
  cycleIndex: number;
  result: PaperCycleResult;
  timestampUtc?: string;
}): Omit<FhvSemanticEventV1, "schemaVersion" | "seq">[] {
  const cycleId = String(input.cycleIndex);
  const correlationId = `${input.runId}:${cycleId}`;
  const timestampUtc =
    input.timestampUtc ?? input.result.evaluation.msv.evaluatedAt ?? new Date().toISOString();
  const events: Omit<FhvSemanticEventV1, "schemaVersion" | "seq">[] = [
    {
      runId: input.runId,
      cycleId,
      moduleName: "paper-cycle",
      moduleVersion: "1.0.0",
      eventType: input.result.skipReason ? "CYCLE_SKIPPED" : "CYCLE_COMPLETE",
      inputDigest: computeSemanticSha256Hex({
        cycleIndex: input.cycleIndex,
        skipReason: input.result.skipReason ?? null,
      }),
      outputDigest: computeSemanticSha256Hex({
        submitBlocked: input.result.submitBlocked,
        executionStatus: input.result.execution?.status ?? null,
        guardianBreach: input.result.htrGuardian?.breachState ?? null,
      }),
      stateDigest: computeSemanticSha256Hex({
        callCount: input.result.htrRuntimeCallOrder?.length ?? 0,
        callKinds: (input.result.htrRuntimeCallOrder ?? []).map((entry) => entry.kind),
      }),
      timestampUtc,
      correlationId,
    },
  ];

  if (input.result.reconciliation) {
    const reconciliationFailed =
      (input.result.reconciliation.counts.TERMINAL_DRIFT ?? 0) > 0 ||
      (input.result.reconciliation.counts.UNKNOWN_POSITION ?? 0) > 0;
    events.push({
      runId: input.runId,
      cycleId,
      moduleName: "reconciliation",
      moduleVersion: "1.0.0",
      eventType: reconciliationFailed ? "RECONCILIATION_FAIL" : "RECONCILIATION_OK",
      inputDigest: computeSemanticSha256Hex({ cycleId }),
      outputDigest: computeSemanticSha256Hex({
        counts: input.result.reconciliation.counts,
        outcomeCount: input.result.reconciliation.outcomes.length,
      }),
      stateDigest: EMPTY_SEMANTIC_STATE_DIGEST,
      timestampUtc,
      correlationId: `${correlationId}:reconciliation`,
    });
  }

  if (input.result.execution) {
    events.push({
      runId: input.runId,
      cycleId,
      moduleName: "execution",
      moduleVersion: "1.0.0",
      eventType: "EXECUTION_RESULT",
      inputDigest: computeSemanticSha256Hex({ cycleId }),
      outputDigest: computeSemanticSha256Hex({
        status: input.result.execution.status,
        orderId:
          input.result.execution.status === "conflict"
            ? input.result.execution.orderId
            : (input.result.execution.order?.id ?? null),
      }),
      stateDigest: EMPTY_SEMANTIC_STATE_DIGEST,
      timestampUtc,
      correlationId: `${correlationId}:execution`,
    });
  }

  return events;
}

export type CreateFhvTraceEvidenceSinkInput = Readonly<{
  runLogRoot: string;
  organizationId: string;
  accountKey: string;
  runId: string;
  resumeSeq?: number;
  provenance: HtrOperatorReportProvenanceSection;
  getFinalizeContext?: () => Partial<BuildHtrOperatorReportInputV1> | undefined;
  /** Buffered semantic-event lines before append (default FHV_TRACE_WRITER_DEFAULT_BUFFER_LIMIT). */
  traceBufferLimit?: number;
}>;

function writeFhvReportArtifact(reportsDir: string, fileName: string, payload: unknown): string {
  mkdirSync(reportsDir, { recursive: true });
  const absolutePath = path.join(reportsDir, fileName);
  writeFileAtomic(absolutePath, `${JSON.stringify(payload, null, 2)}\n`);
  return absolutePath;
}

export function createFhvTraceEvidenceSink(
  input: CreateFhvTraceEvidenceSinkInput,
): FhvTraceReplayEvidenceSink {
  const runRoot = resolveFhvRunLogRoot({
    root: input.runLogRoot,
    organizationId: input.organizationId,
    accountKey: input.accountKey,
    runId: input.runId,
  });
  const traceWriter = createFhvRuntimeTraceWriter({
    root: input.runLogRoot,
    organizationId: input.organizationId,
    accountKey: input.accountKey,
    runId: input.runId,
    resumeSeq: input.resumeSeq,
    bufferLimit: input.traceBufferLimit,
  });

  const finalizeReports = (): Record<string, string> => {
    const events = traceWriter.readCommittedEvents();
    const generatedAtUtc = new Date().toISOString();
    const finalizeContext = input.getFinalizeContext?.() ?? {};
    const reportInput: BuildHtrOperatorReportInputV1 = {
      reportId: `${input.runId}-operator-report`,
      runId: input.runId,
      organizationId: input.organizationId,
      accountKey: input.accountKey,
      generatedAtUtc,
      semanticEvents: events,
      provenance: input.provenance,
      ...finalizeContext,
    };

    const reportsDir = resolveFhvReportsDir(runRoot);
    const files: Record<string, string> = {
      [path.join(FHV_LOG_SUBDIRS.reports, FHV_REPORT_FILE_NAMES.operatorReport)]:
        writeFhvReportArtifact(
          reportsDir,
          FHV_REPORT_FILE_NAMES.operatorReport,
          buildHtrOperatorReportV1(reportInput),
        ),
      [path.join(FHV_LOG_SUBDIRS.reports, FHV_REPORT_FILE_NAMES.pnlReport)]: writeFhvReportArtifact(
        reportsDir,
        FHV_REPORT_FILE_NAMES.pnlReport,
        buildFhvPnlReportV1(reportInput),
      ),
      [path.join(FHV_LOG_SUBDIRS.reports, FHV_REPORT_FILE_NAMES.moduleHealthReport)]:
        writeFhvReportArtifact(
          reportsDir,
          FHV_REPORT_FILE_NAMES.moduleHealthReport,
          buildFhvModuleHealthReportV1(reportInput),
        ),
      [path.join(FHV_LOG_SUBDIRS.reports, FHV_REPORT_FILE_NAMES.decisionTraceReport)]:
        writeFhvReportArtifact(
          reportsDir,
          FHV_REPORT_FILE_NAMES.decisionTraceReport,
          buildFhvDecisionTraceReportV1(reportInput),
        ),
      [path.join(FHV_LOG_SUBDIRS.reports, FHV_REPORT_FILE_NAMES.executionPositionReport)]:
        writeFhvReportArtifact(
          reportsDir,
          FHV_REPORT_FILE_NAMES.executionPositionReport,
          buildFhvExecutionAndPositionReportV1(reportInput),
        ),
      [path.join(FHV_LOG_SUBDIRS.reports, FHV_REPORT_FILE_NAMES.reconciliationReport)]:
        writeFhvReportArtifact(
          reportsDir,
          FHV_REPORT_FILE_NAMES.reconciliationReport,
          buildFhvReconciliationReportV1(reportInput),
        ),
      [path.join(FHV_LOG_SUBDIRS.reports, FHV_REPORT_FILE_NAMES.knowledgeCalibrationReport)]:
        writeFhvReportArtifact(
          reportsDir,
          FHV_REPORT_FILE_NAMES.knowledgeCalibrationReport,
          buildFhvKnowledgeAndCalibrationReportV1(reportInput),
        ),
    };
    traceWriter.writeRunManifest(files);
    return files;
  };

  return {
    onCycle(cycleIndex, result) {
      for (const event of paperCycleResultToSemanticEvents({
        runId: input.runId,
        cycleIndex,
        result,
      })) {
        traceWriter.appendSemanticEvent(event);
      }
    },
    async sealComplete(expectedCycleCount) {
      traceWriter.flushTraceWriter();
      finalizeReports();
      return {
        runDir: runRoot,
        manifest: {
          schemaVersion: "htr-wp04-evidence-manifest/v1",
          runId: input.runId,
          terminalState: "STREAMING_EVIDENCE_OK",
          chainDigest: computeSemanticSha256Hex(traceWriter.readCommittedEvents()),
          expectedCycleCount,
          chunkCount: 0,
          sealedThroughCycleIndex: expectedCycleCount - 1,
          timelineChunkCount: 0,
          provenance: {
            gitSha: input.provenance.codeSha,
            environment: "fhv-trace",
            dbConnectionMode: null,
            sealedAt: new Date().toISOString(),
            sealReason: null,
          },
        },
      };
    },
    async sealPartial(expectedCycleCount, reason) {
      const ref = await this.sealComplete!(expectedCycleCount);
      return {
        ...ref,
        manifest: {
          ...ref.manifest,
          terminalState: "STREAMING_EVIDENCE_SEALED_PARTIAL",
          provenance: { ...ref.manifest.provenance, sealReason: reason },
        },
      };
    },
    peakBufferedProjections() {
      return 0;
    },
    traceWriter,
    runRoot,
  } satisfies FhvTraceReplayEvidenceSink;
}

export type FhvTraceReplayEvidenceSink = ReplayEvidenceSink & {
  traceWriter: FhvRuntimeTraceWriter;
  runRoot: string;
};

export function assertProductionReplayEvidenceSinkConfigured(
  sink: ReplayEvidenceSink | undefined,
  fhvMode: boolean,
): void {
  if (fhvMode && (sink === undefined || sink === NOOP_REPLAY_EVIDENCE_SINK)) {
    throw new Error("FHV_TRACE_EVIDENCE_SINK:NOOP_PRODUCTION_PATH_FORBIDDEN");
  }
}

export type ShutdownCoordinator = {
  requestShutdown(signal: "SIGTERM" | "SIGINT"): void;
  onShutdown(callback: () => void | Promise<void>): void;
  isShuttingDown(): boolean;
};

export function createShutdownCoordinator(options?: {
  timeoutMs?: number;
  onTimeout?: () => void;
  /** Injectable process exit (defaults to process.exit) — overridable for tests. */
  exit?: (code: number) => void;
}): ShutdownCoordinator {
  const timeoutMs = options?.timeoutMs ?? 5000;
  const exit = options?.exit ?? ((code: number) => process.exit(code));
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
    requestShutdown(signal) {
      if (shuttingDown) {
        // Second signal escalates immediately (SIGINT semantics) without a duplicate seal.
        exit(130);
        return;
      }
      shuttingDown = true;
      // Exit code follows the received signal (SIGTERM=143, SIGINT=130) and is applied only
      // AFTER the partial seal completes (or the timeout fires), never before required cleanup.
      const exitCode = signal === "SIGTERM" ? 143 : 130;
      timeoutHandle = setTimeout(() => {
        options?.onTimeout?.();
        exit(1);
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
          exit(exitCode);
        }
      })();
    },
  };
}

export type { StreamingEvidenceWriter, CreateStreamingEvidenceWriterInput };
