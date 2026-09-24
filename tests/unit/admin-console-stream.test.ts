import { describe, expect, it } from "vitest";

import { encodeAdminConsoleSse } from "@/lib/trader/admin-console/stream/console-stream";
import {
  STREAM_BACKLOG_RESYNC,
  STREAM_SENT_CAP,
  accessRevokedEvent,
  applyConsoleEvent,
  heartbeatEvent,
  planStreamTick,
  type ChangeLogRow,
  type EntityCache,
} from "@/lib/trader/admin-console/stream/protocol";

function row(overrides: Partial<ChangeLogRow> & Pick<ChangeLogRow, "seq" | "xid">): ChangeLogRow {
  return {
    changedAt: "2026-09-23T00:00:00.000Z",
    sourceTable: "trader_orders",
    op: "UPDATE",
    entityId: "order-1",
    organizationId: null,
    entityVersion: overrides.seq,
    ...overrides,
  };
}

const base = {
  w1: "100",
  moreRemain: false,
  backlog: 0,
  sent: new Map<string, string>(),
  minRetainedXid: null,
  now: "2026-09-23T00:00:01.000Z",
  topics: ["orders"],
};

describe("admin console stream protocol", () => {
  it("encodes the cursor as the SSE id and dedupes a seq already sent", () => {
    const tick = planStreamTick({
      ...base,
      cursor: "90",
      rows: [row({ seq: "1", xid: "95", entityVersion: "2" })],
      sent: new Map([["1", "95"]]),
    });
    expect(tick.events).toEqual([]);
    const encoded = new TextDecoder().decode(encodeAdminConsoleSse(heartbeatEvent("90", base.now)));
    expect(encoded.startsWith("id: 90\nevent: heartbeat\n")).toBe(true);
  });

  it("collapses two updates of one order to the later version and rejects an older one", () => {
    const tick = planStreamTick({
      ...base,
      cursor: "90",
      rows: [
        row({ seq: "1", xid: "95", entityVersion: "2" }),
        row({ seq: "2", xid: "96", entityVersion: "3" }),
      ],
    });
    expect(tick.events.map((event) => event.eventId)).toEqual(["cl:2"]);
    expect(tick.events[0]?.entityVersion).toBe("3");
    const cache: EntityCache = new Map();
    expect(applyConsoleEvent(cache, tick.events[0]!)).toBe("applied");
    expect(
      applyConsoleEvent(cache, {
        type: "upsert",
        entityId: "trader_orders:order-1",
        entityVersion: "2",
        payload: { stale: true },
      }),
    ).toBe("ignored");
    expect(cache.get("trader_orders:order-1")?.version).toBe("3");
  });

  it("asks for a resync when the sent set would overflow or the cursor is stale", () => {
    const sent = new Map<string, string>();
    for (let index = 0; index < STREAM_SENT_CAP; index += 1) sent.set(String(index + 1), "100");
    const overflow = planStreamTick({
      ...base,
      cursor: "100",
      w1: "100",
      rows: [row({ seq: "999999", xid: "100", entityId: "other" })],
      sent,
    });
    expect(overflow.resync).toBe(true);
    expect(overflow.events[0]?.type).toBe("resync_required");

    const stale = planStreamTick({
      ...base,
      cursor: "1",
      minRetainedXid: "50",
      rows: [],
    });
    expect(stale.events[0]?.type).toBe("resync_required");

    const backlog = planStreamTick({
      ...base,
      cursor: "90",
      backlog: STREAM_BACKLOG_RESYNC + 1,
      rows: [],
    });
    expect(backlog.resync).toBe(true);
  });

  it("removes an entity and emits access_revoked without applying it as data", () => {
    const tick = planStreamTick({
      ...base,
      cursor: "90",
      rows: [row({ seq: "4", xid: "97", op: "DELETE", entityVersion: null })],
    });
    expect(tick.events[0]?.type).toBe("entity_removed");
    const cache: EntityCache = new Map([["trader_orders:order-1", { version: "1", payload: {} }]]);
    expect(applyConsoleEvent(cache, tick.events[0]!)).toBe("applied");
    expect(cache.has("trader_orders:order-1")).toBe(false);
    const revoked = accessRevokedEvent(base.now);
    expect(revoked.type).toBe("access_revoked");
    expect(applyConsoleEvent(cache, revoked)).toBe("ignored");
  });

  it("does not advance the cursor while rows remain", () => {
    const tick = planStreamTick({
      ...base,
      cursor: "90",
      w1: "200",
      moreRemain: true,
      rows: [row({ seq: "8", xid: "150" })],
    });
    expect(tick.cursor).toBe("90");
    expect(tick.advanced).toBe(false);
  });
});
