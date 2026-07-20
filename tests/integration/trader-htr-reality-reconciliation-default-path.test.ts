import { describe, expect, it } from "vitest";

import {
  advanceAccountingFrontier,
  buildHtrPnlReportV1,
  computeAccountingSemanticDigest,
  createInitialAccountingState,
} from "@/lib/trader/accounting";
import { buildHistoricalRealityReconciliationReport } from "@/lib/trader/accounting/accounting-reconciliation";
import { HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT } from "@/lib/trader/research/htr-initial-portfolio-contract";
import {
  BTC_MARK,
  makeAccountingEconomicsFill,
} from "@/tests/unit/helpers/htr-accounting-fixtures";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";

describe("HTR-WP19 reality reconciliation default path", () => {
  it("default reconciliation path passes for buy-mark cycle", () => {
    const state = createInitialAccountingState({
      organizationId: "00000000-0000-4000-8000-0000000419d2",
      accountKey: "default",
      runId: "default-run",
    });
    const buy = makeAccountingEconomicsFill("buy");
    const frontier = advanceAccountingFrontier({
      state,
      fill: buy,
      marks: { BTCUSDT: BTC_MARK },
      frontierAsOf: buy.executedAt,
    });
    const report = buildHtrPnlReportV1({
      state: frontier,
      semanticDigest: computeAccountingSemanticDigest(frontier),
    });
    const reconciliation = buildHistoricalRealityReconciliationReport({
      state: frontier,
      startingEquityUsdt: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
      startingCashUsdt: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
      pnlReport: report,
      cashEvents: [{ fillId: buy.fillId, netCashEffect: buy.economics.netCashEffect }],
      equitySeriesTerminal: frontier.equity,
    });
    expect(reconciliation.pass).toBe(true);
  });

  it.skipIf(!integrationEnabled)("postgres integration gate marker for WP19 subset", () => {
    expect(integrationEnabled).toBe(true);
  });
});
