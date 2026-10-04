import { enforceServerOnly } from "@/lib/enforce-server-only";
enforceServerOnly();

import { loadHistoricalSimulationBootstrapSourceSnapshotV2 } from "@/lib/trader/historical-simulation-v2/bootstrap-source-loader-v2";
import { assertIngestBarsIntegrityOrThrow } from "@/lib/trader/market-data/ingress/bar-integrity-gate";
import { computeBarSetDigest } from "@/lib/trader/market-data/research-dataset";
import { FHV_SYMBOL_CODE_TO_INSTRUMENT } from "@/lib/trader/market-data/fhv-partition-boundaries";
import { computeStableJsonDigest } from "./digest";
import { parseResearchDevelopmentSourceIssuanceV1, RESEARCH_DEVELOPMENT_SOURCE_LIMITS_V1 as LIMITS } from "./research-development-source-contract-v1";
import {
  captureResearchDevelopmentEvaluationSourceRequestV1, researchDevelopmentEvaluationSourceIdV1,
  sealResearchDevelopmentEvaluationSourceMetadataV1,
} from "./research-development-evaluation-source-contract-v1";

type SourceHost = Readonly<{
  datasetRoot: string; qualificationReceiptPath: string; runtimeRequalificationReceiptPath: string;
  htxVolumeQualificationReceiptPath: string; releaseSha: string;
}>;

/** Private preparation building block for the future restricted durable issuer.
 * The caller must own host configuration and read the training issuance from its
 * committed snapshot. Parsing supplied metadata here cannot establish that fact.
 * No evaluator/CLI uses this helper, and no bars/cycles leave its result. It is
 * not a consumed-payload reader and grants no research or execution authority. */
