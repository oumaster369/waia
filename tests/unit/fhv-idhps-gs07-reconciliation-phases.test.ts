import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  consumeWp17FillIntoAccountingBridge,
  createHtrAccountingCycleBridge,
  HtrAccountingReconciliationTerminationError,
  runAutomaticAccountingReconciliation,
} from "@/lib/trader/accounting/htr-accounting-cycle-bridge";
import {
  getIdhpsHotPathCounters,
  resetIdhpsHotPathCounters,
  setIdhpsHotPathEnabled,
} from "@/lib/trader/execution/idhps-hot-path-counters";
import {
  BTC_MARK,
  makeAccountingEconomicsFill,
} from "@/tests/unit/helpers/htr-accounting-fixtures";
import { advanceAccountingFrontier } from "@/lib/trader/accounting";

const ORG = "00000000-0000-4000-8000-00000000gs07";
const PHASES = ["frontier_mutation", "before_guardian", "before_cycle_complete"] as const;

function seedMarkOnlyBridge() {
  const bridge = createHtrAccountingCycleBridge({
    organizationId: ORG,
    accountKey: "gs07",
    runId: "gs07-mark-only",
  });
  // First call is always a full reconcile and arms the mark-only frontier.
  runAutomaticAccountingReconciliation(bridge, {
    phase: "before_guardian",
    cycleIndex: 0,
    inventoryOpenQtyBySymbol: {},
  });
  expect(bridge.lastFullReconcileFillCount).toBe(0);
  expect(bridge.lastFullReconcileCash).toBe(bridge.state.cash);
  return bridge;
}

