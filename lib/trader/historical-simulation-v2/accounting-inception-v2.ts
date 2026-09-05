import { createHash } from "node:crypto";

import type postgres from "postgres";

import { parsePostgresTimestamptz } from "@/db/postgres-session-transaction";
import {
  computeAccountingSemanticDigest,
  createInitialAccountingState,
} from "@/lib/trader/accounting/canonical-cross-backend-accounting-engine";
import type { AccountingFrontierV1 } from
  "@/lib/trader/accounting/accounting-frontier.types";
import { accountingFrontierToRow } from
  "@/lib/trader/accounting/accounting-frontier-serialization";
import { computeSemanticSha256Hex } from
  "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { parseDecimal } from "@/lib/trader/risk/numeric";

export const HISTORICAL_ACCOUNTING_INCEPTION_V2 =
  "waia.trader.historical_accounting_inception.v2" as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuidFromDigest(digest: string): string {
  const chars = digest.slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = "8";
  const hex = chars.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type HistoricalAccountingInceptionInputV2 = Readonly<{
  organizationId: string;
  accountId: string;
  runId: string;
  frontierAsOf: string;
  startingCash?: string;
}>;

/**
 * Builds the one canonical accounting sequence-one row for a Historical V2 run.
 * Its row id and idempotency key are derived from semantic inception bytes, so a
 * retry cannot silently create a different cash authority for the same run.
 */
export function buildHistoricalAccountingInceptionV2(
  input: HistoricalAccountingInceptionInputV2,
): AccountingFrontierV1 {
  if (
    !UUID.test(input.organizationId) ||
    !input.accountId || input.accountId !== input.accountId.trim() ||
    !input.runId || input.runId !== input.runId.trim()
  ) {
    throw new Error("HISTORICAL_ACCOUNTING_INCEPTION_REFUSED:IDENTITY");
  }
  const frontierAsOf = new Date(input.frontierAsOf).toISOString();
  if (frontierAsOf !== input.frontierAsOf) {
    throw new Error("HISTORICAL_ACCOUNTING_INCEPTION_REFUSED:TIME");
  }
  if (input.startingCash !== undefined) {
    try {
      if (parseDecimal(input.startingCash) <= 0n) {
        throw new Error("non-positive");
      }
    } catch {
      throw new Error("HISTORICAL_ACCOUNTING_INCEPTION_REFUSED:CASH");
    }
  }
  const state = createInitialAccountingState({
    organizationId: input.organizationId,
    accountKey: input.accountId,
    runId: input.runId,
    frontierAsOf,
    ...(input.startingCash === undefined ? {} : { startingCash: input.startingCash }),
  });
  const semanticContentDigest = computeAccountingSemanticDigest(state);
  const identityDigest = computeSemanticSha256Hex({
    schemaVersion: HISTORICAL_ACCOUNTING_INCEPTION_V2,
    organizationId: input.organizationId,
    accountId: input.accountId,
    runId: input.runId,
    accountingSequence: 1,
    frontierAsOf,
    semanticContentDigest,
  });
  return Object.freeze({
    ...state,
    id: uuidFromDigest(identityDigest),
    sourceFillId: null,
    sourceEconomicsDigest: createHash("sha256")
      .update(`${HISTORICAL_ACCOUNTING_INCEPTION_V2}\nNO_SOURCE_FILL`, "utf8")
      .digest("hex"),
    semanticContentDigest,
    idempotencyKey: `${HISTORICAL_ACCOUNTING_INCEPTION_V2}:${identityDigest}`,
  });
}

type DurableAccountingInceptionRowV2 = Readonly<{
  id: string;
  organization_id: string;
  account_key: string;
  run_id: string;
  accounting_sequence: string | number;
  frontier_as_of: Date | string;
  month_key: string | null;
  cash: string;
  position_quantity_json: Record<string, string>;
  gross_position_basis_json: Record<string, string>;
  net_position_basis_json: Record<string, string>;
  gross_realized_pnl: string;
  net_realized_pnl: string;
  marks_json: Record<string, unknown>;
  marked_position_value: string | null;
  equity: string;
  equity_hwm: string;
  monthly_peak_hwm: string | null;
  monthly_drawdown_bps: number | null;
  strategy_peak_hwm_by_key_json: Record<string, string> | null;
  strategy_drawdown_bps_by_key_json: Record<string, number> | null;
  account_drawdown_bps: number;
  source_fill_id: string | null;
  source_economics_digest: string;
  semantic_content_digest: string;
  idempotency_key: string;
  schema_version: string;
}>;

function durableRowMatches(
  row: DurableAccountingInceptionRowV2,
  expected: AccountingFrontierV1,
): boolean {
  const serialized = accountingFrontierToRow(expected);
  const asOf = parsePostgresTimestamptz(row.frontier_as_of).toISOString();
  const sameJson = (left: unknown, right: unknown) =>
    computeSemanticSha256Hex(left) === computeSemanticSha256Hex(right);
  return row.id === serialized.id &&
    row.organization_id === serialized.organizationId &&
    row.account_key === serialized.accountKey && row.run_id === serialized.runId &&
    Number(row.accounting_sequence) === 1 && asOf === serialized.frontierAsOf &&
    row.month_key === serialized.monthKey &&
    row.cash === serialized.cash &&
    sameJson(row.position_quantity_json, serialized.positionQuantityJson) &&
    sameJson(row.gross_position_basis_json, serialized.grossPositionBasisJson) &&
    sameJson(row.net_position_basis_json, serialized.netPositionBasisJson) &&
    row.gross_realized_pnl === serialized.grossRealizedPnl &&
    row.net_realized_pnl === serialized.netRealizedPnl &&
    sameJson(row.marks_json, serialized.marksJson) &&
    row.marked_position_value === serialized.markedPositionValue &&
    row.equity === serialized.equity && row.equity_hwm === serialized.equityHwm &&
    row.monthly_peak_hwm === serialized.monthlyPeakHwm &&
    row.monthly_drawdown_bps === serialized.monthlyDrawdownBps &&
    sameJson(row.strategy_peak_hwm_by_key_json, serialized.strategyPeakHwmByKeyJson) &&
    sameJson(row.strategy_drawdown_bps_by_key_json,
      serialized.strategyDrawdownBpsByKeyJson) &&
    row.account_drawdown_bps === 0 && row.source_fill_id === null &&
    row.source_economics_digest === serialized.sourceEconomicsDigest &&
    row.semantic_content_digest === serialized.semanticContentDigest &&
    row.idempotency_key === serialized.idempotencyKey &&
    row.schema_version === serialized.schemaVersion;
}

async function loadInception(
  sql: postgres.Sql,
  expected: AccountingFrontierV1,
): Promise<DurableAccountingInceptionRowV2 | null> {
  const rows = await sql<DurableAccountingInceptionRowV2[]>`
    SELECT id::text AS id, organization_id::text AS organization_id, account_key, run_id,
      accounting_sequence, frontier_as_of, month_key, cash, position_quantity_json,
      gross_position_basis_json, net_position_basis_json, gross_realized_pnl,
      net_realized_pnl, marks_json, marked_position_value, equity, equity_hwm,
      monthly_peak_hwm, monthly_drawdown_bps, strategy_peak_hwm_by_key_json,
      strategy_drawdown_bps_by_key_json, account_drawdown_bps,
      source_fill_id::text AS source_fill_id, source_economics_digest,
      semantic_content_digest, idempotency_key, schema_version
    FROM trader_accounting_frontier
    WHERE organization_id=${expected.organizationId}::uuid
      AND account_key=${expected.accountKey} AND run_id=${expected.runId}
      AND accounting_sequence=1
  `;
  if (rows.length > 1) {
    throw new Error("HISTORICAL_ACCOUNTING_INCEPTION_REFUSED:AMBIGUOUS");
  }
  return rows[0] ?? null;
}

/** Idempotently persists and byte-verifies sequence one on the caller's held connection. */
export async function ensureHistoricalAccountingInceptionV2(
  sql: postgres.Sql,
  input: HistoricalAccountingInceptionInputV2,
): Promise<Readonly<{ frontier: AccountingFrontierV1; insertedNew: boolean }>> {
  const frontier = buildHistoricalAccountingInceptionV2(input);
  const existing = await loadInception(sql, frontier);
  if (existing) {
    if (!durableRowMatches(existing, frontier)) {
      throw new Error("HISTORICAL_ACCOUNTING_INCEPTION_REFUSED:CONFLICT");
    }
    return Object.freeze({ frontier, insertedNew: false });
  }
  const row = accountingFrontierToRow(frontier);
  await sql`
    INSERT INTO trader_accounting_frontier (
      id, organization_id, account_key, run_id, accounting_sequence, frontier_as_of,
      month_key, cash, position_quantity_json, gross_position_basis_json,
      net_position_basis_json, gross_realized_pnl, net_realized_pnl, marks_json,
      marked_position_value, equity, equity_hwm, monthly_peak_hwm,
      monthly_drawdown_bps, strategy_peak_hwm_by_key_json,
      strategy_drawdown_bps_by_key_json,
      account_drawdown_bps, source_fill_id, source_economics_digest,
      semantic_content_digest, idempotency_key, schema_version
    ) VALUES (
      ${row.id}::uuid, ${row.organizationId}::uuid, ${row.accountKey}, ${row.runId},
      1, ${row.frontierAsOf}::timestamptz, ${row.monthKey}, ${row.cash},
      ${JSON.stringify(row.positionQuantityJson)}::text::jsonb,
      ${JSON.stringify(row.grossPositionBasisJson)}::text::jsonb,
      ${JSON.stringify(row.netPositionBasisJson)}::text::jsonb,
      ${row.grossRealizedPnl}, ${row.netRealizedPnl},
      ${JSON.stringify(row.marksJson)}::text::jsonb, ${row.markedPositionValue},
      ${row.equity}, ${row.equityHwm}, ${row.monthlyPeakHwm},
      ${row.monthlyDrawdownBps},
      ${JSON.stringify(row.strategyPeakHwmByKeyJson)}::text::jsonb,
      ${JSON.stringify(row.strategyDrawdownBpsByKeyJson)}::text::jsonb,
      ${row.accountDrawdownBps}, NULL,
      ${row.sourceEconomicsDigest}, ${row.semanticContentDigest}, ${row.idempotencyKey},
      ${row.schemaVersion}
    ) ON CONFLICT DO NOTHING
  `;
  const durable = await loadInception(sql, frontier);
  if (!durable || !durableRowMatches(durable, frontier)) {
    throw new Error("HISTORICAL_ACCOUNTING_INCEPTION_REFUSED:CONFLICT");
  }
  return Object.freeze({ frontier, insertedNew: true });
}
