import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type { AccountingFrontierV1 } from "@/lib/trader/accounting/accounting-frontier.types";
import { computeAccountingSemanticDigest } from "@/lib/trader/accounting/canonical-cross-backend-accounting-engine";
import type { HistoricalExecutionCheckpointSlice } from "@/lib/trader/execution/historical-execution-model.types";
import type { OrderRow } from "@/lib/trader/execution/order-repository.types";
import type { HistoricalModeledExecutionReceiptV2 } from "./modeled-capital-binding-v2";
import { parseDecimal } from "@/lib/trader/risk/numeric";
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
  MODELED_EXECUTION_REGISTRY: Readonly<{ receipts: readonly HistoricalModeledExecutionReceiptV2[] }>;
  MODELED_EXCHANGE: Readonly<{ checkpoint: HistoricalExecutionCheckpointSlice;
    openOrders: readonly HistoricalSimulationDurableOrderV2[] }>;
  ACCOUNTING_FRONTIER: AccountingFrontierV1;
  GUARDIAN: Readonly<{ assessmentContentDigestHex: string; posture: "NONE" | "CLOSE_ONLY" | "STOP_ACCOUNT";
    assessedAt: string }>;
  LEARNING: Readonly<{ appliedClosureWatermarkUtc: string | null;
    pendingForecastAuthorityContentDigestHexes: readonly string[] }>;
}>;

