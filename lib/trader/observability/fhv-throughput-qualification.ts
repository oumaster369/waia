import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  FHV_CANONICAL_MAX_RUNTIME_S,
  FHV_GROWTH_LAW_REPORT_FILENAME,
  FHV_GROWTH_LAW_LEGACY_V1_FILENAME,
  FHV_HOT_PATH_STABILITY_ASSESSOR_VERSION,
  FHV_PRELAUNCH_MAX_PROJECTED_RUNTIME_S,
} from "@/lib/trader/observability/fhv-growth-law";
import {
  assertFhvGrowthLawReportV2,
  FhvGrowthLawReportError,
} from "@/lib/trader/observability/fhv-growth-law-report";
import { assertFhvCleanTrackedHeadCheckout } from "@/lib/trader/observability/fhv-t4-release-checkout-identity";
import {
  assertFhvThroughputProducerHostMatches,
  captureFhvThroughputProducerHostIdentity,
} from "@/lib/trader/observability/fhv-throughput-producer-binding";
import {
  FHV_THROUGHPUT_EVIDENCE_INVALID_CLASSIFICATION,
  FHV_THROUGHPUT_MIN_CPS,
  FHV_THROUGHPUT_NOT_QUALIFIED_CLASSIFICATION,
  FHV_THROUGHPUT_QUALIFIED_CLASSIFICATION,
  FHV_THROUGHPUT_RECEIPT_FILENAME,
  FHV_THROUGHPUT_RECEIPT_SCHEMA,
  type FhvThroughputReceiptV2,
} from "@/lib/trader/observability/fhv-throughput-receipt";
import {
  FHV_THROUGHPUT_QUALIFIER_MIN_CHECKPOINT_SAMPLES,
  FHV_THROUGHPUT_QUALIFIER_MIN_HOT_WINDOWS,
  FHV_THROUGHPUT_QUALIFIER_MIN_PROGRESS_SAMPLES,
} from "@/lib/trader/observability/fhv-throughput-sampler";

export type FhvThroughputQualificationClassification =
  | typeof FHV_THROUGHPUT_QUALIFIED_CLASSIFICATION
  | typeof FHV_THROUGHPUT_NOT_QUALIFIED_CLASSIFICATION
  | typeof FHV_THROUGHPUT_EVIDENCE_INVALID_CLASSIFICATION;

