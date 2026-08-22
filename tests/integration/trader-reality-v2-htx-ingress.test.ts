import { describe, expect, it } from "vitest";

import { createRealitySourceReportV2 } from "@/lib/trader/reality/v2/contracts";
import { routeRealityIngressV2 } from "@/lib/trader/reality/v2/ingress";
import { assertRealitySourceReportAdmissionV2 } from "@/lib/trader/reality/v2/source-admission";

describe("Reality V2 HTX ingress boundary integration (DEE-679)", () => {
  it("requires encrypted raw-capture references at the runtime adapter boundary", () => {
    const route = routeRealityIngressV2({
      kind: "HTX_SPOT_FILL_REST",
      context: {
        accountId: "htx-spot-integration",
        lineage: {
          lineageKind: "RAW_CAPTURE_V1",
          rawCaptureSourceId: "00000000-0000-4000-8000-000000067911",
          rawCaptureReceiptDigestHex: "a".repeat(64),
          rawBytesDigestHex: "b".repeat(64),
          storageBindingDigestHex: "c".repeat(64),
        },
        validAtUtc: "2026-08-22T10:00:00.000Z",
        nativeRevision: null,
        supersedesNativeRevision: null,
        connectorVersion: "integration-v1",
      },
      trade: {
        tradeId: "trade-integration", orderId: "order-integration", clientOrderId: "client",
        symbol: "BTC/USDT", side: "buy", price: "25000", quantity: "0.001",
        fee: "0.025", feeAsset: "USDT", executedAt: "2026-08-22T10:00:00.000Z",
      },
    });
    if (route.status !== "ADMITTED") throw new Error("expected admitted HTX fill route");
    const report = createRealitySourceReportV2({
      ...route.drafts[0]!,
      organizationId: "00000000-0000-4000-8000-000000067904",
      accountId: "htx-spot-integration",
      knowledgeAtUtc: "2026-08-22T10:00:01.000Z",
    });
    expect(() => assertRealitySourceReportAdmissionV2(report)).not.toThrow();
    expect(report.lineage).toEqual({
      lineageKind: "RAW_CAPTURE_V1",
      rawCaptureSourceId: "00000000-0000-4000-8000-000000067911",
      rawCaptureReceiptDigestHex: "a".repeat(64),
      rawBytesDigestHex: "b".repeat(64),
      storageBindingDigestHex: "c".repeat(64),
    });
  });
});
