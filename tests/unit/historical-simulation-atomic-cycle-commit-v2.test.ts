import { describe, expect, it } from "vitest";

import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  assertHistoricalSimulationResumeAtMembershipV2,
  commitHistoricalSimulationCycleAtomicallyV2,
  createHistoricalSimulationAtomicStageBundleV2,
  createHistoricalSimulationDurableStateSnapshotV2,
  HISTORICAL_SIMULATION_ATOMIC_STAGES_V2,
  loadValidatedHistoricalSimulationLedgerHeadV2,
  type HistoricalSimulationAtomicCycleRepositoryV2,
  type HistoricalSimulationAtomicCycleTransactionV2,
  type HistoricalSimulationAtomicScopeV2,
  type HistoricalSimulationResumeCursorV2,
  type HistoricalSimulationAtomicStageBundleV2,
} from "@/lib/trader/historical-simulation-v2/atomic-cycle-commit-v2";
import {
  HISTORICAL_DATASET_MEMBERSHIP_V2,
  type HistoricalDatasetMembershipV2,
} from "@/lib/trader/historical-simulation-v2/dataset-membership-v2";
import {
  createHistoricalSimulationReasonLedgerV2,
  type HistoricalSimulationReasonLedgerV2,
} from "@/lib/trader/historical-simulation-v2/reason-ledger-v2";

const D = "a".repeat(64);
const scope: HistoricalSimulationAtomicScopeV2 = Object.freeze({
  organizationId: "00000000-0000-4000-8000-000000000001",
  runId: "run-atomic-v2",
  accountId: "account-1",
  split: "DEVELOPMENT",
});

function membership(index: number, cycleId = `cycle-${index}`): HistoricalDatasetMembershipV2 {
  const body = {
    schemaVersion: HISTORICAL_DATASET_MEMBERSHIP_V2,
    organizationId: scope.organizationId,
    cycleId,
    manifestSemanticDigestHex: "1".repeat(64),
    sealReceiptDigestHex: "2".repeat(64),
    partitionDigestHex: "3".repeat(64),
    partitionRawSha256Hex: "4".repeat(64),
    partition: "DEVELOPMENT" as const,
    symbol: "BTCUSDT" as const,
    recordIndex: index,
    barContentDigestHex: "5".repeat(64),
    sealedCycleContentDigestHex: "6".repeat(64),
  };
  return Object.freeze({ ...body, contentDigestHex: computeSemanticSha256Hex(body) });
}

function ledger(index: number, previous: HistoricalSimulationReasonLedgerV2 | null) {
  const cycleId = `cycle-${index}`;
  return createHistoricalSimulationReasonLedgerV2({
    organizationId: scope.organizationId,
    runId: scope.runId,
    cycleId,
    cycleSequence: index,
    symbol: "BTC/USDT",
    partition: "DEVELOPMENT",
    replayBarClosedAtUtc: new Date(1_700_000_000_000 + index * 60_000).toISOString(),
    datasetMembership: membership(index, cycleId),
    previousContentDigestHex: previous?.contentDigestHex ?? null,
    forecast: { status: "NON_ACTIONABLE", reasonCodes: ["NO_EDGE"], authorityContentDigestHex: null },
    decision: {
      status: "CASH", reasonCodes: ["NO_EDGE"], decisionContentDigestHex: D,
      whyNotCashReceiptDigestHex: D, evLower: null, evBase: null, evUpper: null,
    },
    portfolio: { status: "NO_PROPOSAL", reasonCodes: ["CASH"], proposalContentDigestHex: D },
    risk: {
      status: "NOT_EVALUATED", reasonCodes: ["CASH"], verdictContentDigestHex: null,
      allowanceContentDigestHex: null,
    },
    execution: {
      status: "NOT_DISPATCHED", reasonCodes: ["CASH"], planContentDigestHex: null,
      attemptContentDigestHex: null, reportContentDigestHex: null, fillContentDigestHexes: [],
    },
    observedExecutionEffects: [],
    accounting: { status: "UNCHANGED", reasonCodes: [], frontierContentDigestHex: D },
    guardian: { status: "NONE", reasonCodes: [], assessmentContentDigestHex: D },
    learning: {
      status: "NO_UPDATE", reasonCodes: ["NOT_MATURE"], calibrationObservationContentDigestHex: null,
      knowledgeUpdateContentDigestHex: null, eligibleResolutionAtUtc: null, visibleFromPitAnchorUtc: null,
    },
  });
}

