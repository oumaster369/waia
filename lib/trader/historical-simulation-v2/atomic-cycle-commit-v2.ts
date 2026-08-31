import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type { HistoricalDatasetMembershipV2 } from "./dataset-membership-v2";
import {
  assertHistoricalSimulationReasonLedgerChainV2,
  validateHistoricalSimulationReasonLedgerV2,
  type HistoricalSimulationPreHoldoutPartitionV2,
  type HistoricalSimulationReasonLedgerV2,
} from "./reason-ledger-v2";

export const HISTORICAL_SIMULATION_DURABLE_STATE_SNAPSHOT_V2 =
  "waia.trader.historical_simulation_durable_state_snapshot.v2" as const;
export const HISTORICAL_SIMULATION_RESUME_CURSOR_V2 =
  "waia.trader.historical_simulation_resume_cursor.v2" as const;
export const HISTORICAL_SIMULATION_ATOMIC_STAGE_BUNDLE_V2 =
  "waia.trader.historical_simulation_atomic_stage_bundle.v2" as const;

const DIGEST = /^[0-9a-f]{64}$/;

export type HistoricalSimulationAtomicScopeV2 = Readonly<{
  organizationId: string;
  runId: string;
  accountId: string;
  split: HistoricalSimulationPreHoldoutPartitionV2;
}>;

export type HistoricalSimulationDurableStateSnapshotV2 = Readonly<{
  schemaVersion: typeof HISTORICAL_SIMULATION_DURABLE_STATE_SNAPSHOT_V2;
  stateKind: "KNOWLEDGE" | "MODELED_EXECUTION_REGISTRY" | "MODELED_EXCHANGE" |
    "ACCOUNTING_FRONTIER" | "GUARDIAN" | "LEARNING";
  state: unknown;
  contentDigestHex: string;
}>; 

export type HistoricalSimulationAtomicStageV2 =
  | "FORECAST_LIFECYCLE" | "CANONICAL_VERIFICATION" | "MODELED_RISK"
  | "MODELED_EXECUTION" | "OBSERVED_EXECUTION_EFFECTS" | "ACCOUNTING"
  | "GUARDIAN" | "KNOWLEDGE" | "LEARNING";

export const HISTORICAL_SIMULATION_ATOMIC_STAGES_V2 = Object.freeze([
  "FORECAST_LIFECYCLE", "CANONICAL_VERIFICATION", "MODELED_RISK", "MODELED_EXECUTION",
  "OBSERVED_EXECUTION_EFFECTS", "ACCOUNTING", "GUARDIAN", "KNOWLEDGE", "LEARNING",
] as const satisfies readonly HistoricalSimulationAtomicStageV2[]);

export type HistoricalSimulationAtomicStageBundleV2 = Readonly<{
  schemaVersion: typeof HISTORICAL_SIMULATION_ATOMIC_STAGE_BUNDLE_V2;
  stage: HistoricalSimulationAtomicStageV2;
  cycleId: string;
  artifacts: readonly unknown[];
  contentDigestHex: string;
}>;

export type HistoricalSimulationAtomicStageBundlesV2 = Readonly<Record<
  HistoricalSimulationAtomicStageV2,
  HistoricalSimulationAtomicStageBundleV2
>>;

export type HistoricalSimulationDatasetAuthorityV2 = Readonly<{
  manifestSemanticDigestHex: string;
  sealReceiptDigestHex: string;
  partitionDigestHex: string;
  partitionRawSha256Hex: string;
  split: HistoricalSimulationPreHoldoutPartitionV2;
  symbol: "BTCUSDT" | "ETHUSDT";
}>;

