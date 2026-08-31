import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type { AccountingFrontierV1 } from "@/lib/trader/accounting/accounting-frontier.types";
import type { HistoricalExecutionCheckpointSlice } from "@/lib/trader/execution/historical-execution-model.types";
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

type DurableStatePayloadV2 = Readonly<{
  KNOWLEDGE: Readonly<{ checkpointSequence: number; checkpointContentDigestHex: string;
    knowledgeContentDigestHex: string; visibleThroughPitAnchor: string }>;
  MODELED_EXECUTION_REGISTRY: Readonly<{ receipts: ReadonlyArray<Readonly<{
    orderId: string; receiptContentDigestHex: string; decisionBarIndex: number;
  }>> }>;
  MODELED_EXCHANGE: Readonly<{ checkpoint: HistoricalExecutionCheckpointSlice;
    openOrderContentDigestHexById: Readonly<Record<string, string>> }>;
  ACCOUNTING_FRONTIER: AccountingFrontierV1;
  GUARDIAN: Readonly<{ assessmentContentDigestHex: string; posture: "NONE" | "CLOSE_ONLY" | "STOP_ACCOUNT";
    assessedAt: string }>;
  LEARNING: Readonly<{ appliedClosureWatermarkUtc: string | null;
    pendingForecastAuthorityContentDigestHexes: readonly string[] }>;
}>;

export type HistoricalSimulationDurableStateKindV2 = keyof DurableStatePayloadV2;

export type HistoricalSimulationDurableStateSnapshotV2<
  Kind extends HistoricalSimulationDurableStateKindV2 = HistoricalSimulationDurableStateKindV2,
> = Readonly<{
  schemaVersion: typeof HISTORICAL_SIMULATION_DURABLE_STATE_SNAPSHOT_V2;
  organizationId: string;
  runId: string;
  accountId: string;
  cycleId: string;
  stateKind: Kind;
  state: DurableStatePayloadV2[Kind];
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
  organizationId: string;
  runId: string;
  accountId: string;
  ledgerEntryContentDigestHex: string;
  artifacts: readonly [HistoricalSimulationAtomicArtifactReferenceV2,
    ...HistoricalSimulationAtomicArtifactReferenceV2[]];
  contentDigestHex: string;
}>;

