import { describe, expect, it } from "vitest";

import type { Order } from "@/lib/trader/connectors/types";
import { createExecutionReportV2 } from "@/lib/trader/execution/v2/contracts";
import { createRealitySourceReportV2 } from "@/lib/trader/reality/v2/contracts";
import { routeRealityIngressV2 } from "@/lib/trader/reality/v2/ingress";
import {
  assertRealitySourceReportAdmissionV2,
  EXCLUDED_REALITY_SOURCE_CLASSES_V2,
} from "@/lib/trader/reality/v2/source-admission";

const ORG = "00000000-0000-4000-8000-000000000679";
const ACCOUNT = "htx-spot-d";
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const DIGEST_C = "c".repeat(64);
const context = {
  accountId: ACCOUNT,
  lineage: {
    lineageKind: "RAW_CAPTURE_V1" as const,
    rawCaptureSourceId: "00000000-0000-4000-8000-000000000680",
    rawCaptureReceiptDigestHex: DIGEST_A,
    rawBytesDigestHex: DIGEST_B,
    storageBindingDigestHex: DIGEST_C,
  },
  validAtUtc: "2026-08-22T10:00:00.000Z",
  nativeRevision: "1",
  supersedesNativeRevision: null,
  connectorVersion: "test-v1",
};
const order: Order = {
  orderId: "order-d",
  clientOrderId: "client-d",
  symbol: "BTC/USDT",
  side: "buy",
  type: "limit",
  status: "filled",
  price: "25000",
  quantity: "0.001",
  filledQuantity: "0.001",
  createdAt: context.validAtUtc,
  updatedAt: context.validAtUtc,
};

function seal(draft: ReturnType<typeof admittedDrafts>[number]) {
  const report = createRealitySourceReportV2({
    ...draft,
    organizationId: ORG,
    accountId: ACCOUNT,
    knowledgeAtUtc: "2026-08-22T10:00:01.000Z",
  });
  assertRealitySourceReportAdmissionV2(report);
  return report;
}

function admittedDrafts(route: ReturnType<typeof routeRealityIngressV2>) {
  if (route.status !== "ADMITTED") throw new Error("expected admitted route");
  return route.drafts;
}

function executionFills(times: readonly unknown[]) {
  return createExecutionReportV2({
    executionReportId: "00000000-0000-4000-8000-000000067904",
    organizationId: ORG, accountId: ACCOUNT,
    executionAttemptId: "00000000-0000-4000-8000-000000067902",
    executionAttemptContentDigestHex: DIGEST_A,
    reportSequence: "1", source: "CONNECTOR", venueOrderId: order.orderId,
    observedAtUtc: context.validAtUtc, previousReportDigestHex: null,
    reportType: "FILL_REPORT_OBSERVED",
    rawObservation: { order, trades: times.map((time, index) => ({
      tradeId: `trade-time-${index}`, orderId: order.orderId, clientOrderId: order.clientOrderId,
      symbol: order.symbol, side: order.side, price: "25000",
      quantity: times.length === 2 ? "0.0005" : "0.001", fee: "0.025", feeAsset: "USDT",
      ...(time === undefined ? {} : { executedAt: time }),
    })) },
  });
}