export async function prepareResearchDevelopmentEvaluationSourceMetadataV1(input: Readonly<{
  request: unknown; trainingIssuance: unknown; host: SourceHost; signal?: AbortSignal;
}>) {
  const request = captureResearchDevelopmentEvaluationSourceRequestV1(input.request);
  const training = parseResearchDevelopmentSourceIssuanceV1(input.trainingIssuance);
  // Capture primitive host settings before the first await. Host settings are
  // an internal dependency, never part of a caller's source selection request.
  const host = Object.freeze({ datasetRoot: input.host.datasetRoot,
    qualificationReceiptPath: input.host.qualificationReceiptPath,
    runtimeRequalificationReceiptPath: input.host.runtimeRequalificationReceiptPath,
    htxVolumeQualificationReceiptPath: input.host.htxVolumeQualificationReceiptPath,
    releaseSha: input.host.releaseSha });
  const timeout = AbortSignal.timeout(LIMITS.deadlineMs);
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
  signal.throwIfAborted();
  if (request.trainingSourceRunId !== training.sourceRunId ||
      request.trainingSourceIssuanceDigest !== training.contentDigest ||
      request.organizationId !== training.request.organizationId || request.symbol !== training.request.symbol ||
      host.releaseSha !== training.releaseSha ||
      request.validation.firstRecordIndex < training.training.firstRecordIndex + training.training.barCount) {
    throw new Error("RESEARCH_EVALUATION_SOURCE_TRAINING_BINDING_MISMATCH");
  }
  const evaluationSourceId = researchDevelopmentEvaluationSourceIdV1(request);
  const snapshot = await loadHistoricalSimulationBootstrapSourceSnapshotV2({ ...host,
    organizationId: request.organizationId, runId: evaluationSourceId, symbol: request.symbol,
    partition: "DEVELOPMENT", initialRecordIndex: request.validation.firstRecordIndex,
    cycleCount: request.validation.barCount, maxSourceBytes: LIMITS.maxSourceBytes,
    maxReceiptBytes: LIMITS.maxReceiptBytes, signal });
  signal.throwIfAborted();
  if (snapshot.qualificationReceiptDigestHex !== training.qualificationReceiptDigest ||
      snapshot.partitionRawSha256Hex !== training.partitionRawSha256 ||
      snapshot.partitionSemanticDigestHex !== training.partitionSemanticDigest ||
      snapshot.verifiedSource.sourceReleaseSha !== training.sourceReleaseSha ||
      snapshot.verifiedSource.targetReleaseSha !== training.releaseSha ||
      snapshot.verifiedSource.runtimeRequalificationDigestHex !== training.runtimeRequalificationDigest ||
      snapshot.verifiedSource.volumeQualificationDigestHex !== training.volumeQualificationDigest) {
    throw new Error("RESEARCH_EVALUATION_SOURCE_LINEAGE_MISMATCH");
  }
  const sources = snapshot.sources;
  if (sources.length !== request.validation.barCount || sources.some((source, i) =>
    source.membership.recordIndex !== request.validation.firstRecordIndex + i ||
    source.cycle.barIndex !== source.membership.recordIndex)) {
    throw new Error("RESEARCH_EVALUATION_SOURCE_RECORD_RANGE_MISMATCH");
  }
  const bars = sources.map(source => source.cycle.closedBar);
  const integrity = assertIngestBarsIntegrityOrThrow({ bars,
    expectedSymbol: FHV_SYMBOL_CODE_TO_INSTRUMENT[request.symbol], expectedInterval: "1m" });
  if (integrity.gaps.length || Date.parse(bars[0]!.barOpenTime) < training.training.lastCloseMs) {
    throw new Error("RESEARCH_EVALUATION_SOURCE_NONCONTIGUOUS_OR_BEFORE_TRAIN_END");
  }
  const observed = (selection: Readonly<{ firstRecordIndex: number; barCount: number }>) => {
    // Array offsets come from the verified absolute record sequence, not dates.
    const start = selection.firstRecordIndex - request.validation.firstRecordIndex;
    const selected = bars.slice(start, start + selection.barCount);
    if (selected.length !== selection.barCount) throw new Error("RESEARCH_EVALUATION_SOURCE_WINDOW_MISSING");
    return { ...selection, firstOpenMs: Date.parse(selected[0]!.barOpenTime),
      lastCloseMs: Date.parse(selected.at(-1)!.barCloseTime), contentSha256: computeBarSetDigest(selected) };
  };
  const metadata = sealResearchDevelopmentEvaluationSourceMetadataV1({
    schemaVersion: "waia.research.development-evaluation-source-metadata.v1",
    authority: "PREPARATION_METADATA_ONLY", request, evaluationSourceId,
    releaseSha: host.releaseSha, sourceReleaseSha: snapshot.verifiedSource.sourceReleaseSha,
    qualificationReceiptDigest: snapshot.qualificationReceiptDigestHex,
    runtimeRequalificationDigest: snapshot.verifiedSource.runtimeRequalificationDigestHex,
    partitionRawSha256: snapshot.partitionRawSha256Hex, partitionSemanticDigest: snapshot.partitionSemanticDigestHex,
    volumeQualificationDigest: snapshot.verifiedSource.volumeQualificationDigestHex,
    sourceCycleSetSha256: computeStableJsonDigest(sources.map(source => ({
      recordIndex: source.membership.recordIndex, cycleId: source.cycle.cycleId,
      membershipDigest: source.membership.contentDigestHex, cycleDigest: source.cycle.contentDigestHex,
    }))),
    validation: observed(request.validation), walkForward: request.walkForward.map(observed),
    sourceAvailability: "PIT_SOURCE_AVAILABILITY_NOT_ESTABLISHED",
    scientificQualified: false, capitalEligible: false,
  });
  if (Buffer.byteLength(JSON.stringify(metadata)) > LIMITS.maxReceiptBytes) throw new Error("RESEARCH_EVALUATION_SOURCE_METADATA_BYTE_LIMIT");
  signal.throwIfAborted();
  return metadata;
}