export type HistoricalSimulationResumeCursorV2 = Readonly<{
  schemaVersion: typeof HISTORICAL_SIMULATION_RESUME_CURSOR_V2;
  organizationId: string;
  runId: string;
  accountId: string;
  split: HistoricalSimulationPreHoldoutPartitionV2;
  datasetAuthority: HistoricalSimulationDatasetAuthorityV2;
  committedCycleId: string;
  committedReplayBarClosedAtUtc: string;
  nextRecordIndex: number;
  nextCycleSequence: number;
  ledgerHeadContentDigestHex: string;
  knowledgeCheckpointSequence: number;
  knowledgeCheckpointContentDigestHex: string;
  knowledgeSnapshot: HistoricalSimulationDurableStateSnapshotV2;
  modeledExecutionRegistrySnapshot: HistoricalSimulationDurableStateSnapshotV2;
  modeledExchangeSnapshot: HistoricalSimulationDurableStateSnapshotV2;
  accountingFrontierSnapshot: HistoricalSimulationDurableStateSnapshotV2;
  guardianSnapshot: HistoricalSimulationDurableStateSnapshotV2;
  learningSnapshot: HistoricalSimulationDurableStateSnapshotV2;
  contentDigestHex: string;
}>;

export type HistoricalSimulationAtomicCycleTransactionV2 = Readonly<{
  loadLedgerChain(scope: HistoricalSimulationAtomicScopeV2): Promise<readonly HistoricalSimulationReasonLedgerV2[]>;
  loadResumeCursor(scope: HistoricalSimulationAtomicScopeV2): Promise<HistoricalSimulationResumeCursorV2 | null>;
  /** Persists this stage through the same database transaction/connection as ledger and cursor. */
  persistStageBundle(bundle: HistoricalSimulationAtomicStageBundleV2): Promise<void>;
  appendLedger(entry: HistoricalSimulationReasonLedgerV2): Promise<void>;
  saveResumeCursor(cursor: HistoricalSimulationResumeCursorV2): Promise<void>;
}>;

/** Implementations must commit the callback's writes together or roll all of them back. */
export type HistoricalSimulationAtomicCycleRepositoryV2 = Readonly<{
  transaction<T>(callback: (tx: HistoricalSimulationAtomicCycleTransactionV2) => Promise<T>): Promise<T>;
}>;

function requireText(value: string, field: string): void {
  if (value.trim() === "") throw new Error(`HISTORICAL_SIMULATION_RESUME_REFUSED:${field}`);
}

function requireDigest(value: string, field: string): void {
  if (!DIGEST.test(value)) throw new Error(`HISTORICAL_SIMULATION_RESUME_REFUSED:${field}`);
}

function requireUtc(value: string, field: string): void {
  const epoch = Date.parse(value);
  if (!Number.isSafeInteger(epoch) || new Date(epoch).toISOString() !== value) {
    throw new Error(`HISTORICAL_SIMULATION_RESUME_REFUSED:${field}`);
  }
}

export function createHistoricalSimulationDurableStateSnapshotV2(input: Readonly<{
  stateKind: HistoricalSimulationDurableStateSnapshotV2["stateKind"];
  state: unknown;
}>): HistoricalSimulationDurableStateSnapshotV2 {
  const body = {
    schemaVersion: HISTORICAL_SIMULATION_DURABLE_STATE_SNAPSHOT_V2,
    stateKind: input.stateKind,
    state: input.state,
  };
  return Object.freeze({ ...body, contentDigestHex: computeSemanticSha256Hex(body) });
}

export function createHistoricalSimulationAtomicStageBundleV2(input: Readonly<{
  stage: HistoricalSimulationAtomicStageV2;
  cycleId: string;
  artifacts: readonly unknown[];
}>): HistoricalSimulationAtomicStageBundleV2 {
  requireText(input.cycleId, "stageBundle.cycleId");
  const body = {
    schemaVersion: HISTORICAL_SIMULATION_ATOMIC_STAGE_BUNDLE_V2,
    stage: input.stage,
    cycleId: input.cycleId,
    artifacts: input.artifacts,
  };
  return Object.freeze({ ...body, contentDigestHex: computeSemanticSha256Hex(body) });
}

