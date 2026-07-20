import type { LifecycleRepository } from "@/lib/trader/lifecycle/lifecycle-repository.types";
import type {
  PositionLotRow,
  TradeLineageAtOpen,
} from "@/lib/trader/lifecycle/trade-lifecycle.types";
import { LIFECYCLE_DUST_REMAINDER_REASON } from "@/lib/trader/lifecycle/trade-lifecycle-semantics";
import { compareDecimal, multiplyDecimal, subtractDecimal } from "@/lib/trader/risk/numeric";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type RecordDustRemainderFlatInput = {
  context: OrgContext;
  lot: PositionLotRow;
  markPrice: string;
  minOrderQty: string;
  accountKey: string;
  lineage: TradeLineageAtOpen;
};

type RecordLifecyclePhase = (input: {
  context: OrgContext;
  entityType: "TRADE";
  entityId: string;
  phase: "FORCED_FLAT";
  occurredAt: Date;
  payload?: Record<string, unknown>;
}) => Promise<void>;

export async function recordDustRemainderFlat(
  deps: {
    repository: LifecycleRepository;
    newId?: () => string;
    nowMs?: () => number;
    recordLifecyclePhase: RecordLifecyclePhase;
  },
  input: RecordDustRemainderFlatInput,
): Promise<boolean> {
  const { lot, markPrice, minOrderQty } = input;
  if (compareDecimal(lot.remainingQty, "0") <= 0) {
    return false;
  }
  if (compareDecimal(lot.remainingQty, minOrderQty) >= 0) {
    return false;
  }

  const newId = deps.newId ?? (() => crypto.randomUUID());
  const syntheticId = `dust-remainder:${lot.id}`;
  const executedAt = deps.nowMs ? new Date(deps.nowMs()) : new Date();
  const proceeds = multiplyDecimal(markPrice, lot.remainingQty);
  const cost = multiplyDecimal(lot.remainingQty, lot.avgCost);
  const legPnl = subtractDecimal(proceeds, cost);
  const frozenAt = deps.nowMs ? new Date(deps.nowMs()) : new Date();

  await deps.repository.insertTradeLeg(input.context, {
    leg: {
      id: newId(),
      organizationId: input.context.organizationId,
      tradeId: lot.tradeId,
      positionLotId: lot.id,
      kind: "FORCED_FLAT",
      orderId: "",
      fillId: null,
      syntheticId,
      quantity: lot.remainingQty,
      price: markPrice,
      fee: "0",
      executedAt,
      legPnl,
    },
  });

  await deps.repository.updatePositionLot(input.context, {
    lotId: lot.id,
    remainingQty: "0",
    state: "CLOSED",
    closedAt: executedAt,
  });

  const trade = await deps.repository.getTradeById(input.context, lot.tradeId);
  if (!trade) {
    throw new Error(`[trader/lifecycle/recorder] trade missing for dust lot ${lot.id}`);
  }

  await deps.repository.updateTradeOperational(input.context, {
    tradeId: trade.id,
    state: "CLOSED",
    closedAt: executedAt,
    realizedPnl: legPnl,
    frozenAt,
  });

  await deps.recordLifecyclePhase({
    context: input.context,
    entityType: "TRADE",
    entityId: trade.id,
    phase: "FORCED_FLAT",
    occurredAt: executedAt,
    payload: {
      syntheticId,
      positionLotId: lot.id,
      reasonCode: LIFECYCLE_DUST_REMAINDER_REASON,
      dustRemainder: lot.remainingQty,
      minOrderQty,
    },
  });

  return true;
}
