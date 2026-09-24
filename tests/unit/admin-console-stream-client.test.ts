import { describe, expect, it } from "vitest";

import {
  applyStreamBurst,
  createStreamSession,
  drainStreamFrame,
  enqueueStreamEvent,
  failStream,
  STREAM_DISCONNECT_POLL_MS,
  streamActivity,
  streamRequestUrl,
  type ClientStreamEvent,
} from "@/components/trader/admin-console/data/stream-session";

function event(id: number, version = String(id)): ClientStreamEvent {
  return {
    eventId: `cl:${id}`,
    type: "upsert",
    topic: "orders",
    entityId: "trader_orders:1",
    entityVersion: version,
    cursor: String(id),
    payload: { id },
  };
}

describe("admin console stream client", () => {
  it("retains the selected scope in the stream URL", () => {
    expect(
      streamRequestUrl(
        "/stream?organization_id=org-a&mode=paper",
        createStreamSession("9"),
        "orders",
      ),
    ).toBe("/stream?organization_id=org-a&mode=paper&topics=orders&resume=9");
  });
  it("does not resurrect a deleted entity on delayed delivery", () => {
    let session = applyStreamBurst(createStreamSession(), [
      event(2),
      { ...event(3), type: "entity_removed" },
    ]);
    session = applyStreamBurst(session, [event(1)]);
    expect(session.cache.has("trader_orders:1")).toBe(false);
    expect(session.cache.removedVersions?.get("trader_orders:1")).toBe("3");
  });
  it("resumes the last cursor on a new stream and on the poll fallback", () => {
    const session = { ...createStreamSession("42"), cursor: "42" };
    expect(streamRequestUrl("/api/trader/admin/console/stream", session)).toBe(
      "/api/trader/admin/console/stream?resume=42",
    );
    expect(streamRequestUrl("/api/trader/admin/console/stream", failStream(session))).toBe(
      "/api/trader/admin/console/stream?resume=42&transport=poll",
    );
  });

  it("drops a duplicate and an older version, and clears the cache when access is revoked", () => {
    let session = drainStreamFrame(
      enqueueStreamEvent(enqueueStreamEvent(createStreamSession(), event(2, "2")), event(2, "2")),
    );
    session = drainStreamFrame(enqueueStreamEvent(session, event(1, "1")));
    expect(session.cache.get("trader_orders:1")?.payload).toEqual({ id: 2 });
    session = enqueueStreamEvent(session, {
      ...event(3),
      type: "access_revoked",
      entityId: "stream",
    });
    expect(session.accessRevoked).toBe(true);
    expect(session.cache.size).toBe(0);
  });

  it("asks for a resync when one topic queues more than the buffer", () => {
    let session = createStreamSession();
    for (let id = 1; id <= 501; id += 1) {
      session = enqueueStreamEvent(session, { ...event(id), entityId: `trader_orders:${id}` });
    }
    expect(session.resync).toBe(true);
  });

  it("applies a thousand events in frames without dropping them", () => {
    const events = Array.from({ length: 1000 }, (_, index) => ({
      ...event(index + 1),
      entityId: `trader_orders:${index + 1}`,
    }));
    const session = applyStreamBurst(createStreamSession(), events);
    expect(session.resync).toBe(false);
    expect(session.cache.size).toBe(1000);
    expect(session.queue).toHaveLength(0);
  });

  it("polls every 5 seconds after a disconnect and pauses while the tab is hidden", () => {
    expect(STREAM_DISCONNECT_POLL_MS).toBe(5_000);
    expect(streamActivity({ hidden: true, connected: true })).toBe("paused");
    expect(streamActivity({ hidden: false, connected: true })).toBe("sse");
    expect(streamActivity({ hidden: false, connected: false })).toBe("poll");
  });
});
