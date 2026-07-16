import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { advanceAccountingFrontier, createInitialAccountingState } from "@/lib/trader/accounting";
import { reconcileAccountingInvariants } from "@/lib/trader/accounting/accounting-reconciliation";
import { HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT } from "@/lib/trader/research/htr-initial-portfolio-contract";
import { compareDecimal } from "@/lib/trader/risk/numeric";
import {
  BTC_MARK,
  makeAccountingEconomicsFill,
} from "@/tests/unit/helpers/htr-accounting-fixtures";

const FIXTURE_PATH = join(
  process.cwd(),
  "tests/fixtures/trader/m9-v0.1.6-partial-inventory-mismatch.json",
);

describe("HTR-WP19 M9 partial inventory regression", () => {
  it("m9-v0.1.6 partial inventory fixture reconciles after WP18 engine", () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
      canonicalOpenQty: string;
      partialLotQty: string;
      symbol: string;
    };

    const state = createInitialAccountingState({
      organizationId: "00000000-0000-4000-8000-0000000419m9",
      accountKey: "m9",
      runId: "m9-run",
    });

    const buyQty = "0.00963982";
    const buy = makeAccountingEconomicsFill("buy", {
      sliceQuantity: buyQty,
      grossFillPrice: "50000",
    });
    let frontier = advanceAccountingFrontier({
      state,
      fill: buy,
      marks: { [fixture.symbol]: BTC_MARK },
      frontierAsOf: buy.executedAt,
    });

    const sell = makeAccountingEconomicsFill("sell", {
      sliceQuantity: fixture.partialLotQty,
      grossFillPrice: "50000",
    });
    frontier = advanceAccountingFrontier({
      state: frontier,
      fill: sell,
      marks: { [fixture.symbol]: BTC_MARK },
      frontierAsOf: sell.executedAt,
    });

    const openQty = frontier.positions[fixture.symbol]?.quantity ?? "0";
    expect(compareDecimal(openQty, fixture.canonicalOpenQty)).toBe(0);

    const result = reconcileAccountingInvariants({
      state: frontier,
      startingEquityUsdt: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
      startingCashUsdt: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
      inventoryOpenQtyBySymbol: { [fixture.symbol]: fixture.canonicalOpenQty },
      cashEvents: [
        { fillId: buy.fillId, netCashEffect: buy.economics.netCashEffect },
        { fillId: sell.fillId, netCashEffect: sell.economics.netCashEffect },
      ],
    });
    expect(result.pass).toBe(true);
  });

  it("m9-v0.1.6 inventory mismatch fails closed", () => {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
      canonicalOpenQty: string;
      symbol: string;
    };

    const state = createInitialAccountingState({
      organizationId: "00000000-0000-4000-8000-0000000419m9",
      accountKey: "m9",
      runId: "m9-run",
    });
    const buy = makeAccountingEconomicsFill("buy", { sliceQuantity: "0.01000000" });
    const frontier = advanceAccountingFrontier({
      state,
      fill: buy,
      marks: { [fixture.symbol]: BTC_MARK },
      frontierAsOf: buy.executedAt,
    });

    const result = reconcileAccountingInvariants({
      state: frontier,
      startingEquityUsdt: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
      startingCashUsdt: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
      inventoryOpenQtyBySymbol: { [fixture.symbol]: fixture.canonicalOpenQty },
    });
    expect(result.pass).toBe(false);
  });
});