export type HistoricalSimulationAtomicArtifactReferenceV2 = Readonly<{
  artifactKind: string;
  artifactId: string;
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
  cycleStageBundleDigestHexByStage: Readonly<Record<HistoricalSimulationAtomicStageV2, string>>;
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

function canonicalClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createHistoricalSimulationDurableStateSnapshotV2<Kind extends HistoricalSimulationDurableStateKindV2>(
  input: HistoricalSimulationAtomicScopeV2 & Readonly<{
    cycleId: string;
    stateKind: Kind;
    state: DurableStatePayloadV2[Kind];
  }>,
): HistoricalSimulationDurableStateSnapshotV2<Kind> {
  const state = canonicalClone(input.state);
  const body = {
    schemaVersion: HISTORICAL_SIMULATION_DURABLE_STATE_SNAPSHOT_V2,
    organizationId: input.organizationId,
    runId: input.runId,
    accountId: input.accountId,
    cycleId: input.cycleId,
    stateKind: input.stateKind,
    state,
  };
  return Object.freeze({ ...body, contentDigestHex: computeSemanticSha256Hex(body) });
}

export function createHistoricalSimulationAtomicStageBundleV2(input: Readonly<{
  organizationId: string;
  runId: string;
  accountId: string;
  stage: HistoricalSimulationAtomicStageV2;
  cycleId: string;
  ledgerEntryContentDigestHex: string;
  artifacts: readonly [HistoricalSimulationAtomicArtifactReferenceV2,
    ...HistoricalSimulationAtomicArtifactReferenceV2[]];
}>): HistoricalSimulationAtomicStageBundleV2 {
  requireText(input.cycleId, "stageBundle.cycleId");
  requireText(input.organizationId, "stageBundle.organizationId");
  requireText(input.runId, "stageBundle.runId");
  requireText(input.accountId, "stageBundle.accountId");
  requireDigest(input.ledgerEntryContentDigestHex, "stageBundle.ledgerEntryContentDigestHex");
  for (const artifact of input.artifacts) {
    requireText(artifact.artifactKind, "stageBundle.artifactKind");
    requireText(artifact.artifactId, "stageBundle.artifactId");
    requireDigest(artifact.contentDigestHex, "stageBundle.artifactContentDigestHex");
  }
  const body = {
    schemaVersion: HISTORICAL_SIMULATION_ATOMIC_STAGE_BUNDLE_V2,
    organizationId: input.organizationId,
    runId: input.runId,
    accountId: input.accountId,
    stage: input.stage,
    cycleId: input.cycleId,
    ledgerEntryContentDigestHex: input.ledgerEntryContentDigestHex,
    artifacts: input.artifacts,
  };
  return Object.freeze({ ...body, contentDigestHex: computeSemanticSha256Hex(body) });
}

function validateStageBundle(
  bundle: HistoricalSimulationAtomicStageBundleV2,
  expectedStage: HistoricalSimulationAtomicStageV2,
  entry: HistoricalSimulationReasonLedgerV2,
  scope: HistoricalSimulationAtomicScopeV2,
): void {
  const { contentDigestHex, ...body } = bundle;
  if (bundle.schemaVersion !== HISTORICAL_SIMULATION_ATOMIC_STAGE_BUNDLE_V2 ||
      bundle.stage !== expectedStage || bundle.cycleId !== entry.cycleId ||
      bundle.organizationId !== scope.organizationId || bundle.runId !== scope.runId ||
      bundle.accountId !== scope.accountId ||
      bundle.ledgerEntryContentDigestHex !== entry.contentDigestHex || bundle.artifacts.length === 0 ||
      !DIGEST.test(contentDigestHex) || computeSemanticSha256Hex(body) !== contentDigestHex) {
    throw new Error(`HISTORICAL_SIMULATION_RESUME_REFUSED:${expectedStage}_STAGE_BUNDLE`);
  }
}

export function validateHistoricalSimulationDurableStateSnapshotV2(
  snapshot: HistoricalSimulationDurableStateSnapshotV2,
  expectedKind: HistoricalSimulationDurableStateKindV2,
  scope?: HistoricalSimulationAtomicScopeV2 & Readonly<{ cycleId: string }>,
): void {
  const { contentDigestHex, ...body } = snapshot;
  if (snapshot.schemaVersion !== HISTORICAL_SIMULATION_DURABLE_STATE_SNAPSHOT_V2 ||
      snapshot.stateKind !== expectedKind || !DIGEST.test(contentDigestHex) ||
      (scope !== undefined && (snapshot.organizationId !== scope.organizationId ||
        snapshot.runId !== scope.runId || snapshot.accountId !== scope.accountId ||
        snapshot.cycleId !== scope.cycleId)) ||
      computeSemanticSha256Hex(body) !== contentDigestHex) {
    throw new Error(`HISTORICAL_SIMULATION_RESUME_REFUSED:${expectedKind}_SNAPSHOT`);
  }
  const state = snapshot.state as Record<string, unknown>;
  if (expectedKind === "KNOWLEDGE") {
    if (!Number.isSafeInteger(state.checkpointSequence) || !DIGEST.test(String(state.checkpointContentDigestHex)) ||
        !DIGEST.test(String(state.knowledgeContentDigestHex))) {
      throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:KNOWLEDGE_STATE");
    }
    requireUtc(String(state.visibleThroughPitAnchor), "knowledge.visibleThroughPitAnchor");
  } else if (expectedKind === "MODELED_EXECUTION_REGISTRY") {
    if (!Array.isArray(state.receipts) || state.receipts.some((value) => {
      const receipt = value as Record<string, unknown>;
      return typeof receipt.orderId !== "string" || !DIGEST.test(String(receipt.receiptContentDigestHex)) ||
        !Number.isSafeInteger(receipt.decisionBarIndex);
    })) throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:MODELED_EXECUTION_REGISTRY_STATE");
  } else if (expectedKind === "MODELED_EXCHANGE") {
    const checkpoint = state.checkpoint as HistoricalExecutionCheckpointSlice | undefined;
    if (checkpoint?.schemaVersion !== "htr-wp17-execution-checkpoint/v1" ||
        !Array.isArray(checkpoint.openOrders) || typeof state.openOrderContentDigestHexById !== "object") {
      throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:MODELED_EXCHANGE_STATE");
    }
    for (const order of checkpoint.openOrders) {
      const digest = (state.openOrderContentDigestHexById as Record<string, string>)[order.orderId];
      if (!DIGEST.test(digest ?? "")) throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:OPEN_ORDER_BINDING");
    }
  } else if (expectedKind === "ACCOUNTING_FRONTIER") {
    const frontier = state as unknown as AccountingFrontierV1;
    if (frontier.organizationId !== snapshot.organizationId || frontier.accountKey !== snapshot.accountId ||
        frontier.runId !== snapshot.runId || !DIGEST.test(frontier.semanticContentDigest)) {
      throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:ACCOUNTING_STATE");
    }
  } else if (expectedKind === "GUARDIAN") {
    if (!DIGEST.test(String(state.assessmentContentDigestHex)) ||
        !["NONE", "CLOSE_ONLY", "STOP_ACCOUNT"].includes(String(state.posture))) {
      throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:GUARDIAN_STATE");
    }
    requireUtc(String(state.assessedAt), "guardian.assessedAt");
  } else if (expectedKind === "LEARNING") {
    if (state.appliedClosureWatermarkUtc !== null) {
      requireUtc(String(state.appliedClosureWatermarkUtc), "learning.appliedClosureWatermarkUtc");
    }
    if (!Array.isArray(state.pendingForecastAuthorityContentDigestHexes) ||
        state.pendingForecastAuthorityContentDigestHexes.some((value) => !DIGEST.test(String(value)))) {
      throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:LEARNING_STATE");
    }
  }
}

export function restoreHistoricalSimulationDurableStateSnapshotV2<Kind extends HistoricalSimulationDurableStateKindV2>(
  snapshot: HistoricalSimulationDurableStateSnapshotV2<Kind>,
  scope: HistoricalSimulationAtomicScopeV2 & Readonly<{ cycleId: string }>,
): DurableStatePayloadV2[Kind] {
  validateHistoricalSimulationDurableStateSnapshotV2(snapshot, snapshot.stateKind, scope);
  return canonicalClone(snapshot.state);
}

export function loadValidatedHistoricalSimulationLedgerHeadV2(
  entries: readonly HistoricalSimulationReasonLedgerV2[],
  scope: Pick<HistoricalSimulationAtomicScopeV2, "organizationId" | "runId" | "accountId" | "split">,
): HistoricalSimulationReasonLedgerV2 | null {
  assertHistoricalSimulationReasonLedgerChainV2(entries);
  for (const entry of entries) {
    if (entry.organizationId !== scope.organizationId || entry.accountId !== scope.accountId || entry.runId !== scope.runId ||
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
  for (const stage of HISTORICAL_SIMULATION_ATOMIC_STAGES_V2) {
    requireDigest(cursor.cycleStageBundleDigestHexByStage[stage], `stageBundle.${stage}`);
  }
  const snapshotScope = { ...scope, cycleId: cursor.committedCycleId };
  validateHistoricalSimulationDurableStateSnapshotV2(cursor.knowledgeSnapshot, "KNOWLEDGE");
  validateHistoricalSimulationDurableStateSnapshotV2(
    cursor.modeledExecutionRegistrySnapshot, "MODELED_EXECUTION_REGISTRY",
  );
  validateHistoricalSimulationDurableStateSnapshotV2(cursor.modeledExchangeSnapshot, "MODELED_EXCHANGE");
  validateHistoricalSimulationDurableStateSnapshotV2(cursor.accountingFrontierSnapshot, "ACCOUNTING_FRONTIER");
  validateHistoricalSimulationDurableStateSnapshotV2(cursor.guardianSnapshot, "GUARDIAN");
  validateHistoricalSimulationDurableStateSnapshotV2(cursor.learningSnapshot, "LEARNING");
  for (const snapshot of [cursor.knowledgeSnapshot, cursor.modeledExecutionRegistrySnapshot,
    cursor.modeledExchangeSnapshot, cursor.accountingFrontierSnapshot, cursor.guardianSnapshot,
    cursor.learningSnapshot]) {
    validateHistoricalSimulationDurableStateSnapshotV2(snapshot, snapshot.stateKind, snapshotScope);
  }
  const knowledge = cursor.knowledgeSnapshot.state as DurableStatePayloadV2["KNOWLEDGE"];
  if (knowledge.checkpointSequence !== cursor.knowledgeCheckpointSequence ||
      knowledge.checkpointContentDigestHex !== cursor.knowledgeCheckpointContentDigestHex) {
    throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:KNOWLEDGE_CHECKPOINT_BINDING");
  }
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
  if (input.ledgerEntry.organizationId !== input.scope.organizationId ||
      input.ledgerEntry.accountId !== input.scope.accountId || input.ledgerEntry.runId !== input.scope.runId ||
      input.ledgerEntry.partition !== input.scope.split) {
    throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:LEDGER_SCOPE");
  }
  const snapshotScope = { ...input.scope, cycleId: input.ledgerEntry.cycleId };
  for (const snapshot of [input.knowledgeSnapshot, input.modeledExecutionRegistrySnapshot,
    input.modeledExchangeSnapshot, input.accountingFrontierSnapshot, input.guardianSnapshot,
    input.learningSnapshot]) {
    validateHistoricalSimulationDurableStateSnapshotV2(snapshot, snapshot.stateKind, snapshotScope);
  }
  const knowledge = input.knowledgeSnapshot.state as DurableStatePayloadV2["KNOWLEDGE"];
  if (knowledge.checkpointSequence !== input.knowledgeCheckpointSequence ||
      knowledge.checkpointContentDigestHex !== input.knowledgeCheckpointContentDigestHex) {
    throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:KNOWLEDGE_CHECKPOINT_BINDING");
  }
  for (const stage of HISTORICAL_SIMULATION_ATOMIC_STAGES_V2) {
    validateStageBundle(input.stageBundles[stage], stage, input.ledgerEntry, input.scope);
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
    if (head && previousCursor && input.ledgerEntry.cycleSequence === head.cycleSequence) {
      const snapshotDigests = [input.knowledgeSnapshot, input.modeledExecutionRegistrySnapshot,
        input.modeledExchangeSnapshot, input.accountingFrontierSnapshot, input.guardianSnapshot,
        input.learningSnapshot].map((value) => value.contentDigestHex);
      const persistedSnapshotDigests = [previousCursor.knowledgeSnapshot,
        previousCursor.modeledExecutionRegistrySnapshot, previousCursor.modeledExchangeSnapshot,
        previousCursor.accountingFrontierSnapshot, previousCursor.guardianSnapshot,
        previousCursor.learningSnapshot].map((value) => value.contentDigestHex);
      const sameStages = HISTORICAL_SIMULATION_ATOMIC_STAGES_V2.every((stage) =>
        input.stageBundles[stage].contentDigestHex === previousCursor.cycleStageBundleDigestHexByStage[stage]);
      if (input.ledgerEntry.contentDigestHex !== head.contentDigestHex ||
          input.ledgerEntry.cycleId !== head.cycleId || !sameStages ||
          snapshotDigests.some((digest, index) => digest !== persistedSnapshotDigests[index]) ||
          input.knowledgeCheckpointSequence !== previousCursor.knowledgeCheckpointSequence ||
          input.knowledgeCheckpointContentDigestHex !== previousCursor.knowledgeCheckpointContentDigestHex) {
        throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:AMBIGUOUS_RETRY");
      }
      return previousCursor;
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
      cycleStageBundleDigestHexByStage: Object.freeze(Object.fromEntries(
        HISTORICAL_SIMULATION_ATOMIC_STAGES_V2.map((stage) => [stage, input.stageBundles[stage].contentDigestHex]),
      )) as Readonly<Record<HistoricalSimulationAtomicStageV2, string>>,
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
      await tx.persistStageBundle(bundle);
    }
    await tx.appendLedger(input.ledgerEntry);
    await tx.saveResumeCursor(cursor);
    return cursor;
  });
}
