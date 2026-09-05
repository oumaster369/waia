import type postgres from "postgres";
import { describe, expect, it } from "vitest";

import { accountingFrontierToRow } from
  "@/lib/trader/accounting/accounting-frontier-serialization";
import {
  buildHistoricalAccountingInceptionV2,
  ensureHistoricalAccountingInceptionV2,
} from "@/lib/trader/historical-simulation-v2/accounting-inception-v2";

const ORG = "11111111-1111-4111-8111-111111111111";
const INPUT = Object.freeze({
  organizationId: ORG,
  accountId: "historical-account",
  runId: "dee-919-run",
  frontierAsOf: "2026-01-01T00:01:00.000Z",
  startingCash: "10000",
});

function durableRow(input = INPUT) {
  const frontier = buildHistoricalAccountingInceptionV2(input);
  const row = accountingFrontierToRow(frontier);
  return {
    id: row.id,
    organization_id: row.organizationId,
    account_key: row.accountKey,
    run_id: row.runId,
    accounting_sequence: "1",
    frontier_as_of: new Date(row.frontierAsOf),
    month_key: row.monthKey,
    cash: row.cash,
    position_quantity_json: row.positionQuantityJson,
    gross_position_basis_json: row.grossPositionBasisJson,
    net_position_basis_json: row.netPositionBasisJson,
    gross_realized_pnl: row.grossRealizedPnl,
    net_realized_pnl: row.netRealizedPnl,
    marks_json: row.marksJson,
    marked_position_value: row.markedPositionValue,
    equity: row.equity,
    equity_hwm: row.equityHwm,
    monthly_peak_hwm: row.monthlyPeakHwm,
    monthly_drawdown_bps: row.monthlyDrawdownBps,
    strategy_peak_hwm_by_key_json: row.strategyPeakHwmByKeyJson,
    strategy_drawdown_bps_by_key_json: row.strategyDrawdownBpsByKeyJson,
    account_drawdown_bps: row.accountDrawdownBps,
    source_fill_id: null,
    source_economics_digest: row.sourceEconomicsDigest,
    semantic_content_digest: row.semanticContentDigest,
    idempotency_key: row.idempotencyKey,
    schema_version: row.schemaVersion,
  };
}

function sqlReturning(selects: readonly unknown[][]) {
  let selectIndex = 0;
  const sql = (async (strings: TemplateStringsArray) => {
    const statement = strings.join("?");
    if (statement.includes("SELECT id::text AS id")) {
      const rows = selects[selectIndex] ?? [];
      selectIndex += 1;
      return rows;
    }
    return [];
  }) as unknown as postgres.Sql;
  (sql as unknown as { json(value: unknown): unknown }).json = (value) => value;
  return sql;
}

describe("historical accounting inception V2", () => {
  it("builds one deterministic semantic sequence-one authority", () => {
    const first = buildHistoricalAccountingInceptionV2(INPUT);
    const second = buildHistoricalAccountingInceptionV2(INPUT);
    expect(second).toEqual(first);
    expect(first).toMatchObject({
      organizationId: ORG,
      accountKey: "historical-account",
      runId: "dee-919-run",
      accountingSequence: 1,
      frontierAsOf: "2026-01-01T00:01:00.000Z",
      cash: "10000",
      sourceFillId: null,
    });
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.semanticContentDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(first.idempotencyKey).toContain(first.idempotencyKey.split(":").at(-1)!);
  });

  it("refuses non-canonical identity, time and cash", () => {
    expect(() => buildHistoricalAccountingInceptionV2({ ...INPUT, runId: " run" }))
      .toThrow("IDENTITY");
    expect(() => buildHistoricalAccountingInceptionV2({
      ...INPUT, frontierAsOf: "2026-01-01T00:01:00Z",
    })).toThrow("TIME");
    expect(() => buildHistoricalAccountingInceptionV2({ ...INPUT, startingCash: "0" }))
      .toThrow("CASH");
  });

  it("inserts once and accepts only an exact durable retry", async () => {
    const expected = durableRow();
    await expect(ensureHistoricalAccountingInceptionV2(
      sqlReturning([[], [expected]]), INPUT,
    )).resolves.toMatchObject({ insertedNew: true });
    await expect(ensureHistoricalAccountingInceptionV2(
      sqlReturning([[expected]]), INPUT,
    )).resolves.toMatchObject({ insertedNew: false });
  });

  it("fails closed when sequence one already has different semantic bytes", async () => {
    const conflict = { ...durableRow(), cash: "9999" };
    await expect(ensureHistoricalAccountingInceptionV2(
      sqlReturning([[conflict]]), INPUT,
    )).rejects.toThrow("CONFLICT");
  });
});