export type HistoricalSimulationDurableOrderV2 = Readonly<Omit<OrderRow, "createdAt" | "updatedAt"> & {
  createdAt: string; updatedAt: string; contentDigestHex: string;
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
  | "MODELED_EXECUTION" | "OBSERVED_EXECUTION_EFFECTS" | "HISTORICAL_MODELED_REALITY" | "ACCOUNTING"
  | "GUARDIAN" | "KNOWLEDGE" | "LEARNING";

export const HISTORICAL_SIMULATION_ATOMIC_STAGES_V2 = Object.freeze([
  "FORECAST_LIFECYCLE", "CANONICAL_VERIFICATION", "MODELED_RISK", "MODELED_EXECUTION",
  "OBSERVED_EXECUTION_EFFECTS", "HISTORICAL_MODELED_REALITY", "ACCOUNTING", "GUARDIAN", "KNOWLEDGE", "LEARNING",
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
  artifactKind: HistoricalSimulationAtomicArtifactKindV2;
  artifactId: string;
  contentDigestHex: string;
  /** Required and canonically recomputed for modeled historical artifact kinds at the PostgreSQL boundary. */
  payload?: Readonly<Record<string, unknown>>;
}>;

export type HistoricalSimulationAtomicArtifactKindV2 =
  | "FORECAST_ISSUANCE" | "FORECAST_NON_ACTIONABLE"
  | "CANONICAL_VERIFICATION_RECEIPT" | "FORECAST_NON_ACTIONABLE_VERIFICATION"
  | "MODELED_RISK_VERDICT"
  | "MODELED_EXECUTION_SUBMISSION" | "MODELED_EXECUTION_EFFECT" | "ACCOUNTING_FRONTIER"
  | "HISTORICAL_MODELED_REALITY" | "GUARDIAN_ASSESSMENT" | "KNOWLEDGE_CHECKPOINT" | "LEARNING_UPDATE";

const REQUIRED_ARTIFACT_KIND_BY_STAGE = Object.freeze({
  FORECAST_LIFECYCLE: ["FORECAST_ISSUANCE", "FORECAST_NON_ACTIONABLE"],
  CANONICAL_VERIFICATION: [
    "CANONICAL_VERIFICATION_RECEIPT",
    "FORECAST_NON_ACTIONABLE_VERIFICATION",
  ],
  MODELED_RISK: ["MODELED_RISK_VERDICT"],
  MODELED_EXECUTION: ["MODELED_EXECUTION_SUBMISSION"],
  OBSERVED_EXECUTION_EFFECTS: ["MODELED_EXECUTION_EFFECT"],
  HISTORICAL_MODELED_REALITY: ["HISTORICAL_MODELED_REALITY"],
  ACCOUNTING: ["ACCOUNTING_FRONTIER"],
  GUARDIAN: ["GUARDIAN_ASSESSMENT"],
  KNOWLEDGE: ["KNOWLEDGE_CHECKPOINT"],
  LEARNING: ["LEARNING_UPDATE"],
} as const satisfies Readonly<
  Record<HistoricalSimulationAtomicStageV2, readonly HistoricalSimulationAtomicArtifactKindV2[]>
>);

export type HistoricalSimulationAtomicStageBundlesV2 = Readonly<Record<
  HistoricalSimulationAtomicStageV2,
  HistoricalSimulationAtomicStageBundleV2
>>;

export type HistoricalSimulationDatasetAuthorityV2 = Readonly<{
  authorityClass: "FULL_SEALED_DATASET_V2" | "PRE_HOLDOUT_QUALIFICATION_V1";
  authorityDigestHex: string;
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

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
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
  return deepFreeze({ ...body, contentDigestHex: computeSemanticSha256Hex(body) });
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
  const seen = new Set<string>();
  for (const artifact of input.artifacts) {
    requireText(artifact.artifactKind, "stageBundle.artifactKind");
    requireText(artifact.artifactId, "stageBundle.artifactId");
    requireDigest(artifact.contentDigestHex, "stageBundle.artifactContentDigestHex");
    const identity = `${artifact.artifactKind}:${artifact.artifactId}`;
    if (seen.has(identity)) throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:stageBundle.duplicateArtifact");
    seen.add(identity);
  }
  if (!input.artifacts.some((artifact) =>
    REQUIRED_ARTIFACT_KIND_BY_STAGE[input.stage].includes(artifact.artifactKind as never))) {
    throw new Error(`HISTORICAL_SIMULATION_RESUME_REFUSED:${input.stage}_REQUIRED_ARTIFACT`);
  }
  const artifacts = [...input.artifacts].sort((left, right) =>
    `${left.artifactKind}:${left.artifactId}`.localeCompare(`${right.artifactKind}:${right.artifactId}`)) as unknown as
    readonly [HistoricalSimulationAtomicArtifactReferenceV2, ...HistoricalSimulationAtomicArtifactReferenceV2[]];
  const body = {
    schemaVersion: HISTORICAL_SIMULATION_ATOMIC_STAGE_BUNDLE_V2,
    organizationId: input.organizationId,
    runId: input.runId,
    accountId: input.accountId,
    stage: input.stage,
    cycleId: input.cycleId,
    ledgerEntryContentDigestHex: input.ledgerEntryContentDigestHex,
    artifacts,
  };
  return deepFreeze({ ...body, contentDigestHex: computeSemanticSha256Hex(body) });
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
    const orderIds = new Set<string>(); const planIds = new Set<string>(); const attemptIds = new Set<string>();
    if (!Array.isArray(state.receipts) || state.receipts.some((value) => {
      const receipt = value as Record<string, unknown>;
      const { contentDigestHex, ...body } = receipt;
      const duplicate = orderIds.has(String(receipt.orderId)) || planIds.has(String(receipt.executionPlanId)) ||
        attemptIds.has(String(receipt.executionAttemptId));
      orderIds.add(String(receipt.orderId)); planIds.add(String(receipt.executionPlanId));
      attemptIds.add(String(receipt.executionAttemptId));
      const expectedPlan = computeSemanticSha256Hex({
        schemaVersion: "waia.trader.historical_modeled_execution_plan.v2", source: "MODELED_HISTORICAL",
        capitalEligible: false, executionPlanId: receipt.executionPlanId, decisionId: receipt.decisionId,
        decisionContentDigestHex: receipt.decisionContentDigestHex,
        riskReceiptContentDigestHex: receipt.riskReceiptContentDigestHex,
        symbol: receipt.symbol, side: receipt.side, quantity: receipt.quantity,
      });
      const expectedAttempt = computeSemanticSha256Hex({
        schemaVersion: "waia.trader.historical_modeled_execution_attempt.v2", source: "MODELED_HISTORICAL",
        capitalEligible: false, executionAttemptId: receipt.executionAttemptId,
        executionPlanId: receipt.executionPlanId, executionPlanContentDigestHex: receipt.executionPlanContentDigestHex,
        acceptedAtUtc: receipt.acceptedAtUtc,
      });
      return duplicate || receipt.schemaVersion !== "waia.trader.historical_modeled_execution.v2" ||
        receipt.source !== "MODELED_HISTORICAL" || receipt.capitalEligible !== false ||
        typeof receipt.orderId !== "string" || !DIGEST.test(String(contentDigestHex)) ||
        !DIGEST.test(String(receipt.executionPlanContentDigestHex)) ||
        !DIGEST.test(String(receipt.executionAttemptContentDigestHex)) ||
        receipt.executionPlanContentDigestHex !== expectedPlan || receipt.executionAttemptContentDigestHex !== expectedAttempt ||
        computeSemanticSha256Hex(body) !== contentDigestHex || !Number.isSafeInteger(receipt.decisionBarIndex);
    })) throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:MODELED_EXECUTION_REGISTRY_STATE");
  } else if (expectedKind === "MODELED_EXCHANGE") {
    const checkpoint = state.checkpoint as HistoricalExecutionCheckpointSlice | undefined;
    if (checkpoint?.schemaVersion !== "htr-wp17-execution-checkpoint/v1" ||
        !Array.isArray(checkpoint.openOrders) || !Array.isArray(state.openOrders)) {
      throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:MODELED_EXCHANGE_STATE");
    }
    const orders = state.openOrders as HistoricalSimulationDurableOrderV2[];
    const byId = new Map(orders.map((order) => [order.id, order]));
    if (byId.size !== orders.length || checkpoint.openOrders.length !== orders.length) {
      throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:OPEN_ORDER_BINDING");
    }
    for (const checkpointOrder of checkpoint.openOrders) {
      const order = byId.get(checkpointOrder.orderId);
      if (!order) throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:OPEN_ORDER_BINDING");
      const { contentDigestHex, ...body } = order;
      requireUtc(order.createdAt, "modeledExchange.order.createdAt");
      requireUtc(order.updatedAt, "modeledExchange.order.updatedAt");
      if (!DIGEST.test(contentDigestHex) || computeSemanticSha256Hex(body) !== contentDigestHex ||
          order.organizationId !== snapshot.organizationId) {
        throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:OPEN_ORDER_BINDING");
      }
    }
  } else if (expectedKind === "ACCOUNTING_FRONTIER") {
    const frontier = state as unknown as AccountingFrontierV1;
    if (frontier.organizationId !== snapshot.organizationId || frontier.accountKey !== snapshot.accountId ||
        frontier.runId !== snapshot.runId || !DIGEST.test(frontier.semanticContentDigest) ||
        computeAccountingSemanticDigest(frontier) !== frontier.semanticContentDigest) {
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

export function restoreHistoricalModeledExchangeOrdersV2(
  snapshot: HistoricalSimulationDurableStateSnapshotV2<"MODELED_EXCHANGE">,
  scope: HistoricalSimulationAtomicScopeV2 & Readonly<{ cycleId: string }>,
): Map<string, OrderRow> {
  const state = restoreHistoricalSimulationDurableStateSnapshotV2(snapshot, scope);
  return new Map(state.openOrders.map(({ contentDigestHex: _digest, createdAt, updatedAt, ...order }) => [
    order.id, { ...order, createdAt: new Date(createdAt), updatedAt: new Date(updatedAt) },
  ]));
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
    authorityClass: membership.datasetAuthorityClass ?? "FULL_SEALED_DATASET_V2",
    authorityDigestHex: membership.datasetAuthorityDigestHex ??
      ("sealReceiptDigestHex" in membership ? membership.sealReceiptDigestHex : ""),
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
  return left.authorityClass === right.authorityClass &&
    left.authorityDigestHex === right.authorityDigestHex &&
    left.partitionDigestHex === right.partitionDigestHex &&
    left.partitionRawSha256Hex === right.partitionRawSha256Hex &&
    left.split === right.split && left.symbol === right.symbol;
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
    [cursor.datasetAuthority.authorityDigestHex, "authorityDigestHex"],
    [cursor.datasetAuthority.partitionDigestHex, "partitionDigestHex"],
    [cursor.datasetAuthority.partitionRawSha256Hex, "partitionRawSha256Hex"],
  ] as const) requireDigest(value, field);
  if (cursor.datasetAuthority.authorityClass !== "FULL_SEALED_DATASET_V2" &&
      cursor.datasetAuthority.authorityClass !== "PRE_HOLDOUT_QUALIFICATION_V1") {
    throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:DATASET_AUTHORITY_CLASS");
  }
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
  const exchange = input.modeledExchangeSnapshot.state as DurableStatePayloadV2["MODELED_EXCHANGE"];
  const registry = input.modeledExecutionRegistrySnapshot.state as DurableStatePayloadV2["MODELED_EXECUTION_REGISTRY"];
  const receipts = new Map(registry.receipts.map((receipt) => [receipt.orderId, receipt]));
  if (receipts.size !== registry.receipts.length) {
    throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:EXECUTION_REGISTRY_DUPLICATE");
  }
  const orders = new Map(exchange.openOrders.map((order) => [order.id, order]));
  for (const checkpointOrder of exchange.checkpoint.openOrders) {
    const order = orders.get(checkpointOrder.orderId);
    const receipt = receipts.get(checkpointOrder.orderId);
    const expectedModeledOrderDigest = receipt ? computeSemanticSha256Hex({
      schemaVersion: "waia.trader.historical_modeled_order.v2", source: "MODELED_HISTORICAL",
      capitalEligible: false, orderId: receipt.orderId, executionAttemptId: receipt.executionAttemptId,
      executionAttemptContentDigestHex: receipt.executionAttemptContentDigestHex,
      decisionContentDigestHex: receipt.decisionContentDigestHex, symbol: receipt.symbol,
      side: receipt.side, quantity: receipt.quantity,
    }) : null;
    if (!order || !receipt || receipt.orderContentDigestHex !== expectedModeledOrderDigest ||
        receipt.quantity !== order.quantity || receipt.side !== order.side || receipt.symbol !== order.symbol ||
        receipt.decisionBarIndex !== checkpointOrder.windowEndBarIndex - 3 ||
        Date.parse(receipt.acceptedAtUtc) !== checkpointOrder.acceptedAtTs ||
        parseDecimal(checkpointOrder.remainingQty) + parseDecimal(checkpointOrder.filledQty) !== parseDecimal(order.quantity) ||
        parseDecimal(checkpointOrder.filledQty) !== parseDecimal(order.filledQuantity) ||
        checkpointOrder.fillSequence < 0 ||
        !["ACCEPTED", "PARTIALLY_FILLED", "CANCEL_REQUESTED"].includes(order.state)) {
      throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:EXCHANGE_REGISTRY_PARITY");
    }
  }
  for (const stage of HISTORICAL_SIMULATION_ATOMIC_STAGES_V2) {
    validateStageBundle(input.stageBundles[stage], stage, input.ledgerEntry, input.scope);
  }
  const hasArtifactDigest = (stage: HistoricalSimulationAtomicStageV2, digest: string) =>
    input.stageBundles[stage].artifacts.some((artifact) => artifact.contentDigestHex === digest ||
      (artifact.payload !== null && typeof artifact.payload === "object" &&
        (artifact.payload as Readonly<{ sourceContentDigestHex?: unknown }>).sourceContentDigestHex === digest));
  if (!hasArtifactDigest("ACCOUNTING", input.ledgerEntry.accounting.frontierContentDigestHex) ||
      !hasArtifactDigest("GUARDIAN", input.ledgerEntry.guardian.assessmentContentDigestHex) ||
      !hasArtifactDigest("KNOWLEDGE", input.knowledgeCheckpointContentDigestHex)) {
    throw new Error("HISTORICAL_SIMULATION_RESUME_REFUSED:DOMAIN_STAGE_BINDING");
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
    const nextBindingFailure = input.ledgerEntry.organizationId !== input.scope.organizationId ? "ORGANIZATION"
      : input.ledgerEntry.runId !== input.scope.runId ? "RUN"
      : input.ledgerEntry.partition !== input.scope.split ? "SPLIT"
      : input.ledgerEntry.cycleSequence !== expectedSequence ? "CYCLE_SEQUENCE"
      : input.ledgerEntry.previousContentDigestHex !== (head?.contentDigestHex ?? null) ? "PREVIOUS_LEDGER"
      : previousCursor && membership.recordIndex !== previousCursor.nextRecordIndex ? "RECORD_INDEX"
      : previousCursor && !sameDatasetAuthority(previousCursor.datasetAuthority, datasetAuthority(membership))
        ? "DATASET_AUTHORITY" : null;
    if (nextBindingFailure) {
      throw new Error(`HISTORICAL_SIMULATION_RESUME_REFUSED:NEXT_SEQUENCE_OR_BINDING:${nextBindingFailure}`);
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
    await tx.appendLedger(input.ledgerEntry);
    for (const stage of HISTORICAL_SIMULATION_ATOMIC_STAGES_V2) {
      const bundle = input.stageBundles[stage];
      await tx.persistStageBundle(bundle);
    }
    await tx.saveResumeCursor(cursor);
    return cursor;
  });
}
