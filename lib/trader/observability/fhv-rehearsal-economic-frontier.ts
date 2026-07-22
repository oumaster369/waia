import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import type { OrderRepository, OrderRow } from "@/lib/trader/execution/order-repository.types";
import type { OrderState } from "@/lib/trader/execution/types";
import { derivePaperPnLPeriod } from "@/lib/trader/paper/derive-paper-pnl-period";
import type { PaperPnLWindow } from "@/lib/trader/paper/paper-pnl-period.types";
import { compareDecimal } from "@/lib/trader/risk/numeric";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export const FHV_REHEARSAL_ECONOMIC_FRONTIER_SCHEMA_VERSION =
  "fhv-rehearsal-economic-frontier/v1" as const;

export type FhvRehearsalEconomicFrontierV1 = Readonly<{
  schemaVersion: typeof FHV_REHEARSAL_ECONOMIC_FRONTIER_SCHEMA_VERSION;
  runId: string;
  organizationId: string;
  safeResumeThroughCycleIndex: number;
  mode: "QUIESCENT_NO_ECONOMIC_STATE";
  totalOrderCount: number;
  openOrderCount: number;
  submittedOrderCount: number;
  fillCount: number;
  openPositionCount: number;
  pendingReconciliationCount: number;
  realizedPnlUsdt: string;
  markedPnlUsdt: string;
  feesPaidUsdt: string;
  cashDeltaUsdt: string;
  htrAccountingActive: boolean;
  historicalExecutionActive: boolean;
  portfolioAccountingActive: boolean;
  wp21RuntimeActive: boolean;
  contentDigest: string;
}>;

export class FhvRehearsalEconomicFrontierError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvRehearsalEconomicFrontierError";
  }
}

const OPEN_ORDER_STATES: ReadonlySet<OrderState> = new Set([
  "CREATED",
  "RISK_APPROVED",
  "SENT_TO_EXCHANGE",
  "ACCEPTED",
  "PARTIALLY_FILLED",
  "CANCEL_REQUESTED",
  "RECONCILIATION_REQUIRED",
]);

const SUBMITTED_ORDER_STATES: ReadonlySet<OrderState> = new Set([
  "SENT_TO_EXCHANGE",
  "ACCEPTED",
  "PARTIALLY_FILLED",
]);

function digestEconomicFrontierPayload(
  record: Omit<FhvRehearsalEconomicFrontierV1, "contentDigest">,
): string {
  return computePayloadDigest(record);
}

export function serializeFhvRehearsalEconomicFrontier(
  record: Omit<FhvRehearsalEconomicFrontierV1, "contentDigest">,
): FhvRehearsalEconomicFrontierV1 {
  return { ...record, contentDigest: digestEconomicFrontierPayload(record) };
}

export function validateFhvRehearsalEconomicFrontierDigest(
  frontier: FhvRehearsalEconomicFrontierV1,
): void {
  const { contentDigest, ...withoutDigest } = frontier;
  const expected = digestEconomicFrontierPayload(withoutDigest);
  if (expected !== contentDigest) {
    throw new FhvRehearsalEconomicFrontierError(
      "FHV_REHEARSAL_ECONOMIC_FRONTIER_INVALID",
      "Economic frontier content digest mismatch.",
    );
  }
}

function countOpenPositions(positions: readonly { quantity: string }[]): number {
  return positions.filter((position) => compareDecimal(position.quantity, "0") !== 0).length;
}

function isNonZeroDecimal(value: string): boolean {
  return compareDecimal(value, "0") !== 0;
}

export async function measureFhvRehearsalEconomicState(input: {
  context: OrgContext;
  orderRepository: OrderRepository;
  organizationId: string;
  runId: string;
  safeResumeThroughCycleIndex: number;
  window: PaperPnLWindow;
  runtimeFlags: Readonly<{
    htrAccountingActive: boolean;
    historicalExecutionActive: boolean;
    portfolioAccountingActive: boolean;
    wp21RuntimeActive: boolean;
  }>;
}): Promise<FhvRehearsalEconomicFrontierV1> {
  const orders = await input.orderRepository.listOrders(input.context, { executionMode: "mock" });
  let fillCount = 0;
  for (const order of orders) {
    const fills = await input.orderRepository.listFills(input.context, order.id);
    fillCount += fills.length;
  }

  const rollup = await derivePaperPnLPeriod({
    context: input.context,
    orderRepository: input.orderRepository,
    executionMode: "mock",
    window: input.window,
  });

  const openOrderCount = orders.filter((order) => OPEN_ORDER_STATES.has(order.state)).length;
  const submittedOrderCount = orders.filter((order) =>
    SUBMITTED_ORDER_STATES.has(order.state),
  ).length;
  const pendingReconciliationCount = orders.filter(
    (order) => order.state === "RECONCILIATION_REQUIRED",
  ).length;
  const openPositionCount = countOpenPositions(rollup.endSnapshot.positions);
  const realizedPnlUsdt = rollup.endSnapshot.realizedPnl;
  const markedPnlUsdt = rollup.endSnapshot.unrealizedPnl ?? "0";
  const feesPaidUsdt = rollup.endSnapshot.totalFees;
  const cashDeltaUsdt = rollup.periodTotalPnlChange ?? "0";

  return serializeFhvRehearsalEconomicFrontier({
    schemaVersion: FHV_REHEARSAL_ECONOMIC_FRONTIER_SCHEMA_VERSION,
    runId: input.runId,
    organizationId: input.organizationId,
    safeResumeThroughCycleIndex: input.safeResumeThroughCycleIndex,
    mode: "QUIESCENT_NO_ECONOMIC_STATE",
    totalOrderCount: orders.length,
    openOrderCount,
    submittedOrderCount,
    fillCount,
    openPositionCount,
    pendingReconciliationCount,
    realizedPnlUsdt,
    markedPnlUsdt,
    feesPaidUsdt,
    cashDeltaUsdt,
    htrAccountingActive: input.runtimeFlags.htrAccountingActive,
    historicalExecutionActive: input.runtimeFlags.historicalExecutionActive,
    portfolioAccountingActive: input.runtimeFlags.portfolioAccountingActive,
    wp21RuntimeActive: input.runtimeFlags.wp21RuntimeActive,
  });
}