type FailurePoint = "STAGE_AFTER_WRITE" | "APPEND_AFTER_WRITE" | "CURSOR_AFTER_WRITE" | null;

function inMemoryRepository(failurePoint: FailurePoint = null) {
  const durable: { ledger: HistoricalSimulationReasonLedgerV2[]; cursor: HistoricalSimulationResumeCursorV2 | null;
    stages: HistoricalSimulationAtomicStageBundleV2[] } = {
    ledger: [], cursor: null, stages: [],
  };
  const repository: HistoricalSimulationAtomicCycleRepositoryV2 = {
    async transaction<T>(callback: (tx: HistoricalSimulationAtomicCycleTransactionV2) => Promise<T>) {
      const staged = { ledger: [...durable.ledger], cursor: durable.cursor, stages: [...durable.stages] };
      const tx: HistoricalSimulationAtomicCycleTransactionV2 = {
        async loadLedgerChain() { return staged.ledger; },
        async loadResumeCursor() { return staged.cursor; },
        async persistStageBundle(bundle) {
          staged.stages.push(bundle);
          if (failurePoint === "STAGE_AFTER_WRITE") throw new Error("INJECTED_CRASH_AFTER_STAGE_WRITE");
        },
        async appendLedger(entry) {
          staged.ledger.push(entry);
          if (failurePoint === "APPEND_AFTER_WRITE") throw new Error("INJECTED_CRASH_AFTER_LEDGER_WRITE");
        },
        async saveResumeCursor(cursor) {
          staged.cursor = cursor;
          if (failurePoint === "CURSOR_AFTER_WRITE") throw new Error("INJECTED_CRASH_AFTER_CURSOR_WRITE");
        },
      };
      const result = await callback(tx);
      durable.ledger = staged.ledger;
      durable.cursor = staged.cursor;
      durable.stages = staged.stages;
      return result;
    },
  };
  return { durable, repository };
}

function snapshots() {
  return {
    knowledgeSnapshot: createHistoricalSimulationDurableStateSnapshotV2({
      stateKind: "KNOWLEDGE", state: { visibleUpdateIds: ["knowledge-1"] },
    }),
    modeledExecutionRegistrySnapshot: createHistoricalSimulationDurableStateSnapshotV2({
      stateKind: "MODELED_EXECUTION_REGISTRY", state: { orders: [] },
    }),
    modeledExchangeSnapshot: createHistoricalSimulationDurableStateSnapshotV2({
      stateKind: "MODELED_EXCHANGE", state: { openOrders: [] },
    }),
    accountingFrontierSnapshot: createHistoricalSimulationDurableStateSnapshotV2({
      stateKind: "ACCOUNTING_FRONTIER", state: { cash: "1000.00", positions: [] },
    }),
    guardianSnapshot: createHistoricalSimulationDurableStateSnapshotV2({
      stateKind: "GUARDIAN", state: { posture: "NONE" },
    }),
    learningSnapshot: createHistoricalSimulationDurableStateSnapshotV2({
      stateKind: "LEARNING", state: { closureWatermark: null },
    }),
  };
}

function stageBundles(cycleId: string) {
  return Object.fromEntries(HISTORICAL_SIMULATION_ATOMIC_STAGES_V2.map((stage) => [stage,
    createHistoricalSimulationAtomicStageBundleV2({ stage, cycleId, artifacts: [{ stage }] }),
  ])) as Parameters<typeof commitHistoricalSimulationCycleAtomicallyV2>[0]["stageBundles"];
}

async function commit(repository: HistoricalSimulationAtomicCycleRepositoryV2, entry: HistoricalSimulationReasonLedgerV2) {
  return commitHistoricalSimulationCycleAtomicallyV2({
    repository, scope, ledgerEntry: entry,
    stageBundles: stageBundles(entry.cycleId),
    knowledgeCheckpointSequence: entry.cycleSequence,
    knowledgeCheckpointContentDigestHex: "b".repeat(64),
    ...snapshots(),
  });
}

