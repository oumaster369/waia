import { describe, expect, it } from "vitest";

import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import { computeAccountingSemanticDigest, createInitialAccountingState } from
  "@/lib/trader/accounting/canonical-cross-backend-accounting-engine";
import { commitHistoricalSimulationCyclePostgresV2, createHistoricalSimulationCommitRequestV2,
  createHistoricalSimulationModeledAtomicArtifactV2, validateHistoricalSimulationCommitRequestV2,
  validateHistoricalSimulationModeledAtomicArtifactV2,
  assertHistoricalSimulationLearningSnapshotTransitionV2,
  prepareHistoricalSimulationProductionPortsV2,
} from "@/lib/trader/historical-simulation-v2/atomic-cycle-repository-postgres-v2";
import {
  assertHistoricalSimulationResumeAtMembershipV2,
  commitHistoricalSimulationCycleAtomicallyV2,
  createHistoricalSimulationAtomicStageBundleV2,
  createHistoricalSimulationDurableStateSnapshotV2,
  HISTORICAL_SIMULATION_ATOMIC_STAGES_V2,
  loadValidatedHistoricalSimulationLedgerHeadV2,
  restoreHistoricalModeledExchangeOrdersV2,
  validateHistoricalSimulationDurableStateSnapshotV2,
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
import { loadHistoricalSimulationInceptionAccountingV2, restoreHistoricalSimulationProductionRuntimeStateV2,
  snapshotHistoricalSimulationProductionRuntimeStateV2 } from
  "@/lib/trader/historical-simulation-v2/production-runtime-state-v2";

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
    accountId: scope.accountId,
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

function snapshots(cycleId: string, sequence: number) {
  const identity = { ...scope, cycleId };
  const accountingBody = {
    schemaVersion: "htr-accounting-frontier/v1" as const, engineId: "CANONICAL_CROSS_BACKEND_ACCOUNTING_ENGINE_V1" as const,
    basisMethod: "DUAL_GROSS_NET_WEIGHTED_AVERAGE_BASIS_V1" as const, organizationId: scope.organizationId,
    accountKey: scope.accountId, runId: scope.runId, accountingSequence: sequence,
    frontierAsOf: new Date(1_700_000_000_000 + sequence * 60_000).toISOString(), monthKey: "2023-11",
    cash: "1000.00000000", positions: {}, grossRealizedPnl: "0.00000000", netRealizedPnl: "0.00000000",
    marks: {}, markedPositionValue: "0.00000000", equity: "1000.00000000", equityHwm: "1000.00000000",
    accountDrawdownBps: 0, consumedFillIds: [], id: `frontier-${sequence}`, sourceFillId: null,
    sourceEconomicsDigest: D, idempotencyKey: `frontier-${sequence}`,
  };
  const accounting = { ...accountingBody, semanticContentDigest: computeAccountingSemanticDigest(accountingBody) };
  return {
    knowledgeSnapshot: createHistoricalSimulationDurableStateSnapshotV2({
      ...identity, stateKind: "KNOWLEDGE", state: {
        checkpointSequence: sequence, checkpointContentDigestHex: "b".repeat(64),
        knowledgeContentDigestHex: "c".repeat(64),
        visibleThroughPitAnchor: new Date(1_700_000_000_000 + sequence * 60_000).toISOString(),
      },
    }),
    modeledExecutionRegistrySnapshot: createHistoricalSimulationDurableStateSnapshotV2({
      ...identity, stateKind: "MODELED_EXECUTION_REGISTRY", state: { receipts: [] },
    }),
    modeledExchangeSnapshot: createHistoricalSimulationDurableStateSnapshotV2({
      ...identity, stateKind: "MODELED_EXCHANGE", state: { checkpoint: {
        schemaVersion: "htr-wp17-execution-checkpoint/v1", openOrders: [],
        executionModelSchemaVersion: "waia.trader.historical-execution-model.v1",
      }, openOrders: [] },
    }),
    accountingFrontierSnapshot: createHistoricalSimulationDurableStateSnapshotV2({
      ...identity, stateKind: "ACCOUNTING_FRONTIER", state: accounting,
    }),
    guardianSnapshot: createHistoricalSimulationDurableStateSnapshotV2({
      ...identity, stateKind: "GUARDIAN", state: { posture: "NONE", assessmentContentDigestHex: D,
        assessedAt: new Date(1_700_000_000_000 + sequence * 60_000).toISOString() },
    }),
    learningSnapshot: createHistoricalSimulationDurableStateSnapshotV2({
      ...identity, stateKind: "LEARNING", state: {
        appliedClosureWatermarkUtc: null, pendingForecastAuthorityContentDigestHexes: [],
      },
    }),
  };
}

function stageBundles(cycleId: string, ledgerEntryContentDigestHex: string) {
  const kinds = {
    FORECAST_LIFECYCLE: "FORECAST_ISSUANCE", CANONICAL_VERIFICATION: "CANONICAL_VERIFICATION_RECEIPT",
    MODELED_RISK: "MODELED_RISK_VERDICT", MODELED_EXECUTION: "MODELED_EXECUTION_SUBMISSION",
    OBSERVED_EXECUTION_EFFECTS: "MODELED_EXECUTION_EFFECT", ACCOUNTING: "ACCOUNTING_FRONTIER",
    GUARDIAN: "GUARDIAN_ASSESSMENT", KNOWLEDGE: "KNOWLEDGE_CHECKPOINT", LEARNING: "LEARNING_UPDATE",
  } as const;
  return Object.fromEntries(HISTORICAL_SIMULATION_ATOMIC_STAGES_V2.map((stage) => [stage,
    createHistoricalSimulationAtomicStageBundleV2({ ...scope, stage, cycleId, ledgerEntryContentDigestHex,
      artifacts: [{ artifactKind: kinds[stage], artifactId: `${cycleId}:${stage}`,
        contentDigestHex: stage === "KNOWLEDGE" ? "b".repeat(64) : D }] }),
  ])) as Parameters<typeof commitHistoricalSimulationCycleAtomicallyV2>[0]["stageBundles"];
}

async function commit(repository: HistoricalSimulationAtomicCycleRepositoryV2, entry: HistoricalSimulationReasonLedgerV2) {
  return commitHistoricalSimulationCycleAtomicallyV2({
    repository, scope, ledgerEntry: entry,
    stageBundles: stageBundles(entry.cycleId, entry.contentDigestHex),
    knowledgeCheckpointSequence: entry.cycleSequence,
    knowledgeCheckpointContentDigestHex: "b".repeat(64),
    ...snapshots(entry.cycleId, entry.cycleSequence),
  });
}

describe("Historical Simulation V2 atomic cycle commit and durable resume foundation", () => {
  it("prepares inception ports with null cursor on the exact transaction before producer composition", async () => {
    const first = ledger(0, null); const bundles = stageBundles(first.cycleId, first.contentDigestHex);
    const persisted = snapshots(first.cycleId, 0);
    const request = createHistoricalSimulationCommitRequestV2({ ...scope, cycleSequence: 0, cycleId: first.cycleId,
      replayBarClosedAtUtc: first.replayBarClosedAtUtc, datasetMembership: first.datasetMembership,
      datasetMembershipContentDigestHex: first.datasetMembership.contentDigestHex,
      forecastInputAuthorityContentDigestHex: "1".repeat(64), policyConfigContentDigestHex: "2".repeat(64),
      codeSha: "3".repeat(40), ledgerEntryContentDigestHex: first.contentDigestHex,
      stageBundleDigestHexByStage: Object.fromEntries(HISTORICAL_SIMULATION_ATOMIC_STAGES_V2.map((stage) =>
        [stage, bundles[stage].contentDigestHex])) as HistoricalSimulationResumeCursorV2["cycleStageBundleDigestHexByStage"],
      snapshotContentDigestHexByKind: { KNOWLEDGE: persisted.knowledgeSnapshot.contentDigestHex,
        MODELED_EXECUTION_REGISTRY: persisted.modeledExecutionRegistrySnapshot.contentDigestHex,
        MODELED_EXCHANGE: persisted.modeledExchangeSnapshot.contentDigestHex,
        ACCOUNTING_FRONTIER: persisted.accountingFrontierSnapshot.contentDigestHex,
        GUARDIAN: persisted.guardianSnapshot.contentDigestHex, LEARNING: persisted.learningSnapshot.contentDigestHex } });
    const tx = (async () => []) as unknown as import("postgres").Sql;
    const prepared = await prepareHistoricalSimulationProductionPortsV2({ tx, request, scope,
      createPorts(receivedTx, previousCursor) { return { receivedTx, previousCursor }; } });
    expect(prepared.previousCursor).toBeNull();
    expect(prepared.ports).toEqual({ receivedTx: tx, previousCursor: null });
  });

  it("loads and passes the exact validated six-snapshot resume cursor before composing ports", async () => {
    const first = ledger(0, null); const bundles = stageBundles(first.cycleId, first.contentDigestHex);
    const persisted = await commit(inMemoryRepository().repository, first);
    const nextMembership = membership(1, "cycle-1");
    const request = createHistoricalSimulationCommitRequestV2({ ...scope, cycleSequence: 1, cycleId: "cycle-1",
      replayBarClosedAtUtc: "2026-01-01T00:02:00.000Z", datasetMembership: nextMembership,
      datasetMembershipContentDigestHex: nextMembership.contentDigestHex,
      forecastInputAuthorityContentDigestHex: "1".repeat(64), policyConfigContentDigestHex: "2".repeat(64),
      codeSha: "3".repeat(40), ledgerEntryContentDigestHex: "4".repeat(64),
      stageBundleDigestHexByStage: persisted.cycleStageBundleDigestHexByStage,
      snapshotContentDigestHexByKind: { KNOWLEDGE: persisted.knowledgeSnapshot.contentDigestHex,
        MODELED_EXECUTION_REGISTRY: persisted.modeledExecutionRegistrySnapshot.contentDigestHex,
        MODELED_EXCHANGE: persisted.modeledExchangeSnapshot.contentDigestHex,
        ACCOUNTING_FRONTIER: persisted.accountingFrontierSnapshot.contentDigestHex,
        GUARDIAN: persisted.guardianSnapshot.contentDigestHex, LEARNING: persisted.learningSnapshot.contentDigestHex } });
    const events: string[] = [];
    const query = async (strings: TemplateStringsArray) => {
      const text = strings.join("?"); events.push(text.includes("resume_checkpoint_v2") ? "checkpoint" :
        text.includes("resume_stage_link_v2") ? "stages" : text.includes("resume_snapshot_link_v2") ? "snapshots" : "query");
      if (text.includes("SELECT checkpoint_json, committed_cycle_sequence")) return [{ checkpoint_json: persisted,
        committed_cycle_sequence: 0 }];
      if (text.includes("resume_stage_link_v2 l")) return HISTORICAL_SIMULATION_ATOMIC_STAGES_V2.map((stage) => ({
        stage, bundle_content_digest_hex: bundles[stage].contentDigestHex, cycle_id: first.cycleId,
        ledger_entry_content_digest_hex: first.contentDigestHex, artifacts_json: bundles[stage].artifacts }));
      if (text.includes("resume_snapshot_link_v2 l")) {
        const values = { KNOWLEDGE: persisted.knowledgeSnapshot,
          MODELED_EXECUTION_REGISTRY: persisted.modeledExecutionRegistrySnapshot,
          MODELED_EXCHANGE: persisted.modeledExchangeSnapshot, ACCOUNTING_FRONTIER: persisted.accountingFrontierSnapshot,
          GUARDIAN: persisted.guardianSnapshot, LEARNING: persisted.learningSnapshot } as const;
        return Object.entries(values).map(([state_kind, snapshot]) => ({ state_kind,
          snapshot_content_digest_hex: snapshot.contentDigestHex, state_json: snapshot.state }));
      }
      return [];
    };
    const tx = ((strings: TemplateStringsArray) => query(strings)) as unknown as import("postgres").Sql;
    const prepared = await prepareHistoricalSimulationProductionPortsV2({ tx, request, scope,
      createPorts(receivedTx, previousCursor) { events.push("createPorts"); return { receivedTx, previousCursor }; } });
    expect(events).toEqual(["checkpoint", "stages", "snapshots", "createPorts"]);
    expect(prepared.previousCursor).toEqual(persisted);
    expect(prepared.ports.receivedTx).toBe(tx);
    expect(prepared.ports.previousCursor).toBe(prepared.previousCursor);
    expect([prepared.previousCursor?.knowledgeSnapshot, prepared.previousCursor?.modeledExecutionRegistrySnapshot,
      prepared.previousCursor?.modeledExchangeSnapshot, prepared.previousCursor?.accountingFrontierSnapshot,
      prepared.previousCursor?.guardianSnapshot, prepared.previousCursor?.learningSnapshot])
      .toEqual([persisted.knowledgeSnapshot, persisted.modeledExecutionRegistrySnapshot,
        persisted.modeledExchangeSnapshot, persisted.accountingFrontierSnapshot,
        persisted.guardianSnapshot, persisted.learningSnapshot]);
  });
  it("restores all mutable production runtime components from the exact durable cursor", async () => {
    const first = ledger(0, null);
    const persisted = await commit(inMemoryRepository().repository, first);
    const runtime = restoreHistoricalSimulationProductionRuntimeStateV2({ scope, cursor: persisted });
    expect(runtime.model.schemaVersion).toBe("waia.trader.historical-execution-model.v1");
    expect(runtime.executionReceipts).toEqual([]);
    expect(runtime.exchange.listOpenOrders()).toEqual([]);
    expect(runtime.accounting.semanticContentDigest)
      .toBe((persisted.accountingFrontierSnapshot.state as { semanticContentDigest: string }).semanticContentDigest);
    expect(runtime.knowledge).toEqual(persisted.knowledgeSnapshot.state);
    expect(runtime.guardian).toEqual(persisted.guardianSnapshot.state);
    expect(runtime.learning).toEqual(persisted.learningSnapshot.state);
    const roundTrip = snapshotHistoricalSimulationProductionRuntimeStateV2({ scope,
      cycleId: persisted.committedCycleId, runtime });
    expect(roundTrip).toEqual({ knowledgeSnapshot: persisted.knowledgeSnapshot,
      modeledExecutionRegistrySnapshot: persisted.modeledExecutionRegistrySnapshot,
      modeledExchangeSnapshot: persisted.modeledExchangeSnapshot,
      accountingFrontierSnapshot: persisted.accountingFrontierSnapshot,
      guardianSnapshot: persisted.guardianSnapshot, learningSnapshot: persisted.learningSnapshot });
  });
  it("loads deterministic inception accounting only through its exact 0187 authority identity", async () => {
    const inception = createInitialAccountingState({ organizationId: scope.organizationId, accountKey: scope.accountId,
      runId: scope.runId, startingCash: "1000.00000000", frontierAsOf: "2023-11-14T22:14:20.000Z" });
    const accounting = { ...inception, id: "00000000-0000-4000-8000-000000000007", sourceFillId: null,
      sourceEconomicsDigest: D, semanticContentDigest: computeAccountingSemanticDigest(inception),
      idempotencyKey: "frontier-inception" } as Record<string, unknown>;
    const bundle = { schemaVersion: "waia.trader.dee659_authority_preregistration.v2",
      initialAccountingIdentity: { id: accounting.id, semanticContentDigest: accounting.semanticContentDigest } };
    const bundleDigest = computeStableJsonDigest(bundle);
    const row = { authority_bundle_json: bundle, authority_bundle_digest_hex: bundleDigest,
      id: accounting.id, organization_id: accounting.organizationId, account_key: accounting.accountKey,
      run_id: accounting.runId, accounting_sequence: 1, frontier_as_of: accounting.frontierAsOf,
      cash: accounting.cash, position_quantity_json: {}, gross_position_basis_json: {}, net_position_basis_json: {},
      gross_realized_pnl: accounting.grossRealizedPnl, net_realized_pnl: accounting.netRealizedPnl, marks_json: {},
      equity: accounting.equity, equity_hwm: accounting.equityHwm, account_drawdown_bps: 0, source_fill_id: null,
      source_economics_digest: accounting.sourceEconomicsDigest,
      semantic_content_digest: accounting.semanticContentDigest, idempotency_key: accounting.idempotencyKey,
      schema_version: accounting.schemaVersion };
    const tx = (async () => [row]) as unknown as import("postgres").Sql;
    const loaded = await loadHistoricalSimulationInceptionAccountingV2({ tx, scope,
      preregistrationId: "00000000-0000-4000-8000-000000000009",
      expectedAuthorityBundleContentDigestHex: bundleDigest });
    expect(loaded).toEqual(accounting);
    const changed = (async () => [{ ...row, cash: "999.00000000" }]) as unknown as import("postgres").Sql;
    await expect(loadHistoricalSimulationInceptionAccountingV2({ tx: changed, scope,
      preregistrationId: "00000000-0000-4000-8000-000000000009",
      expectedAuthorityBundleContentDigestHex: bundleDigest })).rejects.toThrow("INCEPTION_ACCOUNTING");
  });
  it("content-addresses every immutable commit input and full modeled payload", () => {
    const first = ledger(0, null);
    const bundles = stageBundles(first.cycleId, first.contentDigestHex);
    const persistedInput = snapshots(first.cycleId, first.cycleSequence);
    const request = createHistoricalSimulationCommitRequestV2({ ...scope, cycleSequence: 0, cycleId: first.cycleId,
      replayBarClosedAtUtc: first.replayBarClosedAtUtc,
      datasetMembership: first.datasetMembership, datasetMembershipContentDigestHex: first.datasetMembership.contentDigestHex,
      forecastInputAuthorityContentDigestHex: "1".repeat(64), policyConfigContentDigestHex: "2".repeat(64),
      codeSha: "3".repeat(40), ledgerEntryContentDigestHex: first.contentDigestHex,
      stageBundleDigestHexByStage: Object.fromEntries(HISTORICAL_SIMULATION_ATOMIC_STAGES_V2.map((stage) =>
        [stage, bundles[stage].contentDigestHex])) as HistoricalSimulationResumeCursorV2["cycleStageBundleDigestHexByStage"],
      snapshotContentDigestHexByKind: { KNOWLEDGE: persistedInput.knowledgeSnapshot.contentDigestHex,
        MODELED_EXECUTION_REGISTRY: persistedInput.modeledExecutionRegistrySnapshot.contentDigestHex,
        MODELED_EXCHANGE: persistedInput.modeledExchangeSnapshot.contentDigestHex,
        ACCOUNTING_FRONTIER: persistedInput.accountingFrontierSnapshot.contentDigestHex,
        GUARDIAN: persistedInput.guardianSnapshot.contentDigestHex,
        LEARNING: persistedInput.learningSnapshot.contentDigestHex },
    });
    for (const mutation of [
      { cycleId: "changed" }, { datasetMembershipContentDigestHex: "4".repeat(64) },
      { forecastInputAuthorityContentDigestHex: "5".repeat(64) }, { policyConfigContentDigestHex: "6".repeat(64) },
      { codeSha: "7".repeat(40) }, { ledgerEntryContentDigestHex: "8".repeat(64) },
    ]) expect(() => validateHistoricalSimulationCommitRequestV2({ ...request, ...mutation })).toThrow("COMMIT_REQUEST");
    const sourcePayload = { posture: "NONE" };
    const modeled = createHistoricalSimulationModeledAtomicArtifactV2({ artifactKind: "GUARDIAN_ASSESSMENT",
      artifactId: "guardian-0", ...scope, cycleId: first.cycleId, pitAnchor: first.replayBarClosedAtUtc,
      sourceContentDigestHex: computeSemanticSha256Hex(sourcePayload), sourcePayload });
    expect(modeled.sourcePayloadSemanticDigestHex).toBe(computeSemanticSha256Hex(sourcePayload));
    expect(modeled.contentDigestHex).toMatch(/^[0-9a-f]{64}$/);
    expect(validateHistoricalSimulationModeledAtomicArtifactV2(scope, first.cycleId, {
      artifactKind: modeled.artifactKind, artifactId: modeled.artifactId,
      contentDigestHex: modeled.contentDigestHex, payload: modeled,
    })).toEqual(modeled);
    expect(() => validateHistoricalSimulationModeledAtomicArtifactV2(scope, first.cycleId, {
      artifactKind: modeled.artifactKind, artifactId: modeled.artifactId,
      contentDigestHex: modeled.contentDigestHex,
      payload: { ...modeled, sourceContentDigestHex: "9".repeat(64) },
    })).toThrow("MODELED_ARTIFACT_PAYLOAD");
    const learningSnapshot = persistedInput.learningSnapshot;
    const learning = createHistoricalSimulationModeledAtomicArtifactV2({ artifactKind: "LEARNING_UPDATE",
      artifactId: "learning-0", ...scope, cycleId: first.cycleId, pitAnchor: first.replayBarClosedAtUtc,
      sourceContentDigestHex: computeSemanticSha256Hex({ status: "NO_UPDATE", previousState: null,
        nextState: learningSnapshot.state }),
      sourcePayload: { status: "NO_UPDATE", previousState: null, nextState: learningSnapshot.state }, lineagePayload: {
        previousSnapshotContentDigestHex: null, nextSnapshotContentDigestHex: learningSnapshot.contentDigestHex,
        previousState: null, nextState: learningSnapshot.state,
      } });
    expect(() => assertHistoricalSimulationLearningSnapshotTransitionV2({
      previousSnapshot: null, nextSnapshot: learningSnapshot,
      artifacts: [{ ...learning, lineagePayload: { ...learning.lineagePayload, nextState: {
        ...learningSnapshot.state, pendingForecastAuthorityContentDigestHexes: ["9".repeat(64)],
      } } }],
    })).toThrow("LEARNING_SNAPSHOT_TRANSITION");
  });
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
      const recomputedAfterRollback = ledger(0, null);
      expect(recomputedAfterRollback.entryId).toBe(first.entryId);
      expect(recomputedAfterRollback.contentDigestHex).toBe(first.contentDigestHex);
      await expect(commit(retry.repository, recomputedAfterRollback)).resolves.toMatchObject({ nextCycleSequence: 1 });
      expect(retry.durable.ledger).toEqual([first]);
    },
  );

  it("returns the durable cursor on an exact retry and rejects a changed sealed dataset authority", async () => {
    const memory = inMemoryRepository();
    const first = ledger(0, null);
    const cursor = await commit(memory.repository, first);
    await expect(commit(memory.repository, ledger(0, null))).resolves.toEqual(cursor);
    expect(() => assertHistoricalSimulationResumeAtMembershipV2({
      cursor, scope, membership: { ...membership(1), partitionDigestHex: "f".repeat(64) },
    })).toThrow("DATASET_MEMBERSHIP");
    expect(memory.durable.ledger).toEqual([first]);
  });

  it("restores an outstanding modeled order and produces the identical next-bar fill", async () => {
    const openOrder = { orderId: "order-1", acceptedAtTs: 1_700_000_000_000,
      firstEligibleTs: 1_700_000_060_000, windowEndBarIndex: 3, sameSymbolEligibleBarsSeen: 0,
      remainingQty: "1.00000000", filledQty: "0.00000000", fillSequence: 0 };
    const durableOrderBody = { id: "order-1", organizationId: scope.organizationId, credentialId: null,
      venue: "HTX", executionMode: "paper" as const, symbol: "BTCUSDT", side: "buy" as const,
      type: "market" as const, price: null, quantity: "1.00000000", filledQuantity: "0.00000000",
      avgFillPrice: null, state: "ACCEPTED" as const, stateVersion: 1, exchangeOrderId: null,
      clientOrderId: "order-1", idempotencyKey: "order-1", riskDecisionId: "risk-1",
      strategySignalId: null, allocationDecisionId: null,
      createdAt: "2023-11-14T22:13:20.000Z", updatedAt: "2023-11-14T22:13:20.000Z" };
    const durableOrder = { ...durableOrderBody, contentDigestHex: computeSemanticSha256Hex(durableOrderBody) };
    const executionPlanContentDigestHex = computeSemanticSha256Hex({
      schemaVersion: "waia.trader.historical_modeled_execution_plan.v2", source: "MODELED_HISTORICAL",
      capitalEligible: false, executionPlanId: "plan-1", decisionId: "decision-1",
      decisionContentDigestHex: D, riskReceiptContentDigestHex: D,
      symbol: "BTCUSDT", side: "buy", quantity: "1.00000000",
    });
    const executionAttemptContentDigestHex = computeSemanticSha256Hex({
      schemaVersion: "waia.trader.historical_modeled_execution_attempt.v2", source: "MODELED_HISTORICAL",
      capitalEligible: false, executionAttemptId: "attempt-1", executionPlanId: "plan-1",
      executionPlanContentDigestHex, acceptedAtUtc: "2023-11-14T22:13:20.000Z",
    });
    const receiptBody = { source: "MODELED_HISTORICAL" as const, capitalEligible: false as const,
      schemaVersion: "waia.trader.historical_modeled_execution.v2" as const,
      executionPlanId: "plan-1", executionPlanContentDigestHex,
      executionAttemptId: "attempt-1", executionAttemptContentDigestHex, orderId: "order-1",
      orderContentDigestHex: computeSemanticSha256Hex({ schemaVersion: "waia.trader.historical_modeled_order.v2",
        source: "MODELED_HISTORICAL", capitalEligible: false, orderId: "order-1",
        executionAttemptId: "attempt-1", executionAttemptContentDigestHex,
        decisionContentDigestHex: D, symbol: "BTCUSDT", side: "buy", quantity: "1.00000000" }),
      decisionId: "decision-1",
      decisionContentDigestHex: D, riskVerdictId: "risk-1", riskReceiptContentDigestHex: D, symbol: "BTCUSDT",
      side: "buy" as const, quantity: "1.00000000", decisionBarIndex: 0,
      acceptedAtUtc: "2023-11-14T22:13:20.000Z" };
    const receipt = { ...receiptBody, contentDigestHex: computeSemanticSha256Hex(receiptBody) };
    const first = ledger(0, null);
    const duplicateRegistry = createHistoricalSimulationDurableStateSnapshotV2({
      ...scope, cycleId: first.cycleId, stateKind: "MODELED_EXECUTION_REGISTRY",
      state: { receipts: [receipt, receipt] },
    });
    expect(() => validateHistoricalSimulationDurableStateSnapshotV2(duplicateRegistry,
      "MODELED_EXECUTION_REGISTRY")).toThrow("MODELED_EXECUTION_REGISTRY_STATE");
    const modeledExchangeSnapshot = createHistoricalSimulationDurableStateSnapshotV2({
      ...scope, cycleId: first.cycleId, stateKind: "MODELED_EXCHANGE", state: { checkpoint: {
        schemaVersion: "htr-wp17-execution-checkpoint/v1", openOrders: [openOrder],
        executionModelSchemaVersion: "waia.trader.historical-execution-model.v1",
      }, openOrders: [durableOrder] },
    });
    const memory = inMemoryRepository();
    const modeledExecutionRegistrySnapshot = createHistoricalSimulationDurableStateSnapshotV2({
      ...scope, cycleId: first.cycleId, stateKind: "MODELED_EXECUTION_REGISTRY", state: { receipts: [receipt] },
    });
    const cursor = await commitHistoricalSimulationCycleAtomicallyV2({
      repository: memory.repository, scope, ledgerEntry: first,
      stageBundles: stageBundles(first.cycleId, first.contentDigestHex), knowledgeCheckpointSequence: 0,
      knowledgeCheckpointContentDigestHex: "b".repeat(64), ...snapshots(first.cycleId, 0),
      modeledExchangeSnapshot, modeledExecutionRegistrySnapshot,
    });
    const advanceNextBar = (state: unknown) => {
      const restored = state as { checkpoint: { openOrders: typeof openOrder[] } };
      return restored.checkpoint.openOrders.map((order) => ({
        fillId: `${order.orderId}:${order.fillSequence + 1}`,
        quantity: order.remainingQty,
        barIndex: 1,
      }));
    };
    const uninterrupted = advanceNextBar(modeledExchangeSnapshot.state);
    const afterRestart = advanceNextBar(cursor.modeledExchangeSnapshot.state);
    expect(afterRestart).toEqual(uninterrupted);
    expect(afterRestart).toEqual([{ fillId: "order-1:1", quantity: "1.00000000", barIndex: 1 }]);
    const restoredOrders = restoreHistoricalModeledExchangeOrdersV2(
      cursor.modeledExchangeSnapshot as never, { ...scope, cycleId: first.cycleId });
    expect(restoredOrders.get("order-1")).toMatchObject({ id: "order-1", quantity: "1.00000000" });
    expect(restoredOrders.get("order-1")?.createdAt).toBeInstanceOf(Date);
    const productionRuntime = restoreHistoricalSimulationProductionRuntimeStateV2({ scope, cursor });
    expect(productionRuntime.executionRegistry.get("order-1")).toEqual(receipt);
    expect(productionRuntime.executionReceipts).toEqual([receipt]);
    expect(productionRuntime.exchange.listOpenOrders()).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(productionRuntime.exchange.buildCheckpointSlice()))).toEqual(
      (modeledExchangeSnapshot.state as { checkpoint: unknown }).checkpoint);
    const nonEmptyRoundTrip = snapshotHistoricalSimulationProductionRuntimeStateV2({ scope,
      cycleId: cursor.committedCycleId, runtime: productionRuntime });
    expect(nonEmptyRoundTrip.modeledExecutionRegistrySnapshot).toEqual(cursor.modeledExecutionRegistrySnapshot);
    expect(nonEmptyRoundTrip.modeledExchangeSnapshot).toEqual(cursor.modeledExchangeSnapshot);
    const inconsistentExchange = createHistoricalSimulationDurableStateSnapshotV2({
      ...scope, cycleId: first.cycleId, stateKind: "MODELED_EXCHANGE", state: { checkpoint: {
        schemaVersion: "htr-wp17-execution-checkpoint/v1", openOrders: [{ ...openOrder,
          remainingQty: "0.50000000" }], executionModelSchemaVersion: "waia.trader.historical-execution-model.v1",
      }, openOrders: [durableOrder] },
    });
    await expect(commitHistoricalSimulationCycleAtomicallyV2({
      repository: inMemoryRepository().repository, scope, ledgerEntry: first,
      stageBundles: stageBundles(first.cycleId, first.contentDigestHex), knowledgeCheckpointSequence: 0,
      knowledgeCheckpointContentDigestHex: "b".repeat(64), ...snapshots(first.cycleId, 0),
      modeledExchangeSnapshot: inconsistentExchange, modeledExecutionRegistrySnapshot,
    })).rejects.toThrow("EXCHANGE_REGISTRY_PARITY");
  });

  it("refuses a typed-stage substitution and an account splice before persistence", async () => {
    const first = ledger(0, null);
    expect(() => createHistoricalSimulationAtomicStageBundleV2({ ...scope, stage: "ACCOUNTING",
      cycleId: first.cycleId, ledgerEntryContentDigestHex: first.contentDigestHex,
      artifacts: [{ artifactKind: "GUARDIAN_ASSESSMENT", artifactId: "forged", contentDigestHex: D }],
    })).toThrow("ACCOUNTING_REQUIRED_ARTIFACT");
    const memory = inMemoryRepository();
    await expect(commitHistoricalSimulationCycleAtomicallyV2({ repository: memory.repository,
      scope: { ...scope, accountId: "another-account" }, ledgerEntry: first,
      stageBundles: stageBundles(first.cycleId, first.contentDigestHex), knowledgeCheckpointSequence: 0,
      knowledgeCheckpointContentDigestHex: "b".repeat(64), ...snapshots(first.cycleId, 0),
    })).rejects.toThrow("LEDGER_SCOPE");
    expect(memory.durable.ledger).toEqual([]);
  });

  it("deep-freezes durable state and refuses a forged accounting semantic digest", () => {
    const state = snapshots("cycle-0", 0).modeledExchangeSnapshot;
    expect(Object.isFrozen(state.state)).toBe(true);
    expect(Object.isFrozen((state.state as { checkpoint: object }).checkpoint)).toBe(true);
    const accounting = snapshots("cycle-0", 0).accountingFrontierSnapshot;
    const forged = createHistoricalSimulationDurableStateSnapshotV2({ ...scope, cycleId: "cycle-0",
      stateKind: "ACCOUNTING_FRONTIER", state: {
        ...(accounting.state as Record<string, unknown>), semanticContentDigest: D,
      },
    } as never);
    expect(() => validateHistoricalSimulationDurableStateSnapshotV2(forged, "ACCOUNTING_FRONTIER"))
      .toThrow("ACCOUNTING_STATE");
  });

  it("detects an exact committed retry before constructing ports or invoking producers", async () => {
    process.env.WAIA_RELEASE_SHA = "3".repeat(40);
    const first = ledger(0, null);
    const bundles = stageBundles(first.cycleId, first.contentDigestHex);
    const persisted = await commit(inMemoryRepository().repository, first);
    const request = createHistoricalSimulationCommitRequestV2({ ...scope, cycleSequence: 0, cycleId: first.cycleId,
      replayBarClosedAtUtc: first.replayBarClosedAtUtc,
      datasetMembership: first.datasetMembership, datasetMembershipContentDigestHex: first.datasetMembership.contentDigestHex,
      forecastInputAuthorityContentDigestHex: "1".repeat(64), policyConfigContentDigestHex: "2".repeat(64),
      codeSha: "3".repeat(40), ledgerEntryContentDigestHex: first.contentDigestHex,
      stageBundleDigestHexByStage: Object.fromEntries(HISTORICAL_SIMULATION_ATOMIC_STAGES_V2.map((stage) =>
        [stage, bundles[stage].contentDigestHex])) as typeof persisted.cycleStageBundleDigestHexByStage,
      snapshotContentDigestHexByKind: { KNOWLEDGE: persisted.knowledgeSnapshot.contentDigestHex,
        MODELED_EXECUTION_REGISTRY: persisted.modeledExecutionRegistrySnapshot.contentDigestHex,
        MODELED_EXCHANGE: persisted.modeledExchangeSnapshot.contentDigestHex,
        ACCOUNTING_FRONTIER: persisted.accountingFrontierSnapshot.contentDigestHex,
        GUARDIAN: persisted.guardianSnapshot.contentDigestHex, LEARNING: persisted.learningSnapshot.contentDigestHex },
    });
    const query = async (strings: TemplateStringsArray) => {
      const text = strings.join("?");
      if (text.includes("FROM trader_dee659_authority_preregistration_v2")) return [{
        authority_bundle_digest_hex: request.forecastInputAuthorityContentDigestHex,
        policy_config_digest_hex: request.policyConfigContentDigestHex,
        membership_content_digest_hex: request.datasetMembershipContentDigestHex,
        membership_json: request.datasetMembership,
        verifier_code_digest_hex: computeStableJsonDigest({
          verifierVersion: "historical-simulation-v2-canonical-verifier/1", releaseSha: process.env.WAIA_RELEASE_SHA,
        }),
      }];
      if (text.includes("commit_request_digest_hex,commit_request_json")) return [{ checkpoint_json: persisted,
        commit_request_digest_hex: request.contentDigestHex, commit_request_json: request, committed_cycle_id: first.cycleId,
        committed_cycle_sequence: 0, ledger_head_content_digest_hex: first.contentDigestHex }];
      if (text.includes("SELECT checkpoint_json, committed_cycle_sequence")) {
        return [{ checkpoint_json: persisted, committed_cycle_sequence: 0 }];
      }
      if (text.includes("resume_stage_link_v2 l")) return HISTORICAL_SIMULATION_ATOMIC_STAGES_V2.map((stage) => ({
        stage, bundle_content_digest_hex: bundles[stage].contentDigestHex, cycle_id: first.cycleId,
        ledger_entry_content_digest_hex: first.contentDigestHex, artifacts_json: bundles[stage].artifacts,
      }));
      if (text.includes("resume_snapshot_link_v2 l")) {
        const values = { KNOWLEDGE: persisted.knowledgeSnapshot,
          MODELED_EXECUTION_REGISTRY: persisted.modeledExecutionRegistrySnapshot,
          MODELED_EXCHANGE: persisted.modeledExchangeSnapshot, ACCOUNTING_FRONTIER: persisted.accountingFrontierSnapshot,
          GUARDIAN: persisted.guardianSnapshot, LEARNING: persisted.learningSnapshot } as const;
        return Object.entries(values).map(([state_kind, snapshot]) => ({ state_kind,
          snapshot_content_digest_hex: snapshot.contentDigestHex, state_json: snapshot.state }));
      }
      return [];
    };
    const fake = ((strings: TemplateStringsArray) => query(strings)) as unknown as import("postgres").Sql;
    type FakeSqlExtensions = {
      begin: (_level: string, callback: (sql: import("postgres").Sql) => Promise<unknown>) => Promise<unknown>;
      reserve: () => Promise<import("postgres").Sql>;
      release: () => void;
    };
    (fake as unknown as FakeSqlExtensions).begin = async (_level, callback) => callback(fake);
    (fake as unknown as FakeSqlExtensions).reserve = async () => {
      (fake as unknown as FakeSqlExtensions).release = () => undefined;
      return fake;
    };
    let portsCreated = 0;
    let produced = 0;
    const result = await commitHistoricalSimulationCyclePostgresV2({ sql: fake, scope,
      request,
      createPorts() { portsCreated += 1; return {}; },
      async produce() { produced += 1; throw new Error("must not run"); },
    });
    expect(result).toEqual(persisted);
    expect({ portsCreated, produced }).toEqual({ portsCreated: 0, produced: 0 });
    const { schemaVersion: _schemaVersion, contentDigestHex: _contentDigestHex, ...requestSeed } = request;
    await expect(commitHistoricalSimulationCyclePostgresV2({ sql: fake, scope,
      request: createHistoricalSimulationCommitRequestV2({ ...requestSeed,
        policyConfigContentDigestHex: "8".repeat(64) }), createPorts: () => ({}),
      async produce() { throw new Error("must not run"); },
    })).rejects.toThrow("AMBIGUOUS_RETRY");
  });
});
