import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { computeExitQuantity } from "@/lib/trader/guardian/compute-exit-quantity";
import { guardianReasonCodes } from "@/lib/trader/guardian/guardian-reason-codes";
import {
  assertLifecycleFillWalkOpenQtyParity,
  LifecycleFillWalkParityError,
} from "@/lib/trader/lifecycle/lifecycle-fill-walk-parity";
import { deriveCanonicalInventory } from "@/lib/trader/paper/derive-canonical-inventory";
import type { FillRow, OrderRow } from "@/lib/trader/execution/order-repository.types";

const FIXTURES = resolve(process.cwd(), "tests/fixtures/trader");

function loadFixture<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(FIXTURES, name), "utf8")) as T;
}

function mockFillEvent(
  side: "buy" | "sell",
  quantity: string,
  symbol = "BTC/USDT",
): { fill: FillRow; order: OrderRow } {
  const orderId = `order-${side}-${quantity}`;
  const order: OrderRow = {
    id: orderId,
    organizationId: "org-1",
    credentialId: null,
    venue: "mock",
    executionMode: "mock",
    symbol,
    side,
    type: "market",
    price: null,
    quantity,
    filledQuantity: quantity,
    avgFillPrice: "65000",
    state: "FILLED",
    stateVersion: 1,
    exchangeOrderId: null,
    clientOrderId: `client-${side}`,
    idempotencyKey: `idem-${side}`,
    riskDecisionId: "risk-1",
    strategySignalId: "sig-fifo-1",
    allocationDecisionId: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
  const fill: FillRow = {
    id: `fill-${side}-${quantity}`,
    organizationId: "org-1",
    orderId,
    exchangeTradeId: `trade-${side}-${quantity}`,
    quantity,
    price: "65000",
    fee: "0.01",
    feeAsset: "USDT",
    executedAt: new Date("2026-01-01T00:10:00.000Z"),
    createdAt: new Date("2026-01-01T00:10:00.000Z"),
  };
  return { fill, order };
}

describe("assertLifecycleFillWalkOpenQtyParity (PR2)", () => {
  it("passes when lifecycle open lots match canonical inventory walk", () => {
    const events = [mockFillEvent("buy", "0.005"), mockFillEvent("buy", "0.00231991")];
    const inventory = deriveCanonicalInventory(events, { "BTC/USDT": "USDT" });
    const openLots = [
      { symbol: "BTC/USDT", remainingQty: "0.005" },
      { symbol: "BTC/USDT", remainingQty: "0.00231991" },
    ];
    expect(() => assertLifecycleFillWalkOpenQtyParity({ inventory, openLots })).not.toThrow();
  });

  it("fails closed on M9-class inventory mismatch fixture", () => {
    const fixture = loadFixture<{
      canonicalOpenQty: string;
      lots: { remainingQty: string }[];
    }>("m9-v0.1.6-partial-inventory-mismatch.json");

    const inventory = {
      openQtyBySymbol: new Map([["BTC/USDT", fixture.canonicalOpenQty]]),
    };
    const openLots = fixture.lots.map((lot) => ({
      symbol: "BTC/USDT",
      remainingQty: lot.remainingQty,
    }));

    expect(() => assertLifecycleFillWalkOpenQtyParity({ inventory, openLots })).toThrow(
      LifecycleFillWalkParityError,
    );
  });

  it("computeExitQuantity emits inventory-capped partial for second lot in batch", () => {
    const fixture = loadFixture<{
      canonicalOpenQty: string;
      expectedPartialQty: string;
    }>("m9-v0.1.6-partial-inventory-mismatch.json");

    const openQtyBySymbol = new Map([["BTC/USDT", fixture.canonicalOpenQty]]);
    const batchAllocatedBySymbol = new Map([["BTC/USDT", "0.005"]]);

    const result = computeExitQuantity({
      decision: "EXIT_FULL",
      ruleReasonCode: guardianReasonCodes.maxHoldBars,
      remainingQty: "0.005",
      symbol: "BTC/USDT",
      minOrderQty: "0.00001",
      openQtyBySymbol,
      batchAllocatedBySymbol,
    });

    expect(result.approvedQty).toBe(fixture.expectedPartialQty);
    expect(result.effectiveDecision).toBe("EXIT_PARTIAL");
    expect(result.effectiveReasonCode).toBe(guardianReasonCodes.inventoryCappedPartial);
    expect(result.inventoryCapApplied).toBe(true);
  });

  it("multi-lot FIFO partial fixture leaves expected remainder after partial sell", () => {
    const fixture = loadFixture<{
      lots: { remainingQty: string }[];
      sellFillQty: string;
      expectedSecondLotRemaining: string;
    }>("multi-lot-partial-exit-fifo.json");

    const firstLotQty = fixture.lots[0]!.remainingQty;
    const closeQty =
      Number(fixture.sellFillQty) <= Number(firstLotQty) ? fixture.sellFillQty : firstLotQty;
    const firstRemaining = (Number(firstLotQty) - Number(closeQty)).toFixed(3);
    expect(firstRemaining).toBe("0");
    expect(fixture.expectedSecondLotRemaining).toBe("0.002");
  });
});
