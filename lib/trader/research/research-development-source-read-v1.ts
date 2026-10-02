import { enforceServerOnly } from "@/lib/enforce-server-only";
enforceServerOnly();

import type postgres from "postgres";
import { assertHistoricalDatasetAuthorityRowV2 } from "@/lib/trader/historical-simulation-v2/production-next-cycle-authority-v2";
import { assertIngestBarsIntegrityOrThrow } from "@/lib/trader/market-data/ingress/bar-integrity-gate";
import { computeBarSetDigest } from "@/lib/trader/market-data/research-dataset";
import { FHV_SYMBOL_CODE_TO_INSTRUMENT, resolveFhvCanonicalPartitionInterval } from "@/lib/trader/market-data/fhv-partition-boundaries";
import { assertHtxVolumeAuthorityQualified } from "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";
import { htxVolumeRawFromClosedBar } from "@/lib/trader/backtest/historical-execution-profile";
import { deepFreezeInquiry } from "@/lib/trader/intelligence/information-inquiry/contracts-v1";
import { computeStableJsonDigest } from "./digest";
import { parseResearchDevelopmentSourceIssuanceV1, type ResearchDevelopmentSourceIssuanceV1 } from "./research-development-source-contract-v1";

type DatasetRow = Parameters<typeof assertHistoricalDatasetAuthorityRowV2>[0];
const MAX_ROW_BYTES = 64 * 1024 * 1024;

/** Requires the caller's owned transaction. The record's self-digest is never
 * accepted instead of the immutable issuer row and its exact committed rows. */
export async function readResearchDevelopmentSourceIssuanceV1(
  tx: postgres.Sql, organizationId: string, sourceRunId: string,
): Promise<ResearchDevelopmentSourceIssuanceV1 | null> {
  const rows = await tx<{ packet: string; content_digest: string; command_id: string; issued_at: string }[]>`
    SELECT issuance_json::text AS packet,content_digest,command_id,
      to_char(issued_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS issued_at
    FROM public.trader_research_development_source_runs_v1
    WHERE organization_id=${organizationId}::uuid AND source_run_id=${sourceRunId}
      AND octet_length(issuance_json::text)<=2097152`;
  if (!rows.length) return null;
  const row = rows[0]!;
  const issuance = parseResearchDevelopmentSourceIssuanceV1(JSON.parse(row.packet));
  if (rows.length !== 1 || issuance.request.organizationId !== organizationId ||
      issuance.sourceRunId !== sourceRunId || issuance.contentDigest !== row.content_digest ||
      issuance.request.commandId !== row.command_id || issuance.issuedAt !== row.issued_at) {
    throw new Error("RESEARCH_DEVELOPMENT_SOURCE_STORED_IDENTITY_MISMATCH");
  }
  return issuance;
}

