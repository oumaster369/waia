/** Opt-in, disposable local PostgreSQL only; synthetic append-only fixtures stay for diagnosis. */
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema.postgres";
import type { AdminRouteHandlerDeps } from "@/lib/trader/admin-route-shared";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import {
  handleAdminConsoleSavedViewsGet,
  handleAdminConsoleSavedViewsPost,
  handleAdminConsoleSavedViewsDelete,
} from "@/lib/trader/admin-console/handlers/saved-views";
import {
  handleAdminConsoleVisitMarkerGet,
  handleAdminConsoleVisitMarkerPost,
} from "@/lib/trader/admin-console/handlers/visit-marker";
import { handleAdminConsoleOrdersGet } from "@/lib/trader/admin-console/handlers/orders";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { handleAdminConsoleStreamPoll } from "@/lib/trader/admin-console/stream/console-stream";
import { readChangeLogSince } from "@/lib/trader/admin-console/repositories/change-log.postgres";
import {
  withAdminReadSnapshot,
  type AdminPostgresDb,
} from "@/lib/trader/admin-console/repositories/snapshot.postgres";

const url = process.env.DATABASE_URL_POSTGRES;
const enabled = process.env.WAIA_PG_INTEGRATION === "1" && Boolean(url);
const a = randomUUID();
const b = randomUUID();
function request(path: string, body?: unknown, method = "POST") {
  return new Request(
    `http://localhost/api/trader/admin/console/${path}`,
    body === undefined
      ? undefined
      : {
          method,
          headers: { origin: "http://localhost", "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
}
describe.skipIf(!enabled)("admin console read/control contract on Postgres", () => {
  let client: postgres.Sql;
  let db: AdminPostgresDb;
  const deps = (userId = a): AdminRouteHandlerDeps => ({
    getUserId: async () => userId,
    getRuntimeDb: async () => ({ kind: "postgres", db, _sql: client }),
    disposeRuntimeDb: async () => undefined,
  });
  beforeAll(async () => {
    if (!["localhost", "127.0.0.1", "::1"].includes(new URL(url!).hostname))
      throw new Error("TEST_REQUIRES_LOCAL_DISPOSABLE_POSTGRES");
    client = postgres(url!, { max: 5, prepare: false });
    db = drizzle(client, { schema });
    for (const id of [a, b]) {
      await client`INSERT INTO auth.users (id) VALUES (${id}::uuid)`;
      await client`INSERT INTO users (id, identity_label, email) VALUES (${id}::uuid, 'Console test', ${`${id}@waia.invalid`})`;
      await ensureUserCoreSeedPostgres(db, { userId: id, displayName: "Console test" });
      await client`UPDATE user_platform_roles SET role = 'admin' WHERE user_id = ${id}::uuid`;
    }
  });
  afterAll(async () => {
    await client?.end();
  });
  it("serializes two saved-view writes with the same revision, including the empty collection", async () => {
    const before = await handleAdminConsoleSavedViewsGet(request("saved-views"), deps());
    const revision = (before.body as { revision: string }).revision;
    const results = await Promise.all(
      ["first", "second"].map((name) =>
        handleAdminConsoleSavedViewsPost(
          request("saved-views", {
            section: "orders",
            name,
            state: {},
            expectedRevision: revision,
          }),
          deps(),
        ),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const next = await handleAdminConsoleSavedViewsGet(request("saved-views"), deps());
    expect((next.body as { views: unknown[] }).views).toHaveLength(1);
  });
  it("returns 404 for another admin's saved view before comparing revisions", async () => {
    const owned = await handleAdminConsoleSavedViewsGet(request("saved-views"), deps());
    const id = (owned.body as { views: { id: string }[] }).views[0]!.id;
    const update = await handleAdminConsoleSavedViewsPost(
      request("saved-views", {
        id,
        section: "orders",
        name: "foreign",
        state: {},
        expectedRevision: "wrong",
      }),
      deps(b),
    );
    const remove = await handleAdminConsoleSavedViewsDelete(
      request("saved-views", { id, expectedRevision: "wrong" }, "DELETE"),
      deps(b),
    );
    expect([update.status, remove.status]).toEqual([404, 404]);
  });
  it("requires and atomically checks visit-marker revision, with owner isolation", async () => {
    const before = await handleAdminConsoleVisitMarkerGet(request("visit-marker"), deps());
    const expectedRevision = (before.body as { revision: string }).revision;
    const results = await Promise.all(
      [1, 2].map(() =>
        handleAdminConsoleVisitMarkerPost(request("visit-marker", { expectedRevision }), deps()),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      (await handleAdminConsoleVisitMarkerPost(request("visit-marker", {}), deps())).status,
    ).toBe(400);
    expect(
      (await handleAdminConsoleVisitMarkerGet(request(`visit-marker?admin_user_id=${a}`), deps(b)))
        .status,
    ).toBe(404);
    expect(
      (
        await handleAdminConsoleVisitMarkerPost(
          request("visit-marker", { expectedRevision, adminUserId: a }),
          deps(b),
        )
      ).status,
    ).toBe(404);
  });
  it.each(["oops", "18446744073709551616"])(
    "resyncs malformed resume %s without a PostgreSQL xid cast error",
    async (resume) => {
      const result = await handleAdminConsoleStreamPoll(
        request(`stream?topics=orders&transport=poll&resume=${resume}`),
        deps(),
      );
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({
        events: [expect.objectContaining({ type: "resync_required" })],
      });
    },
  );
  it("keeps a real held transaction inside the resume window after a later transaction commits", async () => {
    const org = personalOrganizationIdFromUserId(a);
    const heldId = randomUUID();
    const laterId = randomUUID();
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let markReady!: (xid: string) => void;
    const ready = new Promise<string>((resolve) => {
      markReady = resolve;
    });
    const held = client.begin(async (tx) => {
      await tx`INSERT INTO trader_orders (id, organization_id, venue, execution_mode, symbol, side, type, quantity, state, client_order_id, idempotency_key, risk_decision_id)
        VALUES (${heldId}::uuid, ${org}::uuid, 'htx', 'live', 'HELDUSDT', 'buy', 'market', '1', 'CREATED', ${heldId}, ${heldId}, 'test')`;
      const rows = await tx<{ xid: string }[]>`SELECT pg_current_xact_id()::text AS xid`;
      markReady(rows[0]!.xid);
      await barrier;
    });
    try {
      const xid = await ready;
      await client`INSERT INTO trader_orders (id, organization_id, venue, execution_mode, symbol, side, type, quantity, state, client_order_id, idempotency_key, risk_decision_id)
        VALUES (${laterId}::uuid, ${org}::uuid, 'htx', 'live', 'LATERUSDT', 'buy', 'market', '1', 'CREATED', ${laterId}, ${laterId}, 'test')`;
      const snapshot = await handleAdminConsoleOrdersGet(
        request(`orders?organization_id=${org}`),
        deps(),
      );
      const cursor = (snapshot.body as { cursor: string }).cursor;
      expect(BigInt(cursor)).toBeLessThanOrEqual(BigInt(xid));
      const first = await handleAdminConsoleStreamPoll(
        request(`stream?topics=orders&resume=${cursor}&organization_id=${org}`),
        deps(),
      );
      expect(JSON.stringify(first.body)).toContain(laterId);
      expect(JSON.stringify(first.body)).not.toContain(heldId);
      release();
      await held;
      const second = await handleAdminConsoleStreamPoll(
        request(
          `stream?topics=orders&resume=${(first.body as { cursor: string }).cursor}&organization_id=${org}`,
        ),
        deps(),
      );
      expect(JSON.stringify(second.body)).toContain(heldId);
    } finally {
      release();
      await held;
    }
  });
  it("continues past a full 5000-row tick without skipping newly visible lower sequences", async () => {
    const stamp = await client<{ xid: string }[]>`SELECT pg_current_xact_id()::text AS xid`;
    const watermark = stamp[0]!.xid;
    const prefix = randomUUID();
    await client`INSERT INTO trader_admin_change_log (xid, changed_at, source_table, op, entity_id)
      SELECT pg_current_xact_id(), clock_timestamp(), 'trader_admin_diagnostic_event', 'INSERT', ${prefix} || ':' || g FROM generate_series(1, 5001) g`;
    const first = await withAdminReadSnapshot(db, (tx) => readChangeLogSince(tx, watermark));
    expect(first.value.rows).toHaveLength(5000);
    expect(first.value.moreRemain).toBe(true);
    const second = await withAdminReadSnapshot(db, (tx) =>
      readChangeLogSince(
        tx,
        watermark,
        first.value.rows.map((row) => row.seq),
      ),
    );
    expect(second.value.rows).toHaveLength(1);
    expect(second.value.moreRemain).toBe(false);
    const all = [...first.value.rows, ...second.value.rows];
    expect(new Set(all.map((row) => row.entityId)).size).toBe(5001);
  });
});
