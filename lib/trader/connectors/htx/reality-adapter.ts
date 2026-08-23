import type { AccountInfo, Balance, Order, Trade } from "@/lib/trader/connectors/types";
import type {
  RealityRawCaptureLineageV2,
} from "@/lib/trader/reality/v2/contracts";
import type { AppendRealitySourceReportV2Input } from "@/lib/trader/reality/v2/repository-postgres";

export type RawHtxObservationContextV2 = Readonly<{
  accountId: string;
  lineage: RealityRawCaptureLineageV2;
  validAtUtc: string;
  nativeRevision: string | null;
  supersedesNativeRevision: string | null;
  connectorVersion: string;
}>;

function provenance(context: RawHtxObservationContextV2) {
  return {
    venue: "HTX" as const,
    transport: "REST" as const,
    connectorId: "htx-exchange-connector",
    connectorVersion: context.connectorVersion,
    adapterVersion: "reality-htx-spot-v1",
    sourceFinalityMetadata: [],
  } as const;
}

function rawBase(
  context: RawHtxObservationContextV2,
  sourceKind: AppendRealitySourceReportV2Input["sourceKind"],
) {
  return {
    sourceKind,
    attributionStatus: "ATTRIBUTED" as const,
    lineage: context.lineage,
    provenance: provenance(context),
    structuralVerification: "VERIFIED" as const,
    verificationReasonCodes: [] as const,
    validAtUtc: context.validAtUtc,
  };
}

/** Adapts only normalized output paired with the exact encrypted raw-capture receipt. */
export function adaptHtxSpotOrderRealityV2(
  context: RawHtxObservationContextV2,
  order: Order,
): AppendRealitySourceReportV2Input {
  return {
    ...rawBase(context, "HTX_SPOT_ORDER_REST"),
    sourceNativeIdentity: {
      identityKind: "HTX_ORDER_ID",
      nativeId: order.orderId,
      nativeRevision: context.nativeRevision,
      supersedesNativeRevision: context.supersedesNativeRevision,
    },
    subject: { subjectClass: "ORDER", subjectKey: `HTX:${context.accountId}:ORDER:${order.orderId}` },
    primitiveAssertion: {
      kind: "ORDER",
      venueOrderId: order.orderId,
      clientOrderId: order.clientOrderId || null,
      symbol: order.symbol,
      side: order.side,
      orderType: order.type,
      status: order.status,
      quantity: order.quantity,
      limitPrice: order.type === "limit" ? order.price ?? null : null,
    },
  };
}

export function adaptHtxSpotFillRealityV2(
  context: RawHtxObservationContextV2,
  trade: Trade,
): AppendRealitySourceReportV2Input {
  return {
    ...rawBase(context, "HTX_SPOT_FILL_REST"),
    sourceNativeIdentity: {
      identityKind: "HTX_TRADE_ID",
      nativeId: trade.tradeId,
      nativeRevision: context.nativeRevision,
      supersedesNativeRevision: context.supersedesNativeRevision,
    },
    subject: { subjectClass: "FILL", subjectKey: `HTX:${context.accountId}:FILL:${trade.tradeId}` },
    primitiveAssertion: {
      kind: "FILL",
      venueTradeId: trade.tradeId,
      venueOrderId: trade.orderId,
      symbol: trade.symbol,
      side: trade.side,
      quantity: trade.quantity,
      price: trade.price,
      feeAmount: trade.fee,
      feeAsset: trade.feeAsset,
      settlementStatus: "OBSERVED",
    },
  };
}

export function adaptHtxSpotBalanceRealityV2(
  context: RawHtxObservationContextV2 & Readonly<{ sourceNativeId: string }>,
  balance: Balance,
): AppendRealitySourceReportV2Input {
  return {
    ...rawBase(context, "HTX_SPOT_BALANCE_REST"),
    sourceNativeIdentity: {
      identityKind: "HTX_BALANCE_SNAPSHOT_ID",
      nativeId: context.sourceNativeId,
      nativeRevision: context.nativeRevision,
      supersedesNativeRevision: context.supersedesNativeRevision,
    },
    subject: { subjectClass: "BALANCE", subjectKey: `HTX:${context.accountId}:BALANCE:${balance.asset}` },
    primitiveAssertion: {
      kind: "BALANCE",
      asset: balance.asset,
      available: balance.free,
      locked: balance.locked,
      total: balance.total,
    },
  };
}

export function adaptHtxSpotAccountRealityV2(
  context: RawHtxObservationContextV2,
  account: AccountInfo & Readonly<{ accountState: string }>,
): AppendRealitySourceReportV2Input {
  if (account.venue !== "htx" || account.marketType !== "spot" || account.accountId !== context.accountId) {
    throw new Error("HTX Reality account adapter requires the exact scoped spot account");
  }
  return {
    ...rawBase(context, "HTX_SPOT_ACCOUNT_REST"),
    sourceNativeIdentity: {
      identityKind: "HTX_ACCOUNT_SNAPSHOT_ID",
      nativeId: account.accountId,
      nativeRevision: context.nativeRevision,
      supersedesNativeRevision: context.supersedesNativeRevision,
    },
    subject: { subjectClass: "ACCOUNT", subjectKey: `HTX:${context.accountId}:ACCOUNT` },
    primitiveAssertion: {
      kind: "ACCOUNT",
      venueAccountId: account.accountId,
      accountType: "SPOT",
      accountState: account.accountState,
      permissions: [...account.permissions].sort(),
    },
  };
}
