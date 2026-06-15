import type {
  OrderExecutionMode,
  OrderEventType,
  OrderSide,
  OrderState,
  OrderType,
} from "@/lib/trader/execution/types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export interface OrderRow {
  id: string;
  organizationId: string;
  credentialId: string | null;
  venue: string;
  executionMode: OrderExecutionMode;
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
  venue: string;
  executionMode: OrderExecutionMode;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  price?: string | null;
  quantity: string;
  clientOrderId: string;
  idempotencyKey: string;
  riskDecisionId: string;
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
  transitionOrder(context: OrgContext, input: TransitionOrderInput): Promise<OrderRow>;
  recordFill(context: OrgContext, input: RecordFillInput): Promise<FillRow>;
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
    existing.venue === input.venue &&
    existing.riskDecisionId === input.riskDecisionId &&
    nullableStringEqual(existing.price, input.price) &&
    nullableStringEqual(existing.strategySignalId, input.strategySignalId) &&
    nullableStringEqual(existing.allocationDecisionId, input.allocationDecisionId)
  );
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

export function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}