export function assertFhvRehearsalEconomicFrontierQuiescent(
  frontier: FhvRehearsalEconomicFrontierV1,
): void {
  validateFhvRehearsalEconomicFrontierDigest(frontier);
  const quiescent =
    frontier.totalOrderCount === 0 &&
    frontier.openOrderCount === 0 &&
    frontier.submittedOrderCount === 0 &&
    frontier.fillCount === 0 &&
    frontier.openPositionCount === 0 &&
    frontier.pendingReconciliationCount === 0 &&
    !isNonZeroDecimal(frontier.realizedPnlUsdt) &&
    !isNonZeroDecimal(frontier.markedPnlUsdt) &&
    !isNonZeroDecimal(frontier.feesPaidUsdt) &&
    !isNonZeroDecimal(frontier.cashDeltaUsdt) &&
    frontier.htrAccountingActive === false &&
    frontier.historicalExecutionActive === false &&
    frontier.portfolioAccountingActive === false &&
    frontier.wp21RuntimeActive === false;

  if (!quiescent) {
    throw new FhvRehearsalEconomicFrontierError(
      "FHV_REHEARSAL_ECONOMIC_FRONTIER_NOT_QUIESCENT",
      "Economic frontier is not quiescent; resumable checkpoint rejected.",
    );
  }
}

export function validateFhvRehearsalEconomicFrontierBinding(input: {
  frontier: FhvRehearsalEconomicFrontierV1;
  runId: string;
  organizationId: string;
  safeResumeThroughCycleIndex: number;
}): void {
  validateFhvRehearsalEconomicFrontierDigest(input.frontier);
  if (input.frontier.runId !== input.runId) {
    throw new FhvRehearsalEconomicFrontierError(
      "FHV_REHEARSAL_ECONOMIC_FRONTIER_INVALID",
      "Economic frontier runId mismatch.",
    );
  }
  if (input.frontier.organizationId !== input.organizationId) {
    throw new FhvRehearsalEconomicFrontierError(
      "FHV_REHEARSAL_ECONOMIC_FRONTIER_INVALID",
      "Economic frontier organizationId mismatch.",
    );
  }
  if (input.frontier.safeResumeThroughCycleIndex !== input.safeResumeThroughCycleIndex) {
    throw new FhvRehearsalEconomicFrontierError(
      "FHV_REHEARSAL_ECONOMIC_FRONTIER_INVALID",
      "Economic frontier cycle index mismatch.",
    );
  }
}

export function assertFhvRehearsalEconomicFrontierPresent(
  frontier: FhvRehearsalEconomicFrontierV1 | undefined,
): FhvRehearsalEconomicFrontierV1 {
  if (!frontier) {
    throw new FhvRehearsalEconomicFrontierError(
      "FHV_REHEARSAL_ECONOMIC_FRONTIER_INVALID",
      "Checkpoint missing economic frontier state.",
    );
  }
  validateFhvRehearsalEconomicFrontierDigest(frontier);
  return frontier;
}

/** Test helper: build a synthetic frontier for negative-case matrix tests. */
export function buildSyntheticEconomicFrontier(
  overrides: Partial<Omit<FhvRehearsalEconomicFrontierV1, "contentDigest">> & {
    runId: string;
    organizationId: string;
    safeResumeThroughCycleIndex: number;
  },
): FhvRehearsalEconomicFrontierV1 {
  return serializeFhvRehearsalEconomicFrontier({
    schemaVersion: FHV_REHEARSAL_ECONOMIC_FRONTIER_SCHEMA_VERSION,
    mode: "QUIESCENT_NO_ECONOMIC_STATE",
    totalOrderCount: 0,
    openOrderCount: 0,
    submittedOrderCount: 0,
    fillCount: 0,
    openPositionCount: 0,
    pendingReconciliationCount: 0,
    realizedPnlUsdt: "0",
    markedPnlUsdt: "0",
    feesPaidUsdt: "0",
    cashDeltaUsdt: "0",
    htrAccountingActive: false,
    historicalExecutionActive: false,
    portfolioAccountingActive: false,
    wp21RuntimeActive: false,
    ...overrides,
  });
}

export function summarizeOrderCounts(orders: readonly OrderRow[]): {
  totalOrderCount: number;
  openOrderCount: number;
  submittedOrderCount: number;
  pendingReconciliationCount: number;
} {
  return {
    totalOrderCount: orders.length,
    openOrderCount: orders.filter((order) => OPEN_ORDER_STATES.has(order.state)).length,
    submittedOrderCount: orders.filter((order) => SUBMITTED_ORDER_STATES.has(order.state)).length,
    pendingReconciliationCount: orders.filter((order) => order.state === "RECONCILIATION_REQUIRED")
      .length,
  };
}
