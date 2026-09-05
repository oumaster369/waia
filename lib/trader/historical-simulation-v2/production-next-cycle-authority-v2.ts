import type postgres from "postgres";

import { computeBarContentDigest } from "@/lib/trader/market-data/bar-content-digest";
import { computeSemanticSha256Hex } from
  "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import {
  HISTORICAL_DATASET_MEMBERSHIP_V2,
  type HistoricalDatasetMembershipV2,
} from "./dataset-membership-v2";
import {
  assertHistoricalMarketCycleV2,
  type HistoricalSealedMarketCycleV2,
} from "./modeled-execution-advance-v2";

const WARMUP_BARS = 240;

type DatasetRow = Readonly<{
  id: string;
  cycle_id: string;
  dataset_authority_digest_hex: string;
  membership_content_digest_hex: string;
  sealed_cycle_content_digest_hex: string;
  authority_content_digest_hex: string;
  membership_json: HistoricalDatasetMembershipV2;
  sealed_cycle_json: HistoricalSealedMarketCycleV2;
}>;

export type HistoricalProductionNextCycleAuthorityV2 = Readonly<{
  previousCycleId: string;
  currentCycleId: string;
  currentDatasetAuthorityId: string;
  currentDatasetAuthorityContentDigestHex: string;
  currentMembership: HistoricalDatasetMembershipV2;
  currentSealedCycle: HistoricalSealedMarketCycleV2;
  warmupCycles: readonly HistoricalSealedMarketCycleV2[];
}>;

function refuse(code: string): never {
  throw new Error(`HISTORICAL_PRODUCTION_NEXT_CYCLE_REFUSED:${code}`);
}

function validateDatasetRow(
  row: DatasetRow,
  input: Readonly<{
    organizationId: string;
    runId: string;
    partition: "DEVELOPMENT" | "WALK_FORWARD";
    symbol: "BTCUSDT" | "ETHUSDT";
    recordIndex: number;
    datasetAuthorityDigestHex: string;
  }>,
): void {
  const membership = row.membership_json;
  const { contentDigestHex, ...membershipBody } = membership;
  const expectedCycleId =
    `${input.runId}:${input.partition}:${input.symbol}:${input.recordIndex}`;
  assertHistoricalMarketCycleV2(row.sealed_cycle_json, expectedCycleId);
  if (
    row.cycle_id !== expectedCycleId ||
    row.sealed_cycle_json.cycleId !== expectedCycleId ||
    row.sealed_cycle_json.barIndex !== input.recordIndex ||
    row.sealed_cycle_json.closedBar.symbol.replace("/", "") !== input.symbol ||
    membership.schemaVersion !== HISTORICAL_DATASET_MEMBERSHIP_V2 ||
    membership.organizationId !== input.organizationId ||
    membership.cycleId !== expectedCycleId ||
    membership.partition !== input.partition ||
    membership.symbol !== input.symbol ||
    membership.recordIndex !== input.recordIndex ||
    membership.datasetAuthorityClass !== "PRE_HOLDOUT_QUALIFICATION_V1" ||
    membership.datasetAuthorityDigestHex !== input.datasetAuthorityDigestHex ||
    row.dataset_authority_digest_hex !== input.datasetAuthorityDigestHex ||
    contentDigestHex !== row.membership_content_digest_hex ||
    computeSemanticSha256Hex(membershipBody) !== contentDigestHex ||
    membership.barContentDigestHex !==
      computeBarContentDigest(row.sealed_cycle_json.closedBar) ||
    membership.sealedCycleContentDigestHex !==
      row.sealed_cycle_json.contentDigestHex ||
    row.sealed_cycle_content_digest_hex !==
      row.sealed_cycle_json.contentDigestHex ||
    row.authority_content_digest_hex !== computeStableJsonDigest({
      organizationId: input.organizationId,
      runId: input.runId,
      membership,
      sealedCycle: row.sealed_cycle_json,
    })
  ) {
    refuse("DATASET_AUTHORITY");
  }
}

