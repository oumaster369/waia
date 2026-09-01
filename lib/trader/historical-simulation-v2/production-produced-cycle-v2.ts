import {
  HISTORICAL_SIMULATION_ATOMIC_STAGES_V2,
  type HistoricalSimulationAtomicScopeV2,
  type HistoricalSimulationAtomicStageBundlesV2,
  type HistoricalSimulationDurableStateSnapshotV2,
} from "./atomic-cycle-commit-v2";
import { createHistoricalSimulationCommitRequestV2 } from "./atomic-cycle-repository-postgres-v2";
import { validateHistoricalSimulationReasonLedgerV2, type HistoricalSimulationReasonLedgerV2 } from "./reason-ledger-v2";

type Snapshots = Readonly<{
  knowledgeSnapshot: HistoricalSimulationDurableStateSnapshotV2<"KNOWLEDGE">;
  modeledExecutionRegistrySnapshot: HistoricalSimulationDurableStateSnapshotV2<"MODELED_EXECUTION_REGISTRY">;
  modeledExchangeSnapshot: HistoricalSimulationDurableStateSnapshotV2<"MODELED_EXCHANGE">;
  accountingFrontierSnapshot: HistoricalSimulationDurableStateSnapshotV2<"ACCOUNTING_FRONTIER">;
  guardianSnapshot: HistoricalSimulationDurableStateSnapshotV2<"GUARDIAN">;
  learningSnapshot: HistoricalSimulationDurableStateSnapshotV2<"LEARNING">;
}>;

/** Canonically closes produced bytes into the 0188 request; no digest is supplied by a caller. */
export function closeHistoricalSimulationProducedCycleV2(input: Readonly<{
  scope: HistoricalSimulationAtomicScopeV2;
  codeSha: string;
  forecastInputAuthorityContentDigestHex: string;
  policyConfigContentDigestHex: string;
  knowledgeCheckpointSequence: number;
  knowledgeCheckpointContentDigestHex: string;
  ledgerEntry: HistoricalSimulationReasonLedgerV2;
  stageBundles: HistoricalSimulationAtomicStageBundlesV2;
  snapshots: Snapshots;
}>): Readonly<{ request: ReturnType<typeof createHistoricalSimulationCommitRequestV2>;
  produced: Readonly<{ ledgerEntry: HistoricalSimulationReasonLedgerV2;
    knowledgeCheckpointSequence: number; knowledgeCheckpointContentDigestHex: string;
    stageBundles: HistoricalSimulationAtomicStageBundlesV2 } & Snapshots> }> {
  validateHistoricalSimulationReasonLedgerV2(input.ledgerEntry);
  const ledger = input.ledgerEntry;
  if (ledger.organizationId !== input.scope.organizationId || ledger.accountId !== input.scope.accountId ||
      ledger.runId !== input.scope.runId || ledger.datasetMembership.partition !== input.scope.split) {
    throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:PRODUCED_SCOPE");
  }
  for (const stage of HISTORICAL_SIMULATION_ATOMIC_STAGES_V2) {
    const bundle = input.stageBundles[stage];
    if (bundle.organizationId !== ledger.organizationId || bundle.accountId !== ledger.accountId ||
        bundle.runId !== ledger.runId || bundle.cycleId !== ledger.cycleId ||
        bundle.ledgerEntryContentDigestHex !== ledger.contentDigestHex) {
      throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:PRODUCED_STAGE_SCOPE");
    }
  }
  const snapshotByKind = { KNOWLEDGE: input.snapshots.knowledgeSnapshot,
    MODELED_EXECUTION_REGISTRY: input.snapshots.modeledExecutionRegistrySnapshot,
    MODELED_EXCHANGE: input.snapshots.modeledExchangeSnapshot,
    ACCOUNTING_FRONTIER: input.snapshots.accountingFrontierSnapshot,
    GUARDIAN: input.snapshots.guardianSnapshot, LEARNING: input.snapshots.learningSnapshot } as const;
  for (const snapshot of Object.values(snapshotByKind)) {
    if (snapshot.organizationId !== ledger.organizationId || snapshot.accountId !== ledger.accountId ||
        snapshot.runId !== ledger.runId || snapshot.cycleId !== ledger.cycleId) {
      throw new Error("HISTORICAL_SIMULATION_V2_PRODUCTION_REFUSED:PRODUCED_SNAPSHOT_SCOPE");
    }
  }
  const request = createHistoricalSimulationCommitRequestV2({ organizationId: ledger.organizationId,
    accountId: ledger.accountId, runId: ledger.runId, split: input.scope.split,
    cycleSequence: ledger.cycleSequence, cycleId: ledger.cycleId,
    replayBarClosedAtUtc: ledger.replayBarClosedAtUtc, datasetMembership: ledger.datasetMembership,
    datasetMembershipContentDigestHex: ledger.datasetMembership.contentDigestHex,
    forecastInputAuthorityContentDigestHex: input.forecastInputAuthorityContentDigestHex,
    policyConfigContentDigestHex: input.policyConfigContentDigestHex, codeSha: input.codeSha,
    ledgerEntryContentDigestHex: ledger.contentDigestHex,
    stageBundleDigestHexByStage: Object.fromEntries(HISTORICAL_SIMULATION_ATOMIC_STAGES_V2.map((stage) =>
      [stage, input.stageBundles[stage].contentDigestHex])) as never,
    snapshotContentDigestHexByKind: Object.fromEntries(Object.entries(snapshotByKind).map(([kind, snapshot]) =>
      [kind, snapshot.contentDigestHex])) as never });
  return Object.freeze({ request, produced: Object.freeze({ ledgerEntry: ledger,
    knowledgeCheckpointSequence: input.knowledgeCheckpointSequence,
    knowledgeCheckpointContentDigestHex: input.knowledgeCheckpointContentDigestHex,
    stageBundles: input.stageBundles, ...input.snapshots }) });
}