function validateStageBundle(
  bundle: HistoricalSimulationAtomicStageBundleV2,
  expectedStage: HistoricalSimulationAtomicStageV2,
  cycleId: string,
): void {
  const { contentDigestHex, ...body } = bundle;
  if (bundle.schemaVersion !== HISTORICAL_SIMULATION_ATOMIC_STAGE_BUNDLE_V2 ||
      bundle.stage !== expectedStage || bundle.cycleId !== cycleId ||
      !DIGEST.test(contentDigestHex) || computeSemanticSha256Hex(body) !== contentDigestHex) {
    throw new Error(`HISTORICAL_SIMULATION_RESUME_REFUSED:${expectedStage}_STAGE_BUNDLE`);
  }
}

export function validateHistoricalSimulationDurableStateSnapshotV2(
  snapshot: HistoricalSimulationDurableStateSnapshotV2,
  expectedKind: HistoricalSimulationDurableStateSnapshotV2["stateKind"],
): void {
  const { contentDigestHex, ...body } = snapshot;
  if (snapshot.schemaVersion !== HISTORICAL_SIMULATION_DURABLE_STATE_SNAPSHOT_V2 ||
      snapshot.stateKind !== expectedKind || !DIGEST.test(contentDigestHex) ||
      computeSemanticSha256Hex(body) !== contentDigestHex) {
    throw new Error(`HISTORICAL_SIMULATION_RESUME_REFUSED:${expectedKind}_SNAPSHOT`);
  }
}

export function loadValidatedHistoricalSimulationLedgerHeadV2(
  entries: readonly HistoricalSimulationReasonLedgerV2[],
  scope: Pick<HistoricalSimulationAtomicScopeV2, "organizationId" | "runId" | "split">,
): HistoricalSimulationReasonLedgerV2 | null {
  assertHistoricalSimulationReasonLedgerChainV2(entries);
  for (const entry of entries) {
    if (entry.organizationId !== scope.organizationId || entry.runId !== scope.runId ||
        entry.partition !== scope.split) {
      throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:LEDGER_SCOPE");
    }
  }
  return entries.at(-1) ?? null;
}

function datasetAuthority(membership: HistoricalDatasetMembershipV2): HistoricalSimulationDatasetAuthorityV2 {
  return Object.freeze({
    manifestSemanticDigestHex: membership.manifestSemanticDigestHex,
    sealReceiptDigestHex: membership.sealReceiptDigestHex,
    partitionDigestHex: membership.partitionDigestHex,
    partitionRawSha256Hex: membership.partitionRawSha256Hex,
    split: membership.partition,
    symbol: membership.symbol,
  });
}