describe("Historical Simulation V2 atomic cycle commit and durable resume foundation", () => {
  it("atomically advances the exact ledger, dataset, knowledge, registry and accounting frontier", async () => {
    const memory = inMemoryRepository();
    const first = ledger(0, null);
    const cursor0 = await commit(memory.repository, first);
    expect(cursor0.nextCycleSequence).toBe(1);
    expect(cursor0.nextRecordIndex).toBe(1);
    expect(cursor0.ledgerHeadContentDigestHex).toBe(first.contentDigestHex);
    expect(loadValidatedHistoricalSimulationLedgerHeadV2(memory.durable.ledger, scope)).toEqual(first);

    const second = ledger(1, first);
    const cursor1 = await commit(memory.repository, second);
    expect(cursor1.nextCycleSequence).toBe(2);
    expect(memory.durable.ledger).toHaveLength(2);
    expect(() => assertHistoricalSimulationResumeAtMembershipV2({
      cursor: cursor1, scope, membership: membership(2),
    })).not.toThrow();
  });

  it.each(["STAGE_AFTER_WRITE", "APPEND_AFTER_WRITE", "CURSOR_AFTER_WRITE"] as const)(
    "rolls back every frontier after crash injection at %s and permits an exact retry",
    async (failurePoint) => {
      const crashed = inMemoryRepository(failurePoint);
      const first = ledger(0, null);
      await expect(commit(crashed.repository, first)).rejects.toThrow("INJECTED_CRASH");
      expect(crashed.durable.ledger).toEqual([]);
      expect(crashed.durable.cursor).toBeNull();
      expect(crashed.durable.stages).toEqual([]);

      const retry = inMemoryRepository();
      await expect(commit(retry.repository, first)).resolves.toMatchObject({ nextCycleSequence: 1 });
      expect(retry.durable.ledger).toEqual([first]);
    },
  );

  it("fails closed on a divergent sequence, cursor or sealed dataset authority", async () => {
    const memory = inMemoryRepository();
    const first = ledger(0, null);
    const cursor = await commit(memory.repository, first);
    await expect(commit(memory.repository, ledger(0, null))).rejects.toThrow("NEXT_SEQUENCE_OR_BINDING");
    expect(() => assertHistoricalSimulationResumeAtMembershipV2({
      cursor, scope, membership: { ...membership(1), partitionDigestHex: "f".repeat(64) },
    })).toThrow("DATASET_MEMBERSHIP");
    expect(memory.durable.ledger).toEqual([first]);
  });

  it("restores an outstanding modeled order and produces the identical next-bar fill", async () => {
    const openOrder = { orderId: "order-1", remainingQty: "1.00000000", firstEligibleBarIndex: 1 };
    const modeledExchangeSnapshot = createHistoricalSimulationDurableStateSnapshotV2({
      stateKind: "MODELED_EXCHANGE", state: { openOrders: [openOrder], fillSequence: 0 },
    });
    const memory = inMemoryRepository();
    const first = ledger(0, null);
    const cursor = await commitHistoricalSimulationCycleAtomicallyV2({
      repository: memory.repository, scope, ledgerEntry: first,
      stageBundles: stageBundles(first.cycleId), knowledgeCheckpointSequence: 0,
      knowledgeCheckpointContentDigestHex: "b".repeat(64), ...snapshots(), modeledExchangeSnapshot,
    });
    const advanceNextBar = (state: unknown) => {
      const restored = state as { openOrders: typeof openOrder[]; fillSequence: number };
      return restored.openOrders.map((order) => ({
        fillId: `${order.orderId}:${restored.fillSequence + 1}`,
        quantity: order.remainingQty,
        barIndex: order.firstEligibleBarIndex,
      }));
    };
    const uninterrupted = advanceNextBar(modeledExchangeSnapshot.state);
    const afterRestart = advanceNextBar(cursor.modeledExchangeSnapshot.state);
    expect(afterRestart).toEqual(uninterrupted);
    expect(afterRestart).toEqual([{ fillId: "order-1:1", quantity: "1.00000000", barIndex: 1 }]);
  });
});