describe("H-ARCH-1 GS-07 locked reconciliation phases", () => {
  beforeEach(() => {
    resetIdhpsHotPathCounters();
    setIdhpsHotPathEnabled(true);
  });

  afterEach(() => {
    setIdhpsHotPathEnabled(false);
    resetIdhpsHotPathCounters();
  });

  it("A: IDHPS mark-only cycles execute frontier_mutation → before_guardian → before_cycle_complete", () => {
    const bridge = seedMarkOnlyBridge();
    const before = getIdhpsHotPathCounters().reconciliationCalls;
    const observed: string[] = [];
    for (const phase of PHASES) {
      const callsBefore = getIdhpsHotPathCounters().reconciliationCalls;
      runAutomaticAccountingReconciliation(bridge, {
        phase,
        cycleIndex: 1,
        inventoryOpenQtyBySymbol: {},
      });
      expect(getIdhpsHotPathCounters().reconciliationCalls).toBe(callsBefore + 1);
      observed.push(phase);
      expect(bridge.runTerminated).toBe(false);
    }
    expect(observed).toEqual([...PHASES]);
    expect(getIdhpsHotPathCounters().reconciliationCalls).toBe(before + 3);
  });

  it("B: corruption before frontier_mutation fails closed at frontier_mutation", () => {
    const bridge = seedMarkOnlyBridge();
    bridge.state.equity = "999999.00";
    expect(() =>
      runAutomaticAccountingReconciliation(bridge, {
        phase: "frontier_mutation",
        cycleIndex: 2,
        inventoryOpenQtyBySymbol: {},
      }),
    ).toThrow(HtrAccountingReconciliationTerminationError);
    expect(bridge.runTerminated).toBe(true);
    expect(bridge.terminationCode).toBe("RECONCILIATION_FAILURE");
  });

  it("C: corruption between frontier_mutation and before_guardian fails closed at/before before_guardian", () => {
    const bridge = seedMarkOnlyBridge();
    runAutomaticAccountingReconciliation(bridge, {
      phase: "frontier_mutation",
      cycleIndex: 3,
      inventoryOpenQtyBySymbol: {},
    });
    bridge.state.equity = "999999.00";
    expect(() =>
      runAutomaticAccountingReconciliation(bridge, {
        phase: "before_guardian",
        cycleIndex: 3,
        inventoryOpenQtyBySymbol: {},
      }),
    ).toThrow(HtrAccountingReconciliationTerminationError);
    expect(bridge.terminationCode).toBe("RECONCILIATION_FAILURE");
  });

  it("D: corruption between before_guardian and before_cycle_complete fails closed at before_cycle_complete", () => {
    const bridge = seedMarkOnlyBridge();
    runAutomaticAccountingReconciliation(bridge, {
      phase: "frontier_mutation",
      cycleIndex: 4,
      inventoryOpenQtyBySymbol: {},
    });
    runAutomaticAccountingReconciliation(bridge, {
      phase: "before_guardian",
      cycleIndex: 4,
      inventoryOpenQtyBySymbol: {},
    });
    bridge.state.equity = "999999.00";
    expect(() =>
      runAutomaticAccountingReconciliation(bridge, {
        phase: "before_cycle_complete",
        cycleIndex: 4,
        inventoryOpenQtyBySymbol: {},
      }),
    ).toThrow(HtrAccountingReconciliationTerminationError);
    expect(bridge.terminationCode).toBe("RECONCILIATION_FAILURE");
  });

  it("E: fill mutation still triggers full reconciliation", () => {
    const bridge = seedMarkOnlyBridge();
    const fill = makeAccountingEconomicsFill("buy");
    consumeWp17FillIntoAccountingBridge(bridge, { fill, cycleIndex: 5 });
    bridge.state = advanceAccountingFrontier({
      state: bridge.state,
      marks: { BTCUSDT: BTC_MARK },
      frontierAsOf: BTC_MARK.barCloseTime,
      skipSemanticDigest: true,
    });
    const passKindsBefore = bridge.callOrder.filter(
      (e) => e.kind === "WP19_RECONCILIATION_PASS",
    ).length;
    runAutomaticAccountingReconciliation(bridge, {
      phase: "frontier_mutation",
      cycleIndex: 5,
      inventoryOpenQtyBySymbol: { BTCUSDT: fill.economics.quantity },
    });
    const passKindsAfter = bridge.callOrder.filter(
      (e) => e.kind === "WP19_RECONCILIATION_PASS",
    ).length;
    expect(passKindsAfter).toBeGreaterThan(passKindsBefore);
    expect(bridge.lastFullReconcileFillCount).toBe(1);
  });

  it("F: checkpoint_restore still triggers full reconciliation", () => {
    const bridge = seedMarkOnlyBridge();
    const passBefore = bridge.callOrder.filter((e) => e.kind === "WP19_RECONCILIATION_PASS").length;
    runAutomaticAccountingReconciliation(bridge, {
      phase: "checkpoint_restore",
      cycleIndex: 6,
      inventoryOpenQtyBySymbol: {},
    });
    const passAfter = bridge.callOrder.filter((e) => e.kind === "WP19_RECONCILIATION_PASS").length;
    expect(passAfter).toBe(passBefore + 1);
  });

  it("G: terminal export still triggers full reconciliation", () => {
    const bridge = seedMarkOnlyBridge();
    const passBefore = bridge.callOrder.filter((e) => e.kind === "WP19_RECONCILIATION_PASS").length;
    runAutomaticAccountingReconciliation(bridge, {
      phase: "before_terminal_export",
      cycleIndex: 7,
      inventoryOpenQtyBySymbol: {},
    });
    const passAfter = bridge.callOrder.filter((e) => e.kind === "WP19_RECONCILIATION_PASS").length;
    expect(passAfter).toBe(passBefore + 1);
  });

  it("H: reconciliation failure produces RECONCILIATION_FAILURE termination", () => {
    const bridge = seedMarkOnlyBridge();
    bridge.state.equity = "1";
    try {
      runAutomaticAccountingReconciliation(bridge, {
        phase: "before_guardian",
        cycleIndex: 8,
        inventoryOpenQtyBySymbol: {},
      });
      expect.unreachable("expected fail-closed");
    } catch (error) {
      expect(error).toBeInstanceOf(HtrAccountingReconciliationTerminationError);
    }
    expect(bridge.terminationCode).toBe("RECONCILIATION_FAILURE");
    expect(bridge.callOrder.some((e) => e.kind === "WP19_RECONCILIATION_FAIL")).toBe(true);
  });

  it("I: non-IDHPS mark-only still executes all three phases", () => {
    setIdhpsHotPathEnabled(false);
    const bridge = seedMarkOnlyBridge();
    const before = getIdhpsHotPathCounters().reconciliationCalls;
    for (const phase of PHASES) {
      runAutomaticAccountingReconciliation(bridge, {
        phase,
        cycleIndex: 9,
        inventoryOpenQtyBySymbol: {},
      });
    }
    expect(getIdhpsHotPathCounters().reconciliationCalls).toBe(before + 3);
    expect(bridge.runTerminated).toBe(false);
  });
});