function sameDatasetAuthority(
  left: HistoricalSimulationDatasetAuthorityV2,
  right: HistoricalSimulationDatasetAuthorityV2,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateDatasetMembership(membership: HistoricalDatasetMembershipV2): void {
  const { contentDigestHex, ...body } = membership;
  if (!DIGEST.test(contentDigestHex) || computeSemanticSha256Hex(body) !== contentDigestHex) {
    throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:DATASET_MEMBERSHIP_DIGEST");
  }
}

export function validateHistoricalSimulationResumeCursorV2(
  cursor: HistoricalSimulationResumeCursorV2,
  scope: HistoricalSimulationAtomicScopeV2,
): void {
  const { contentDigestHex, ...body } = cursor;
  if (cursor.schemaVersion !== HISTORICAL_SIMULATION_RESUME_CURSOR_V2 ||
      computeSemanticSha256Hex(body) !== contentDigestHex) {
    throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:CURSOR_DIGEST");
  }
  requireText(cursor.organizationId, "organizationId");
  requireText(cursor.runId, "runId");
  requireText(cursor.accountId, "accountId");
  requireText(cursor.committedCycleId, "committedCycleId");
  requireUtc(cursor.committedReplayBarClosedAtUtc, "committedReplayBarClosedAtUtc");
  if (cursor.organizationId !== scope.organizationId || cursor.runId !== scope.runId ||
      cursor.accountId !== scope.accountId || cursor.split !== scope.split ||
      cursor.datasetAuthority.split !== scope.split) {
    throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:CURSOR_SCOPE");
  }
  if (!Number.isSafeInteger(cursor.nextRecordIndex) || cursor.nextRecordIndex < 1 ||
      !Number.isSafeInteger(cursor.nextCycleSequence) || cursor.nextCycleSequence < 1 ||
      !Number.isSafeInteger(cursor.knowledgeCheckpointSequence) || cursor.knowledgeCheckpointSequence < 0) {
    throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:CURSOR_SEQUENCE");
  }
  for (const [value, field] of [
    [cursor.ledgerHeadContentDigestHex, "ledgerHeadContentDigestHex"],
    [cursor.knowledgeCheckpointContentDigestHex, "knowledgeCheckpointContentDigestHex"],
    [cursor.datasetAuthority.manifestSemanticDigestHex, "manifestSemanticDigestHex"],
    [cursor.datasetAuthority.sealReceiptDigestHex, "sealReceiptDigestHex"],
    [cursor.datasetAuthority.partitionDigestHex, "partitionDigestHex"],
    [cursor.datasetAuthority.partitionRawSha256Hex, "partitionRawSha256Hex"],
  ] as const) requireDigest(value, field);
  validateHistoricalSimulationDurableStateSnapshotV2(cursor.knowledgeSnapshot, "KNOWLEDGE");
  validateHistoricalSimulationDurableStateSnapshotV2(
    cursor.modeledExecutionRegistrySnapshot, "MODELED_EXECUTION_REGISTRY",
  );
  validateHistoricalSimulationDurableStateSnapshotV2(cursor.modeledExchangeSnapshot, "MODELED_EXCHANGE");
  validateHistoricalSimulationDurableStateSnapshotV2(cursor.accountingFrontierSnapshot, "ACCOUNTING_FRONTIER");
  validateHistoricalSimulationDurableStateSnapshotV2(cursor.guardianSnapshot, "GUARDIAN");
  validateHistoricalSimulationDurableStateSnapshotV2(cursor.learningSnapshot, "LEARNING");
}

export function assertHistoricalSimulationResumeAtMembershipV2(input: Readonly<{
  cursor: HistoricalSimulationResumeCursorV2;
  scope: HistoricalSimulationAtomicScopeV2;
  membership: HistoricalDatasetMembershipV2;
}>): void {
  validateHistoricalSimulationResumeCursorV2(input.cursor, input.scope);
  validateDatasetMembership(input.membership);
  if (input.membership.organizationId !== input.scope.organizationId ||
      input.membership.partition !== input.scope.split ||
      input.membership.recordIndex !== input.cursor.nextRecordIndex ||
      !sameDatasetAuthority(input.cursor.datasetAuthority, datasetAuthority(input.membership))) {
    throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:DATASET_MEMBERSHIP");
  }
}

export async function commitHistoricalSimulationCycleAtomicallyV2(input: Readonly<{
  repository: HistoricalSimulationAtomicCycleRepositoryV2;
  scope: HistoricalSimulationAtomicScopeV2;
  ledgerEntry: HistoricalSimulationReasonLedgerV2;
  stageBundles: HistoricalSimulationAtomicStageBundlesV2;
  knowledgeCheckpointSequence: number;
  knowledgeCheckpointContentDigestHex: string;
  knowledgeSnapshot: HistoricalSimulationDurableStateSnapshotV2;
  modeledExecutionRegistrySnapshot: HistoricalSimulationDurableStateSnapshotV2;
  modeledExchangeSnapshot: HistoricalSimulationDurableStateSnapshotV2;
  accountingFrontierSnapshot: HistoricalSimulationDurableStateSnapshotV2;
  guardianSnapshot: HistoricalSimulationDurableStateSnapshotV2;
  learningSnapshot: HistoricalSimulationDurableStateSnapshotV2;
}>): Promise<HistoricalSimulationResumeCursorV2> {
  if (!validateHistoricalSimulationReasonLedgerV2(input.ledgerEntry)) {
    throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:LEDGER_ENTRY");
  }
  return input.repository.transaction(async (tx) => {
    const entries = await tx.loadLedgerChain(input.scope);
    const head = loadValidatedHistoricalSimulationLedgerHeadV2(entries, input.scope);
    const previousCursor = await tx.loadResumeCursor(input.scope);
    if (previousCursor) {
      validateHistoricalSimulationResumeCursorV2(previousCursor, input.scope);
      if (!head || previousCursor.nextCycleSequence !== head.cycleSequence + 1 ||
          previousCursor.ledgerHeadContentDigestHex !== head.contentDigestHex) {
        throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:CURSOR_LEDGER_DIVERGENCE");
      }
    } else if (head) {
      throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:MISSING_CURSOR");
    }
    const expectedSequence = head ? head.cycleSequence + 1 : 0;
    const membership = input.ledgerEntry.datasetMembership;
    validateDatasetMembership(membership);
    if (input.ledgerEntry.organizationId !== input.scope.organizationId ||
        input.ledgerEntry.runId !== input.scope.runId || input.ledgerEntry.partition !== input.scope.split ||
        input.ledgerEntry.cycleSequence !== expectedSequence ||
        input.ledgerEntry.previousContentDigestHex !== (head?.contentDigestHex ?? null) ||
        membership.recordIndex !== expectedSequence ||
        (previousCursor && !sameDatasetAuthority(
          previousCursor.datasetAuthority, datasetAuthority(membership),
        ))) {
      throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:NEXT_SEQUENCE_OR_BINDING");
    }
    validateHistoricalSimulationDurableStateSnapshotV2(input.knowledgeSnapshot, "KNOWLEDGE");
    validateHistoricalSimulationDurableStateSnapshotV2(
      input.modeledExecutionRegistrySnapshot, "MODELED_EXECUTION_REGISTRY",
    );
    validateHistoricalSimulationDurableStateSnapshotV2(input.modeledExchangeSnapshot, "MODELED_EXCHANGE");
    validateHistoricalSimulationDurableStateSnapshotV2(input.accountingFrontierSnapshot, "ACCOUNTING_FRONTIER");
    validateHistoricalSimulationDurableStateSnapshotV2(input.guardianSnapshot, "GUARDIAN");
    validateHistoricalSimulationDurableStateSnapshotV2(input.learningSnapshot, "LEARNING");
    requireDigest(input.knowledgeCheckpointContentDigestHex, "knowledgeCheckpointContentDigestHex");
    if (!Number.isSafeInteger(input.knowledgeCheckpointSequence) || input.knowledgeCheckpointSequence < 0) {
      throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:KNOWLEDGE_SEQUENCE");
    }
    const body = {
      schemaVersion: HISTORICAL_SIMULATION_RESUME_CURSOR_V2,
      ...input.scope,
      datasetAuthority: datasetAuthority(membership),
      committedCycleId: input.ledgerEntry.cycleId,
      committedReplayBarClosedAtUtc: input.ledgerEntry.replayBarClosedAtUtc,
      nextRecordIndex: membership.recordIndex + 1,
      nextCycleSequence: expectedSequence + 1,
      ledgerHeadContentDigestHex: input.ledgerEntry.contentDigestHex,
      knowledgeCheckpointSequence: input.knowledgeCheckpointSequence,
      knowledgeCheckpointContentDigestHex: input.knowledgeCheckpointContentDigestHex,
      knowledgeSnapshot: input.knowledgeSnapshot,
      modeledExecutionRegistrySnapshot: input.modeledExecutionRegistrySnapshot,
      modeledExchangeSnapshot: input.modeledExchangeSnapshot,
      accountingFrontierSnapshot: input.accountingFrontierSnapshot,
      guardianSnapshot: input.guardianSnapshot,
      learningSnapshot: input.learningSnapshot,
    };
    const cursor = Object.freeze({ ...body, contentDigestHex: computeSemanticSha256Hex(body) });
    validateHistoricalSimulationResumeCursorV2(cursor, input.scope);
    for (const stage of HISTORICAL_SIMULATION_ATOMIC_STAGES_V2) {
      const bundle = input.stageBundles[stage];
      validateStageBundle(bundle, stage, input.ledgerEntry.cycleId);
      await tx.persistStageBundle(bundle);
    }
    await tx.appendLedger(input.ledgerEntry);
    await tx.saveResumeCursor(cursor);
    return cursor;
  });
}
