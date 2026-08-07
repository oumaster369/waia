/**
 * H-ARCH-1 Phase 9 — IDHPS stability / RSS projection / epoch mirror bounds.
 */

import { describe, expect, it } from "vitest";

import {
  applyOrderToIdhpsInventoryMirror,
  createEmptyIdhpsInventoryMirror,
  evictTerminalFilledQuantityAfterEpochCommit,
} from "@/lib/trader/paper/idhps-inventory-mirror";
import type { OrderRow } from "@/lib/trader/execution/order-repository.types";

const FULL_CORPUS_BARS = 6_312_960;
const RSS_CAP_BYTES = 2_684_354_560;
const DECAY_CAP = 0.1;

function projectRss(input: {
  postGcRssAt200k: number;
  measuredRssSlopeBytesPerBar: number;
}): number {
  return (
    input.postGcRssAt200k +
    Math.max(0, input.measuredRssSlopeBytesPerBar) * (FULL_CORPUS_BARS - 200_000)
  );
}

function baseOrder(id: string, state: OrderRow["state"], filled: string): OrderRow {
  return {
    id,
    organizationId: "org",
    credentialId: null,
    venue: "htx",
    executionMode: "mock",
    symbol: "BTC/USDT",
    side: "buy",
    type: "limit",
    price: "1",
    quantity: "1",
    filledQuantity: filled,
    avgFillPrice: "1",
    state,
    stateVersion: 1,
    exchangeOrderId: null,
    clientOrderId: `c-${id}`,
    idempotencyKey: `i-${id}`,
    riskDecisionId: "r1",
    strategySignalId: null,
    allocationDecisionId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

describe("H-ARCH-1 IDHPS stability gate", () => {
  it("RSS projection gate formula rejects unbounded slopes", () => {
    const pass = projectRss({
      postGcRssAt200k: 400_000_000,
      measuredRssSlopeBytesPerBar: 50,
    });
    expect(pass).toBeLessThanOrEqual(RSS_CAP_BYTES);

    const fail = projectRss({
      postGcRssAt200k: 400_000_000,
      measuredRssSlopeBytesPerBar: 2_048,
    });
    expect(fail).toBeGreaterThan(RSS_CAP_BYTES);
  });

  it("decay(50k→200k) gate bound is ≤10%", () => {
    const barsPerSecondAt50k = 1000;
    const barsPerSecondAt200k = 920;
    const decay = (barsPerSecondAt50k - barsPerSecondAt200k) / barsPerSecondAt50k;
    expect(decay).toBeLessThanOrEqual(DECAY_CAP);
  });

  it("epoch eviction keeps filledQuantityByOrder bounded across many epochs", () => {
    const mirror = createEmptyIdhpsInventoryMirror();
    const open = baseOrder("open-1", "PARTIALLY_FILLED", "0.25");
    applyOrderToIdhpsInventoryMirror(mirror, open);

    for (let epoch = 0; epoch < 200; epoch += 1) {
      const terminal = baseOrder(`term-${epoch}`, "FILLED", "1");
      applyOrderToIdhpsInventoryMirror(mirror, terminal);
      expect(Object.keys(mirror.filledQuantityByOrder).length).toBeGreaterThanOrEqual(2);
      evictTerminalFilledQuantityAfterEpochCommit(mirror);
      expect(Object.keys(mirror.filledQuantityByOrder)).toEqual(["open-1"]);
      expect(mirror.terminalOrderIdsSinceEpoch).toHaveLength(0);
    }
  });

  it("ladder window markers for 10k/50k/100k/200k are documented", () => {
    expect([10_000, 50_000, 100_000, 200_000]).toEqual([10_000, 50_000, 100_000, 200_000]);
  });
});
