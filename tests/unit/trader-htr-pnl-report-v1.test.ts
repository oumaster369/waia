import { describe, expect, it } from "vitest";

import {
  advanceAccountingFrontier,
  buildHtrPnlReportV1,
  computeAccountingSemanticDigest,
  computeHtrPnlReportDigest,
  createInitialAccountingState,
  HTR_PNL_REPORT_SCHEMA_VERSION,
  serializeHtrPnlReportV1,
  type AccountingFrontierV1,
  type AccountingStateV1,
  type HtrPnlReportV1,
} from "@/lib/trader/accounting";
import { HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT } from "@/lib/trader/research/htr-initial-portfolio-contract";
import { compareDecimal } from "@/lib/trader/risk/numeric";
import {
  BTC_MARK,
  makeAccountingEconomicsFill,
} from "@/tests/unit/helpers/htr-accounting-fixtures";

const ORG_ID = "00000000-0000-4000-8000-000000041802";
const ACCOUNT_KEY = "htr-pnl-report";
const RUN_ID = "htr-pnl-run-1";

function frontierToState(frontier: AccountingFrontierV1): AccountingStateV1 {
  const {
    id: _id,
    sourceFillId: _sourceFillId,
    sourceEconomicsDigest: _sourceEconomicsDigest,
    semanticContentDigest: _semanticContentDigest,
    idempotencyKey: _idempotencyKey,
    ...state
  } = frontier;
  return state;
}

function sampleReport(): HtrPnlReportV1 {
  const fill = makeAccountingEconomicsFill("buy");
  const frontier = advanceAccountingFrontier({
    state: createInitialAccountingState({
      organizationId: ORG_ID,
      accountKey: ACCOUNT_KEY,
      runId: RUN_ID,
    }),
    fill,
    marks: { BTCUSDT: BTC_MARK },
    frontierAsOf: fill.executedAt,
  });
  return buildHtrPnlReportV1({
    state: frontierToState(frontier),
    semanticDigest: frontier.semanticContentDigest,
  });
}

describe("HTR-WP18 PnL report v1", () => {
  it("pins schema version", () => {
    const report = sampleReport();
    expect(report.schemaVersion).toBe(HTR_PNL_REPORT_SCHEMA_VERSION);
    expect(HTR_PNL_REPORT_SCHEMA_VERSION).toBe("htr-pnl-report/v1");
  });

  it("serializes canonical sorted keys", () => {
    const report = sampleReport();
    const serialized = serializeHtrPnlReportV1(report);
    const parsed = JSON.parse(serialized) as Record<string, unknown>;

    expect(Object.keys(parsed)).toEqual([
      "accountDrawdownBps",
      "accountingSequence",
      "accountKey",
      "equityHwmUsdt",
      "grossRealizedPnlUsdt",
      "grossUnrealizedPnlUsdt",
      "netRealizedPnlUsdt",
      "netUnrealizedPnlUsdt",
      "organizationId",
      "runId",
      "schemaVersion",
      "startingEquityUsdt",
      "terminalCashUsdt",
      "terminalEquityUsdt",
      "terminalOpenPositions",
      "totalExecutionCostUsdt",
    ]);
    expect(parsed).not.toHaveProperty("semanticDigest");
  });

  it("computes stable digest for identical reports", () => {
    const report = sampleReport();
    expect(computeHtrPnlReportDigest(report)).toBe(computeHtrPnlReportDigest({ ...report }));
  });

  it("digest changes when terminal equity changes", () => {
    const report = sampleReport();
    const mutated = { ...report, terminalEquityUsdt: "99999.00" };
    expect(computeHtrPnlReportDigest(mutated)).not.toBe(computeHtrPnlReportDigest(report));
  });

  it("excludes semanticDigest from digest input", () => {
    const report = sampleReport();
    const withDifferentDigest = { ...report, semanticDigest: "f".repeat(64) };
    expect(computeHtrPnlReportDigest(withDifferentDigest)).toBe(computeHtrPnlReportDigest(report));
  });

  it("builds terminal open positions with gross and net avg cost", () => {
    const report = sampleReport();
    expect(report.terminalOpenPositions).toHaveLength(1);
    expect(report.terminalOpenPositions[0]?.symbol).toBe("BTCUSDT");
    expect(compareDecimal(report.terminalOpenPositions[0]?.quantity ?? "0", "0.1")).toBe(0);
    expect(compareDecimal(report.terminalOpenPositions[0]!.grossAvgCost, "10000")).toBe(0);
    expect(compareDecimal(report.terminalOpenPositions[0]!.netAvgCost, "10035")).toBe(0);
  });

  it("reports total execution cost as gross minus net PnL components", () => {
    const fill = makeAccountingEconomicsFill("buy");
    let state = createInitialAccountingState({
      organizationId: ORG_ID,
      accountKey: ACCOUNT_KEY,
      runId: RUN_ID,
    });
    const afterBuy = advanceAccountingFrontier({
      state,
      fill,
      marks: { BTCUSDT: BTC_MARK },
      frontierAsOf: fill.executedAt,
    });
    state = frontierToState(afterBuy);
    const sell = makeAccountingEconomicsFill("sell");
    const frontier = advanceAccountingFrontier({
      state,
      fill: sell,
      marks: { BTCUSDT: BTC_MARK },
      frontierAsOf: sell.executedAt,
    });
    const report = buildHtrPnlReportV1({
      state: frontierToState(frontier),
      semanticDigest: frontier.semanticContentDigest,
    });

    expect(compareDecimal(report.totalExecutionCostUsdt, "7")).toBe(0);
    expect(report.startingEquityUsdt).toBe(HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT);
    expect(report.accountingSequence).toBe(3);
    expect(report.semanticDigest).toBe(computeAccountingSemanticDigest(frontierToState(frontier)));
  });
});
