import { enforceServerOnly } from "@/lib/enforce-server-only";
enforceServerOnly();

import type postgres from "postgres";
import { assertHistoricalDatasetAuthorityRowV2 } from "@/lib/trader/historical-simulation-v2/production-next-cycle-authority-v2";
import { assertIngestBarsIntegrityOrThrow } from "@/lib/trader/market-data/ingress/bar-integrity-gate";
import { computeBarSetDigest } from "@/lib/trader/market-data/research-dataset";
import { FHV_SYMBOL_CODE_TO_INSTRUMENT, resolveFhvCanonicalPartitionInterval } from "@/lib/trader/market-data/fhv-partition-boundaries";
import { assertHtxVolumeAuthorityQualified } from "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";
import { htxVolumeRawFromClosedBar } from "@/lib/trader/backtest/historical-execution-profile";
import { computeStableJsonDigest } from "./digest";
import { parseResearchEvaluationSourceIssuanceV1, type ResearchEvaluationSourceIssuanceV1 } from "./research-development-evaluation-source-issuance-v1";

type DatasetRow = Parameters<typeof assertHistoricalDatasetAuthorityRowV2>[0];
const MAX_ROW_BYTES = 64 * 1024 * 1024;

/** Requires the caller's owned transaction. The record's self-digest is never
 * accepted instead of the immutable issuer row and its exact committed rows. */
export async function readResearchEvaluationSourceIssuanceV1(
  tx: postgres.Sql, organizationId: string, evaluationSourceId: string,
): Promise<ResearchEvaluationSourceIssuanceV1 | null> {
  const rows = await tx<{ packet: string; content_digest: string; command_id: string; issued_at: string; training_source_run_id: string; training_source_issuance_digest: string }[]>`
    SELECT issuance_json::text AS packet,content_digest,command_id,training_source_run_id,training_source_issuance_digest,
      to_char(issued_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS issued_at
    FROM public.trader_research_evaluation_source_runs_v1
    WHERE organization_id=${organizationId}::uuid AND evaluation_source_id=${evaluationSourceId}
      AND octet_length(issuance_json::text)<=2097152`;
  if (!rows.length) return null;
  const row = rows[0]!;
  const issuance = parseResearchEvaluationSourceIssuanceV1(JSON.parse(row.packet));
  if (rows.length !== 1 || issuance.metadata.request.organizationId !== organizationId ||
      issuance.metadata.evaluationSourceId !== evaluationSourceId || issuance.contentDigest !== row.content_digest ||
      issuance.metadata.request.commandId !== row.command_id || issuance.issuedAt !== row.issued_at ||
      issuance.metadata.request.trainingSourceRunId !== row.training_source_run_id ||
      issuance.metadata.request.trainingSourceIssuanceDigest !== row.training_source_issuance_digest) {
    throw new Error("RESEARCH_EVALUATION_SOURCE_STORED_IDENTITY_MISMATCH");
  }
  return issuance;
}