export function qualifyFhvThroughputHost(input: {
  runDir: string;
  repoPath: string;
  expectedReleaseSha?: string;
  outPath?: string | null;
}): FhvThroughputReceiptV2 {
  const checkout = assertFhvCleanTrackedHeadCheckout({
    repoPath: input.repoPath,
    ...(input.expectedReleaseSha ? { expectedHeadSha: input.expectedReleaseSha } : {}),
  });

  const reportPath = join(input.runDir, FHV_GROWTH_LAW_REPORT_FILENAME);
  const legacyPath = join(input.runDir, FHV_GROWTH_LAW_LEGACY_V1_FILENAME);
  if (!existsSync(reportPath) && existsSync(legacyPath)) {
    throw new FhvGrowthLawReportError(
      "FHV_GROWTH_LAW_REPORT_SCHEMA_UNSUPPORTED",
      `legacy ${FHV_GROWTH_LAW_LEGACY_V1_FILENAME} cannot qualify a new official throughput receipt`,
    );
  }

  let classification: FhvThroughputQualificationClassification =
    FHV_THROUGHPUT_EVIDENCE_INVALID_CLASSIFICATION;
  let report;
  try {
    report = assertFhvGrowthLawReportV2({
      reportPath,
      runDir: input.runDir,
      expectedHeadSha: checkout.headSha,
    });
  } catch (error) {
    throw error;
  }

  if (report.checkout.headSha !== checkout.headSha) {
    throw new FhvGrowthLawReportError(
      "FHV_GROWTH_LAW_CHECKOUT_MISMATCH",
      `growth-law checkout ${report.checkout.headSha} != writer HEAD ${checkout.headSha}`,
    );
  }
  if (report.producer.headSha !== checkout.headSha) {
    throw new FhvGrowthLawReportError(
      "FHV_GROWTH_LAW_PRODUCER_HEAD_MISMATCH",
      `growth-law producer ${report.producer.headSha} != writer HEAD ${checkout.headSha}`,
    );
  }

  const producerHost = report.producer.host;
  assertFhvThroughputProducerHostMatches({
    producer: producerHost,
    current: captureFhvThroughputProducerHostIdentity(),
  });

  const progressSamples = report.progressSamples;
  const checkpointSamples = report.checkpointSamples;
  const boundedness = report.boundedHotState.classification;
  const decayVerdict = report.hotPath.verdict;
  const projectionSeconds = report.projection.projectedRuntimeSeconds;
  const projectionAvailable = Number.isFinite(projectionSeconds);
  const hotPathAssessorSupported =
    report.hotPath.assessorVersion === FHV_HOT_PATH_STABILITY_ASSESSOR_VERSION;

  const evidencePacketValid =
    projectionAvailable &&
    progressSamples >= FHV_THROUGHPUT_QUALIFIER_MIN_PROGRESS_SAMPLES &&
    checkpointSamples >= FHV_THROUGHPUT_QUALIFIER_MIN_CHECKPOINT_SAMPLES &&
    report.hotPath.windowCount >= FHV_THROUGHPUT_QUALIFIER_MIN_HOT_WINDOWS &&
    boundedness !== "INSUFFICIENT_EVIDENCE" &&
    decayVerdict !== "INSUFFICIENT_SAMPLES" &&
    hotPathAssessorSupported &&
    report.samplerContract.version.length > 0;

  const contractPass =
    evidencePacketValid &&
    boundedness === "BOUNDED" &&
    decayVerdict === "FLAT" &&
    projectionSeconds <= FHV_PRELAUNCH_MAX_PROJECTED_RUNTIME_S;

  if (!evidencePacketValid) {
    classification = FHV_THROUGHPUT_EVIDENCE_INVALID_CLASSIFICATION;
  } else if (contractPass) {
    classification = FHV_THROUGHPUT_QUALIFIED_CLASSIFICATION;
  } else {
    classification = FHV_THROUGHPUT_NOT_QUALIFIED_CLASSIFICATION;
  }

  const body: Omit<FhvThroughputReceiptV2, "receiptDigest"> = {
    schemaVersion: FHV_THROUGHPUT_RECEIPT_SCHEMA,
    capturedAtUtc: new Date().toISOString(),
    releaseSha: checkout.headSha,
    runId: report.producer.runId,
    host: producerHost,
    contract: {
      minThroughputCps: FHV_THROUGHPUT_MIN_CPS,
      canonicalMaxRuntimeS: FHV_CANONICAL_MAX_RUNTIME_S,
      prelaunchMaxProjectedRuntimeS: FHV_PRELAUNCH_MAX_PROJECTED_RUNTIME_S,
    },
    samplerContract: report.samplerContract,
    evidence: {
      representativeSegmentExecuted: true,
      progressSamples,
      checkpointSamples,
      boundednessClassification: boundedness,
      diagnosticGrowthBytesPerCycle: report.sessionGrowthDiagnostic.bytesPerCycle,
      hotPathAssessorVersion: report.hotPath.assessorVersion,
      hotPathDecayVerdict: decayVerdict,
      hotPathEarlyCps: report.hotPath.earlyCps,
      hotPathLateCps: report.hotPath.lateCps,
      hotPathDecayRatio: report.hotPath.decayRatio,
      growthAwareProjectionAvailable: projectionAvailable,
      growthAwareProjectedRuntimeS: Number(projectionSeconds.toFixed(1)),
      runId: report.producer.runId,
      runDir: report.runIdentity.runDir,
      producerHost,
      progressBytesSha256: report.progressBytesSha256,
      growthLawReportDigest: report.reportDigest,
      checkoutHeadSha: checkout.headSha,
      producerHeadSha: report.producer.headSha,
      producerBindingDigest: report.producer.bindingDigest,
    },
    classification,
  };

  const receiptDigest = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  const receipt: FhvThroughputReceiptV2 = { ...body, receiptDigest };

  const outputPath =
    input.outPath ?? join(process.cwd(), ".artifacts", FHV_THROUGHPUT_RECEIPT_FILENAME);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  return receipt;
}
