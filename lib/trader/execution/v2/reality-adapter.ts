import {
  validateExecutionReportV2,
  type ExecutionReportV2,
} from "@/lib/trader/execution/v2/contracts";
import type { AppendRealitySourceReportV2Input } from "@/lib/trader/reality/v2/repository-postgres";

type Evidence = Readonly<Record<string, unknown>>;

function evidence(value: unknown): Evidence | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Evidence
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function base(report: ExecutionReportV2) {
  return {
    sourceKind: "EXECUTION_REPORT_V2" as const,
    attributionStatus: "ATTRIBUTED" as const,
    lineage: {
      lineageKind: "EXECUTION_REPORT_V2" as const,
      executionReportId: report.executionReportId,
      executionReportDigestHex: report.contentDigestHex,
    },
    provenance: {
      venue: "HTX" as const,
      transport: "INTERNAL_APPEND_ONLY" as const,
      connectorId: "execution-v2",
      connectorVersion: "execution-report/v2",
      adapterVersion: "reality-execution-v2-v1",
      sourceFinalityMetadata: [
        { key: "reportSequence", value: report.reportSequence },
        { key: "reportType", value: report.reportType },
      ],
    },
    structuralVerification: "VERIFIED" as const,
    verificationReasonCodes: [] as const,
    validAtUtc: report.observedAtUtc,
  };
}

function orderDraft(
  report: ExecutionReportV2,
  order: Evidence,
): AppendRealitySourceReportV2Input | null {
  const orderId = text(order.orderId);
  const symbol = text(order.symbol);
  const status = text(order.status);
  const quantity = text(order.quantity);
  const side = order.side === "buy" || order.side === "sell" ? order.side : null;
  const orderType = order.type === "market" || order.type === "limit" ? order.type : null;
  if (!orderId || !symbol || !status || !quantity || !side || !orderType) return null;
  const price = orderType === "limit" ? text(order.price) : null;
  if (orderType === "limit" && price === null) return null;
  return {
    ...base(report),
    sourceNativeIdentity: {
      identityKind: "EXECUTION_REPORT_ID",
      nativeId: `${report.executionReportId}:order:${orderId}`,
      nativeRevision: null,
      supersedesNativeRevision: null,
    },
    subject: { subjectClass: "ORDER", subjectKey: `HTX:${report.accountId}:ORDER:${orderId}` },
    primitiveAssertion: {
      kind: "ORDER",
      venueOrderId: orderId,
      clientOrderId: text(order.clientOrderId),
      symbol,
      side,
      orderType,
      status,
      quantity,
      limitPrice: price,
    },
  };
}

function fillDraft(
  report: ExecutionReportV2,
  trade: Evidence,
): AppendRealitySourceReportV2Input | null {
  const tradeId = text(trade.tradeId);
  const orderId = text(trade.orderId);
  const symbol = text(trade.symbol);
  const quantity = text(trade.quantity);
  const price = text(trade.price);
  const feeAmount = text(trade.fee);
  const feeAsset = text(trade.feeAsset);
  const side = trade.side === "buy" || trade.side === "sell" ? trade.side : null;
  if (!tradeId || !orderId || !symbol || !quantity || !price || feeAmount === null ||
    !feeAsset || !side) return null;
  return {
    ...base(report),
    sourceNativeIdentity: {
      identityKind: "EXECUTION_REPORT_ID",
      nativeId: `${report.executionReportId}:trade:${tradeId}`,
      nativeRevision: null,
      supersedesNativeRevision: null,
    },
    subject: { subjectClass: "FILL", subjectKey: `HTX:${report.accountId}:FILL:${tradeId}` },
    primitiveAssertion: {
      kind: "FILL",
      venueTradeId: tradeId,
      venueOrderId: orderId,
      symbol,
      side,
      quantity,
      price,
      feeAmount,
      feeAsset,
      settlementStatus: "OBSERVED",
    },
  };
}

function eventDraft(report: ExecutionReportV2): AppendRealitySourceReportV2Input {
  const order = evidence(report.rawObservation.order);
  return {
    ...base(report),
    sourceNativeIdentity: {
      identityKind: "EXECUTION_REPORT_ID",
      nativeId: report.executionReportId,
      nativeRevision: null,
      supersedesNativeRevision: null,
    },
    subject: {
      subjectClass: "VENUE_EVENT",
      subjectKey: `HTX:${report.accountId}:REPORT:${report.executionReportId}`,
    },
    primitiveAssertion: {
      kind: "VENUE_EVENT",
      eventType: report.reportType,
      venueOrderId: report.venueOrderId,
      status: text(order?.status),
    },
  };
}

/**
 * Converts one immutable HTX ExecutionReportV2 into exact normalized facts.
 * Status-only FILLED/PARTIALLY_FILLED observations remain ORDER/VENUE_EVENT facts;
 * FILL is emitted only from an exact trade row in FILL_REPORT_OBSERVED.
 */
export function adaptExecutionReportV2ToReality(
  report: ExecutionReportV2,
): readonly AppendRealitySourceReportV2Input[] {
  if (!validateExecutionReportV2(report)) throw new Error("invalid ExecutionReportV2 lineage");
  const drafts: AppendRealitySourceReportV2Input[] = [];
  const order = evidence(report.rawObservation.order);
  if (order) {
    const adaptedOrder = orderDraft(report, order);
    if (adaptedOrder) drafts.push(adaptedOrder);
  }
  if (report.reportType === "FILL_REPORT_OBSERVED" && Array.isArray(report.rawObservation.trades)) {
    for (const value of report.rawObservation.trades) {
      const trade = evidence(value);
      const adaptedFill = trade ? fillDraft(report, trade) : null;
      if (!adaptedFill) throw new Error("ExecutionReportV2 fill evidence is fail-uncertain");
      drafts.push(adaptedFill);
    }
  }
  if (drafts.length === 0) drafts.push(eventDraft(report));
  return Object.freeze(drafts);
}