export async function readResearchEvaluationSourceRowsV1(
  tx: postgres.Sql, supplied: ResearchEvaluationSourceIssuanceV1,
  limits: Readonly<{ maxBytes: number }> = { maxBytes: MAX_ROW_BYTES },
) {
  const maxBytes = limits.maxBytes;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_ROW_BYTES) {
    throw new Error("RESEARCH_EVALUATION_SOURCE_ROW_BUDGET_INVALID");
  }
  const issuance = parseResearchEvaluationSourceIssuanceV1(supplied);
  const m = issuance.metadata;
  const r = m.request;
  const total = r.validation.barCount;
  // Do not filter by a claimed digest or partition here: an extra or altered
  // row belonging to this scoped run must fail, never disappear from the check.
  const [size] = await tx<{ count: number; bytes: string }[]>`
    SELECT count(*)::integer AS count,coalesce(sum(octet_length(to_jsonb(dataset)::text)),0)::text AS bytes
    FROM public.trader_historical_dataset_authority_v2 dataset
    WHERE organization_id=${r.organizationId}::uuid AND run_id=${issuance.metadata.evaluationSourceId}`;
  if (!size || size.count !== total || !Number.isSafeInteger(Number(size.bytes)) ||
      Number(size.bytes) <= 0 || Number(size.bytes) > maxBytes) {
    throw new Error("RESEARCH_EVALUATION_SOURCE_ROW_BUDGET_OR_COUNT_MISMATCH");
  }
  const rows = await tx<(DatasetRow & { dataset_authority_class: string })[]>`
    SELECT id::text,cycle_id,dataset_authority_class,dataset_authority_digest_hex,
      membership_content_digest_hex,sealed_cycle_content_digest_hex,
      authority_content_digest_hex,membership_json,sealed_cycle_json
    FROM public.trader_historical_dataset_authority_v2
    WHERE organization_id=${r.organizationId}::uuid AND run_id=${issuance.metadata.evaluationSourceId}
    ORDER BY (membership_json->>'recordIndex')::bigint LIMIT ${total + 1}`;
  if (rows.length !== total) throw new Error("RESEARCH_EVALUATION_SOURCE_ROW_COUNT_MISMATCH");
  for (const [offset, row] of rows.entries()) {
    assertHistoricalDatasetAuthorityRowV2(row, { organizationId: r.organizationId,
      runId: issuance.metadata.evaluationSourceId, partition: "DEVELOPMENT", symbol: r.symbol,
      recordIndex: r.validation.firstRecordIndex + offset,
      datasetAuthorityDigestHex: m.qualificationReceiptDigest });
    const membership = row.membership_json;
    const cycle = row.sealed_cycle_json;
    const receipt = cycle.htxVolumeAuthorityReceipt;
    assertHtxVolumeAuthorityQualified(receipt);
    if (row.dataset_authority_class !== "PRE_HOLDOUT_QUALIFICATION_V1" ||
        membership.partitionDigestHex !== m.partitionSemanticDigest ||
        membership.partitionRawSha256Hex !== m.partitionRawSha256 ||
        receipt.qualificationReceiptDigest !== m.volumeQualificationDigest ||
        computeStableJsonDigest(cycle.htxVolumeRaw) !==
          computeStableJsonDigest(htxVolumeRawFromClosedBar(cycle.closedBar))) {
      throw new Error("RESEARCH_EVALUATION_SOURCE_ROW_BINDING_MISMATCH");
    }
  }
  const rowSetSha256 = computeStableJsonDigest(rows.map(row => ({
    id: row.id, cycleId: row.cycle_id, authorityDigest: row.authority_content_digest_hex,
  })));
  if (rowSetSha256 !== issuance.rowSetSha256) throw new Error("RESEARCH_EVALUATION_SOURCE_ROWSET_MISMATCH");
  const bars = rows.map(row => row.sealed_cycle_json.closedBar);
  const integrity = assertIngestBarsIntegrityOrThrow({ bars,
    expectedSymbol: FHV_SYMBOL_CODE_TO_INSTRUMENT[r.symbol], expectedInterval: "1m" });
  const development = resolveFhvCanonicalPartitionInterval("development");
  if (integrity.gaps.length || Date.parse(bars[0]!.barOpenTime) < Date.parse(development.startUtc) ||
      Date.parse(bars.at(-1)!.barCloseTime) > Date.parse(development.endUtc)) {
    throw new Error("RESEARCH_EVALUATION_SOURCE_NONCONTIGUOUS_OR_OUTSIDE_DEVELOPMENT");
  }
  const sourceCycleSetSha256 = computeStableJsonDigest(rows.map(row => ({
    recordIndex: row.membership_json.recordIndex, cycleId: row.cycle_id,
    membershipDigest: row.membership_content_digest_hex, cycleDigest: row.sealed_cycle_content_digest_hex,
  })));
  if (sourceCycleSetSha256 !== m.sourceCycleSetSha256) throw new Error("RESEARCH_EVALUATION_SOURCE_CYCLESET_MISMATCH");
  for (const range of [m.validation, ...m.walkForward]) {
    const start = range.firstRecordIndex - r.validation.firstRecordIndex;
    const selected = bars.slice(start, start + range.barCount);
    if (selected.length !== range.barCount || computeBarSetDigest(selected) !== range.contentSha256 ||
        Date.parse(selected[0]!.barOpenTime) !== range.firstOpenMs ||
        Date.parse(selected.at(-1)!.barCloseTime) !== range.lastCloseMs) {
      throw new Error("RESEARCH_EVALUATION_SOURCE_PARTITION_MISMATCH");
    }
  }
  // This verifies persistence only. Evaluation payload disclosure requires a
  // separately committed candidate/consumption owner; no bars leave this reader.
  return issuance;
}