describe("Reality V2 exhaustive ingress routing (DEE-679)", () => {
  it("admits exactly the four raw HTX spot REST classes with digest-only lineage", () => {
    const routes = [
      routeRealityIngressV2({ kind: "HTX_SPOT_ORDER_REST", context, order }),
      routeRealityIngressV2({
        kind: "HTX_SPOT_FILL_REST",
        context,
        trade: {
          tradeId: "trade-d", orderId: order.orderId, clientOrderId: order.clientOrderId,
          symbol: order.symbol, side: order.side, price: "25000", quantity: "0.001",
          fee: "0.025", feeAsset: "USDT", executedAt: context.validAtUtc,
        },
      }),
      routeRealityIngressV2({
        kind: "HTX_SPOT_BALANCE_REST",
        context: { ...context, sourceNativeId: `${ACCOUNT}:BTC` },
        balance: { asset: "BTC", free: "0.001", locked: "0", total: "0.001" },
      }),
      routeRealityIngressV2({
        kind: "HTX_SPOT_ACCOUNT_REST",
        context,
        account: {
          accountId: ACCOUNT, venue: "htx", marketType: "spot",
          permissions: ["trade", "read"], accountState: "working",
        },
      }),
    ];
    expect(routes.map((route) => route.status)).toEqual([
      "ADMITTED", "ADMITTED", "ADMITTED", "ADMITTED",
    ]);
    const reports = routes.flatMap((route) => admittedDrafts(route).map(seal));
    expect(reports.map((report) => report.sourceKind)).toEqual([
      "HTX_SPOT_ORDER_REST", "HTX_SPOT_FILL_REST",
      "HTX_SPOT_BALANCE_REST", "HTX_SPOT_ACCOUNT_REST",
    ]);
    expect(JSON.stringify(reports)).not.toMatch(/rawPayload|rawBody|apiKey|secret|signature/);
  });

  it("maps exact ExecutionReportV2 trades but never fabricates fill from status-only FILLED", () => {
    const base = {
      executionReportId: "00000000-0000-4000-8000-000000067901",
      organizationId: ORG,
      accountId: ACCOUNT,
      executionAttemptId: "00000000-0000-4000-8000-000000067902",
      executionAttemptContentDigestHex: DIGEST_A,
      reportSequence: "1",
      source: "CONNECTOR" as const,
      venueOrderId: order.orderId,
      observedAtUtc: context.validAtUtc,
      previousReportDigestHex: null,
    };
    const statusOnly = createExecutionReportV2({
      ...base,
      reportType: "VENUE_STATUS_OBSERVED",
      rawObservation: { order },
    });
    const statusDrafts = admittedDrafts(routeRealityIngressV2({
      kind: "EXECUTION_REPORT_V2",
      report: statusOnly,
    }));
    expect(statusDrafts.map((draft) => draft.primitiveAssertion?.kind)).toEqual(["ORDER"]);

    const fill = createExecutionReportV2({
      ...base,
      executionReportId: "00000000-0000-4000-8000-000000067903",
      reportType: "FILL_REPORT_OBSERVED",
      rawObservation: {
        order,
        trades: [{
          tradeId: "trade-d", orderId: order.orderId, clientOrderId: order.clientOrderId,
          symbol: order.symbol, side: order.side, price: "25000", quantity: "0.001",
          fee: "0.025", feeAsset: "USDT", executedAt: context.validAtUtc,
        }],
      },
    });
    const fillDrafts = admittedDrafts(routeRealityIngressV2({
      kind: "EXECUTION_REPORT_V2",
      report: fill,
    }));
    expect(fillDrafts.map((draft) => draft.primitiveAssertion?.kind)).toEqual(["ORDER", "FILL"]);
    fillDrafts.map(seal).forEach(assertRealitySourceReportAdmissionV2);
  });

  it("preserves each venue fill time independently of report observation and Reality knowledge", () => {
    const times = ["2026-08-22T09:59:58.123Z", "2026-08-22T09:59:59.456Z"];
    const report = executionFills(times);
    const original = JSON.stringify(report);
    const drafts = admittedDrafts(routeRealityIngressV2({ kind: "EXECUTION_REPORT_V2", report }));
    const fills = drafts.filter(draft => draft.primitiveAssertion?.kind === "FILL");
    expect(fills.map(draft => draft.validAtUtc)).toEqual(times);
    expect(drafts.find(draft => draft.primitiveAssertion?.kind === "ORDER")?.validAtUtc)
      .toBe(report.observedAtUtc);
    expect(fills.map(draft => draft.primitiveAssertion)).toEqual(times.map((_, index) => ({
      kind: "FILL", venueTradeId: `trade-time-${index}`, venueOrderId: order.orderId,
      symbol: order.symbol, side: order.side, quantity: "0.0005", price: "25000",
      feeAmount: "0.025", feeAsset: "USDT", settlementStatus: "OBSERVED",
    })));
    const sealed = fills.map(seal);
    expect(sealed.map(value => value.validAtUtc)).toEqual(times);
    expect(sealed.map(value => value.knowledgeAtUtc)).toEqual(times.map(() => "2026-08-22T10:00:01.000Z"));
    expect(fills.map(seal)).toEqual(sealed);
    expect(JSON.stringify(report)).toBe(original);
  });

  it.each([
    ["missing", undefined], ["null", null], ["empty", ""], ["number", 123],
    ["malformed", "not-a-time"], ["normalized calendar", "2026-02-30T10:00:00.000Z"],
    ["offset form", "2026-08-22T11:59:59.000+02:00"],
    ["missing milliseconds", "2026-08-22T09:59:59Z"],
    ["submillisecond precision", "2026-08-22T09:59:59.123456Z"],
    ["leading whitespace", " 2026-08-22T09:59:59.000Z"],
  ])("refuses %s fill time without substituting report observation", (_name, time) => {
    const report = executionFills([time]);
    expect(() => routeRealityIngressV2({ kind: "EXECUTION_REPORT_V2", report }))
      .toThrow("ExecutionReportV2 fill evidence is fail-uncertain");
  });

  it("keeps knowledge-before-valid rejection and event observation timing", () => {
    const report = executionFills(["2026-08-22T10:00:02.000Z"]);
    const drafts = admittedDrafts(routeRealityIngressV2({ kind: "EXECUTION_REPORT_V2", report }));
    const fill = drafts.find(draft => draft.primitiveAssertion?.kind === "FILL")!;
    expect(() => seal(fill)).toThrow("knowledge time cannot precede source-asserted valid time");
    const { contentDigestHex, schemaVersion, ...draft } = report;
    const event = createExecutionReportV2({ ...draft, reportType: "VENUE_STATUS_OBSERVED", rawObservation: {} });
    expect(event.schemaVersion).toBe(schemaVersion);
    expect(event.contentDigestHex).not.toBe(contentDigestHex);
    const events = admittedDrafts(routeRealityIngressV2({ kind: "EXECUTION_REPORT_V2", report: event }));
    expect(events).toHaveLength(1);
    expect(events[0].primitiveAssertion?.kind).toBe("VENUE_EVENT");
    expect(events[0].validAtUtc).toBe(event.observedAtUtc);
  });

  it("returns explicit digest receipts for every excluded source class", () => {
    const receipts = EXCLUDED_REALITY_SOURCE_CLASSES_V2.map((sourceClass) =>
      routeRealityIngressV2({ kind: "EXCLUDED", sourceClass, evidence: { sourceClass } }));
    expect(receipts).toHaveLength(8);
    expect(receipts.every((receipt) => receipt.status === "EXCLUDED")).toBe(true);
    expect(receipts.every((receipt) =>
      receipt.status === "EXCLUDED" && receipt.reasonCode === "SOURCE_CLASS_NOT_RATIFIED" &&
      /^[0-9a-f]{64}$/.test(receipt.evidenceDigestHex))).toBe(true);
  });

  it("fails uncertain for an unknown runtime source class", () => {
    const route = routeRealityIngressV2({
      kind: "UNRATIFIED_DYNAMIC_SOURCE",
      rawBody: "must-not-be-copied",
    } as never);
    expect(route).toEqual({
      status: "FAIL_UNCERTAIN",
      sourceClass: "UNKNOWN_SOURCE_CLASS",
      reasonCode: "UNKNOWN_SOURCE_CLASS",
      evidenceDigestHex: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(JSON.stringify(route)).not.toContain("must-not-be-copied");
  });
});