export async function readResearchDevelopmentSourceRowsV1(
  tx: postgres.Sql, supplied: ResearchDevelopmentSourceIssuanceV1,
) {
  const issuance = parseResearchDevelopmentSourceIssuanceV1(supplied);
  const r = issuance.request;
  const total = r.observationBarCount + r.gapBarCount + r.trainingBarCount;
  // Do not filter by a claimed digest or partition here: an extra or altered
  // row belonging to this scoped run must fail, never disappear from the check.
  const [size] = await tx<{ count: number; bytes: string }[]>`
    SELECT count(*)::integer AS count,coalesce(sum(octet_length(to_jsonb(dataset)::text)),0)::text AS bytes
    FROM public.trader_historical_dataset_authority_v2 dataset
    WHERE organization_id=${r.organizationId}::uuid AND run_id=${issuance.sourceRunId}`;
  if (!size || size.count !== total || !Number.isSafeInteger(Number(size.bytes)) ||
      Number(size.bytes) <= 0 || Number(size.bytes) > MAX_ROW_BYTES) {
    throw new Error("RESEARCH_DEVELOPMENT_SOURCE_ROW_BUDGET_OR_COUNT_MISMATCH");
  }
  const rows = await tx<(DatasetRow & { dataset_authority_class: string })[]>`
    SELECT id::text,cycle_id,dataset_authority_class,dataset_authority_digest_hex,
      membership_content_digest_hex,sealed_cycle_content_digest_hex,
      authority_content_digest_hex,membership_json,sealed_cycle_json
    FROM public.trader_historical_dataset_authority_v2
    WHERE organization_id=${r.organizationId}::uuid AND run_id=${issuance.sourceRunId}
    ORDER BY (membership_json->>'recordIndex')::bigint LIMIT ${total + 1}`;
  if (rows.length !== total) throw new Error("RESEARCH_DEVELOPMENT_SOURCE_ROW_COUNT_MISMATCH");
  for (const [offset, row] of rows.entries()) {
    assertHistoricalDatasetAuthorityRowV2(row, { organizationId: r.organizationId,
      runId: issuance.sourceRunId, partition: "DEVELOPMENT", symbol: r.symbol,
      recordIndex: r.initialRecordIndex + offset,
      datasetAuthorityDigestHex: issuance.qualificationReceiptDigest });
    const membership = row.membership_json;
    const cycle = row.sealed_cycle_json;
    const receipt = cycle.htxVolumeAuthorityReceipt;
    assertHtxVolumeAuthorityQualified(receipt);
    if (row.dataset_authority_class !== "PRE_HOLDOUT_QUALIFICATION_V1" ||
        membership.partitionDigestHex !== issuance.partitionSemanticDigest ||
        membership.partitionRawSha256Hex !== issuance.partitionRawSha256 ||
        receipt.qualificationReceiptDigest !== issuance.volumeQualificationDigest ||
        computeStableJsonDigest(cycle.htxVolumeRaw) !==
          computeStableJsonDigest(htxVolumeRawFromClosedBar(cycle.closedBar))) {
      throw new Error("RESEARCH_DEVELOPMENT_SOURCE_ROW_BINDING_MISMATCH");
    }
  }
  const rowSetSha256 = computeStableJsonDigest(rows.map(row => ({
    id: row.id, cycleId: row.cycle_id, authorityDigest: row.authority_content_digest_hex,
  })));
  if (rowSetSha256 !== issuance.rowSetSha256) throw new Error("RESEARCH_DEVELOPMENT_SOURCE_ROWSET_MISMATCH");
  const bars = rows.map(row => row.sealed_cycle_json.closedBar);
  const integrity = assertIngestBarsIntegrityOrThrow({ bars,
    expectedSymbol: FHV_SYMBOL_CODE_TO_INSTRUMENT[r.symbol], expectedInterval: "1m" });
  const development = resolveFhvCanonicalPartitionInterval("development");
  if (integrity.gaps.length || Date.parse(bars[0]!.barOpenTime) < Date.parse(development.startUtc) ||
      Date.parse(bars.at(-1)!.barCloseTime) > Date.parse(development.endUtc)) {
    throw new Error("RESEARCH_DEVELOPMENT_SOURCE_NONCONTIGUOUS_OR_OUTSIDE_DEVELOPMENT");
  }
  const observation = bars.slice(0, r.observationBarCount);
  const training = bars.slice(r.observationBarCount + r.gapBarCount);
  for (const [range, selected] of [[issuance.observation, observation], [issuance.training, training]] as const) {
    if (computeBarSetDigest(selected) !== range.contentSha256 ||
        Date.parse(selected[0]!.barOpenTime) !== range.firstOpenMs ||
        Date.parse(selected.at(-1)!.barCloseTime) !== range.lastCloseMs) {
      throw new Error("RESEARCH_DEVELOPMENT_SOURCE_PARTITION_MISMATCH");
    }
  }
  return deepFreezeInquiry({ issuance, observation, training, cycles: rows.map(row => row.sealed_cycle_json) });
}