/**
 * Produces the authenticated source authority for a non-initial cycle.
 *
 * The function is intentionally transaction-bound and accepts identities only.
 * It proves a contiguous 240-bar window from durable pre-holdout authority,
 * proves the immediately preceding PIT, and refuses a precomputed future PIT.
 */
export async function prepareHistoricalProductionNextCycleAuthorityV2(input: Readonly<{
  tx: postgres.Sql;
  organizationId: string;
  accountId: string;
  runId: string;
  partition: "DEVELOPMENT" | "WALK_FORWARD";
  symbol: "BTCUSDT" | "ETHUSDT";
  expectedRecordIndex: number;
}>): Promise<HistoricalProductionNextCycleAuthorityV2> {
  if (!Number.isSafeInteger(input.expectedRecordIndex) ||
      input.expectedRecordIndex < WARMUP_BARS) {
    refuse("RECORD_INDEX");
  }
  const runRows = await input.tx<Array<Readonly<{
    dataset_authority_digest_hex: string;
  }>>>`
    SELECT dataset_authority_digest_hex
    FROM trader_historical_simulation_run_start_v2
    WHERE organization_id=${input.organizationId}::uuid
      AND account_id=${input.accountId}
      AND run_id=${input.runId}
  `;
  const run = runRows[0];
  if (runRows.length !== 1 || !run) refuse("RUN_AUTHORITY");

  const firstRecordIndex = input.expectedRecordIndex - (WARMUP_BARS - 1);
  const rows = await input.tx<DatasetRow[]>`
    SELECT id::text, cycle_id, dataset_authority_digest_hex,
      membership_content_digest_hex, sealed_cycle_content_digest_hex,
      authority_content_digest_hex, membership_json, sealed_cycle_json
    FROM trader_historical_dataset_authority_v2
    WHERE organization_id=${input.organizationId}::uuid
      AND run_id=${input.runId}
      AND dataset_authority_class='PRE_HOLDOUT_QUALIFICATION_V1'
      AND dataset_authority_digest_hex=${run.dataset_authority_digest_hex}
      AND membership_json->>'partition'=${input.partition}
      AND membership_json->>'symbol'=${input.symbol}
      AND (membership_json->>'recordIndex')::integer
        BETWEEN ${firstRecordIndex} AND ${input.expectedRecordIndex}
    ORDER BY (membership_json->>'recordIndex')::integer
  `;
  if (rows.length !== WARMUP_BARS) refuse("WARMUP_RANGE");
  rows.forEach((row, offset) => validateDatasetRow(row, {
    organizationId: input.organizationId,
    runId: input.runId,
    partition: input.partition,
    symbol: input.symbol,
    recordIndex: firstRecordIndex + offset,
    datasetAuthorityDigestHex: run.dataset_authority_digest_hex,
  }));

  const currentCycleId =
    `${input.runId}:${input.partition}:${input.symbol}:${input.expectedRecordIndex}`;
  const pitRows = await input.tx<Array<Readonly<{
    cycle_id: string;
    record_index: number;
  }>>>`
    SELECT cycle_id, record_index
    FROM trader_historical_forecast_input_pit_v2
    WHERE organization_id=${input.organizationId}::uuid
      AND run_id=${input.runId}
      AND partition=${input.partition}
      AND symbol=${input.symbol}
      AND record_index <= ${input.expectedRecordIndex}
    ORDER BY record_index DESC
    LIMIT 1
  `;
  const previousPit = pitRows[0];
  if (!previousPit || previousPit.record_index >= input.expectedRecordIndex) {
    refuse(previousPit?.record_index === input.expectedRecordIndex
      ? "FUTURE_FORECAST_PRECOMPUTED"
      : "PREVIOUS_PIT_AUTHORITY");
  }
  const previousCycleId = previousPit.cycle_id;
  const current = rows.at(-1)!;
  return Object.freeze({
    previousCycleId,
    currentCycleId,
    currentDatasetAuthorityId: current.id,
    currentDatasetAuthorityContentDigestHex: current.authority_content_digest_hex,
    currentMembership: current.membership_json,
    currentSealedCycle: current.sealed_cycle_json,
    warmupCycles: Object.freeze(rows.map((row) => row.sealed_cycle_json)),
  });
}
