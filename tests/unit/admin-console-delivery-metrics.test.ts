import { describe, expect, it } from "vitest";

import {
  recordRenderAck,
  selectClockOffset,
} from "@/components/trader/admin-console/data/delivery-metrics";

describe("admin console delivery metrics", () => {
  it("uses the smallest precise round trip and ignores a sample wider than 100 ms", () => {
    const offset = selectClockOffset([
      { serverTimeMs: 10_000, tSendMs: 9_000, tRecvMs: 9_400 },
      { serverTimeMs: 20_000, tSendMs: 19_000, tRecvMs: 19_040 },
    ]);
    expect(offset).toEqual({ offsetMs: 980, errorMs: 20 });
  });

  it("records the first render of a version and keeps an offscreen ack separate", () => {
    const first = recordRenderAck([], {
      topic: "orders",
      entityId: "trader_orders:1",
      entityVersion: "2",
      renderedAtMs: 10,
      offscreen: false,
    });
    const again = recordRenderAck(first, {
      topic: "orders",
      entityId: "trader_orders:1",
      entityVersion: "2",
      renderedAtMs: 30,
      offscreen: false,
    });
    const offscreen = recordRenderAck(again, {
      topic: "orders",
      entityId: "trader_orders:1",
      entityVersion: "2",
      renderedAtMs: 12,
      offscreen: true,
    });
    expect(again).toHaveLength(1);
    expect(offscreen).toHaveLength(2);
  });
});
