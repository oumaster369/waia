import type {
  CostedFillEconomics,
  ExecutionFactKind,
  FillExecutionEconomicsRow,
} from "@/lib/trader/execution/historical-execution-model.types";
import type {
  OrderExecutionMode,
  OrderEventType,
  OrderSide,
  OrderState,
  OrderType,
} from "@/lib/trader/execution/types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import { parseOpeningCausalLineageV1 } from "@/lib/trader/lifecycle/opening-causal-lineage-v1";

export interface OrderRow {
  id: string;
  organizationId: string;
  credentialId: string | null;
  venue: string;
  executionMode: OrderExecutionMode;
  historicalRunId?: string | null;
  historicalAccountKey?: string | null;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  price: string | null;
  quantity: string;
  filledQuantity: string;
  avgFillPrice: string | null;
  state: OrderState;
  stateVersion: number;
  exchangeOrderId: string | null;
  clientOrderId: string;
  idempotencyKey: string;
  riskDecisionId: string;
  riskAllowanceId?: string | null;
  riskAllowanceBindingDigest?: string | null;
  openingCausalLineageJson?: string | null;
  openingCausalLineageDigest?: string | null;
  strategySignalId: string | null;
  allocationDecisionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderEventRow {
  id: string;
  organizationId: string;
  orderId: string;
  seq: number;
  fromState: OrderState | null;
  toState: OrderState;
  eventType: string;
  payload: string | null;
  occurredAt: Date;
  createdAt: Date;
}

export interface FillRow {
  id: string;
  organizationId: string;
  orderId: string;
  exchangeTradeId: string;
  price: string;
  quantity: string;
  fee: string;
  feeAsset: string;
  executedAt: Date;
  createdAt: Date;
}

export interface CreateOrderInput {
  id?: string;
  venue: string;
  executionMode: OrderExecutionMode;
  historicalRunId?: string | null;
  historicalAccountKey?: string | null;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  price?: string | null;
  quantity: string;
  clientOrderId: string;
  idempotencyKey: string;
  riskDecisionId: string;
  riskAllowanceId?: string | null;
  riskAllowanceBindingDigest?: string | null;
  openingCausalLineageJson?: string | null;
  openingCausalLineageDigest?: string | null;
  strategySignalId?: string | null;
  allocationDecisionId?: string | null;
  credentialId?: string | null;
}

export interface TransitionOrderInput {
  orderId: string;
  expectedStateVersion: number;
  toState: OrderState;
  filledQuantity?: string;
  avgFillPrice?: string | null;
  exchangeOrderId?: string | null;
  eventType?: OrderEventType;
  eventPayload?: string | null;
  occurredAt?: Date;
}

export interface RecordFillInput {
  orderId: string;
  exchangeTradeId: string;
  price: string;
  quantity: string;
  fee?: string;
  feeAsset?: string;
  executedAt: Date;
  executionFactKind?: ExecutionFactKind;
  economics?: CostedFillEconomics;
  fillId?: string;
  economicsRow?: FillExecutionEconomicsRow;
}

export interface RecordFillProgressInput {
  orderId: string;
  exchangeTradeId: string;
  price: string;
  quantity: string;
  fee?: string;
  feeAsset?: string;
  executedAt: Date;
  executionFactKind: ExecutionFactKind;
  economics: CostedFillEconomics;
  fillId: string;
  economicsRow: FillExecutionEconomicsRow;
  filledQuantity: string;
  avgFillPrice: string;
}

export interface OpenOrdersFilter {
  executionMode?: OrderExecutionMode;
  venue?: string;
}

export interface OrderRepository {
  createOrder(context: OrgContext, input: CreateOrderInput): Promise<OrderRow>;
  getOrderById(context: OrgContext, id: string): Promise<OrderRow | null>;
  findOrderByClientOrderId(context: OrgContext, clientOrderId: string): Promise<OrderRow | null>;
  findOrderByIdempotencyKey(context: OrgContext, idempotencyKey: string): Promise<OrderRow | null>;
  listOpenOrders(context: OrgContext, filter?: OpenOrdersFilter): Promise<OrderRow[]>;
  listOrders(context: OrgContext, filter?: OpenOrdersFilter): Promise<OrderRow[]>;
  transitionOrder(context: OrgContext, input: TransitionOrderInput): Promise<OrderRow>;
  recordFill(context: OrgContext, input: RecordFillInput): Promise<FillRow>;
  recordFillProgress(context: OrgContext, input: RecordFillProgressInput): Promise<FillRow>;
  listEvents(context: OrgContext, orderId: string): Promise<OrderEventRow[]>;
  listFills(context: OrgContext, orderId: string): Promise<FillRow[]>;
}

function nullableStringEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = a ?? null;
  const right = b ?? null;
  return left === right;
}

export function orderPayloadMatches(existing: OrderRow, input: CreateOrderInput): boolean {
  return (
    existing.symbol === input.symbol &&
    existing.side === input.side &&
    existing.type === input.type &&
    existing.quantity === input.quantity &&
    existing.executionMode === input.executionMode &&
    nullableStringEqual(existing.historicalRunId, input.historicalRunId) &&
    nullableStringEqual(existing.historicalAccountKey, input.historicalAccountKey) &&
    existing.venue === input.venue &&
    existing.riskDecisionId === input.riskDecisionId &&
    nullableStringEqual(existing.riskAllowanceId, input.riskAllowanceId) &&
    nullableStringEqual(existing.riskAllowanceBindingDigest, input.riskAllowanceBindingDigest) &&
    nullableStringEqual(existing.openingCausalLineageJson, input.openingCausalLineageJson) &&
    nullableStringEqual(existing.openingCausalLineageDigest, input.openingCausalLineageDigest) &&
    nullableStringEqual(existing.price, input.price) &&
    nullableStringEqual(existing.strategySignalId, input.strategySignalId) &&
    nullableStringEqual(existing.allocationDecisionId, input.allocationDecisionId)
  );
}

export function assertOrderOpeningCausalLineage(
  organizationId: string,
  input: CreateOrderInput,
): void {
  const json = input.openingCausalLineageJson ?? null;
  const digest = input.openingCausalLineageDigest ?? null;
  if ((json === null) !== (digest === null)) {
    throw new Error("ORDER_OPENING_CAUSAL_LINEAGE_INCOMPLETE");
  }
  if (json === null || digest === null) return;
  const lineage = parseOpeningCausalLineageV1(json);
  if (lineage.contentDigest !== digest) {
    throw new Error("ORDER_OPENING_CAUSAL_LINEAGE_DIGEST_MISMATCH");
  }
  if (lineage.organizationId !== organizationId || lineage.symbol !== input.symbol) {
    throw new Error("ORDER_OPENING_CAUSAL_LINEAGE_SCOPE_MISMATCH");
  }
  if (lineage.riskAllowanceId !== (input.riskAllowanceId ?? "")) {
    throw new Error("ORDER_OPENING_CAUSAL_LINEAGE_ALLOWANCE_MISMATCH");
  }
}

export function fillPayloadMatches(existing: FillRow, input: RecordFillInput): boolean {
  const fee = input.fee ?? "0";
  const feeAsset = input.feeAsset ?? "";
  return (
    existing.price === input.price &&
    existing.quantity === input.quantity &&
    existing.fee === fee &&
    existing.feeAsset === feeAsset &&
    existing.executedAt.getTime() === input.executedAt.getTime()
  );
}

export type { ExecutionFactKind, CostedFillEconomics, FillExecutionEconomicsRow };

export function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}
