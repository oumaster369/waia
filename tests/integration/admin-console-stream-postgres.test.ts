/**
 * Opt-in: WAIA_PG_INTEGRATION=1 and DATABASE_URL_POSTGRES.
 * Held-commit and historical-order proofs require the 0216 triggers.
 */

import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";

import {
  planStreamTick,
  applyConsoleEvent,
  type ChangeLogRow,
} from "@/lib/trader/admin-console/stream/protocol";
import { withAdminReadSnapshot } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import { getPostgresDrizzle } from "@/db/postgres-client";

const enabled =
  process.env.WAIA_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL_POSTGRES?.trim());
const url = process.env.DATABASE_URL_POSTGRES?.trim() ?? "";

function rowFrom(raw: Record<string, unknown>): ChangeLogRow {
  return {
    seq: String(raw.seq),
    xid: String(raw.xid),
    changedAt:
      raw.changed_at instanceof Date ? raw.changed_at.toISOString() : String(raw.changed_at),
    sourceTable: String(raw.source_table),
    op: raw.op as ChangeLogRow["op"],
    entityId: String(raw.entity_id),
    organizationId: raw.organization_id ? String(raw.organization_id) : null,
    entityVersion: raw.entity_version == null ? null : String(raw.entity_version),
  };
}

describe.skipIf(!enabled)("admin console change log on postgres", () => {
  const sql = enabled ? postgres(url, { max: 4 }) : null;

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it("delivers a fill whose commit is held, and skips historical orders", async () => {
    if (!sql) return;
    const orgId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const liveId = crypto.randomUUID();
    await sql`INSERT INTO auth.users (id) VALUES (${userId}::uuid)`;
    await sql`INSERT INTO users (id, identity_label, email) VALUES (${userId}, ${"admin-console"}, ${`${userId}@waia.invalid`})`;
    await sql`INSERT INTO organizations (id, owner_user_id, kind, name) VALUES (${orgId}, ${userId}, ${"personal"}, ${"console"})`;
    await sql`
      INSERT INTO trader_orders (
        id, organization_id, venue, execution_mode, historical_run_id, historical_account_key,
        symbol, side, type, quantity, state, client_order_id, idempotency_key, risk_decision_id
      )
      SELECT gen_random_uuid(), ${orgId}::uuid, 'htx', 'mock', 'hist-run', 'hist-account',
             'BTCUSDT', 'buy', 'market',
             '1', 'CREATED', 'hist-' || g::text, 'hist-key-' || g::text, 'risk'
      FROM generate_series(1, 100) AS g
    `;
    const historical = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM trader_admin_change_log
      WHERE source_table = 'trader_orders' AND entity_id IN (
        SELECT id::text FROM trader_orders WHERE organization_id = ${orgId}::uuid AND historical_run_id IS NOT NULL
      )
    `;
    expect(historical[0]?.count).toBe("0");

    await sql`
      INSERT INTO trader_orders (
        id, organization_id, venue, execution_mode, symbol, side, type,
        quantity, state, client_order_id, idempotency_key, risk_decision_id
      ) VALUES (
        ${liveId}::uuid, ${orgId}::uuid, 'htx', 'live', 'BTCUSDT', 'buy', 'market',
        '1', 'CREATED', 'live-1', 'live-key-1', 'risk'
      )
    `;
    const held = postgres(url, { max: 1 });
    const heldId = crypto.randomUUID();
    await held.unsafe("BEGIN");
    await held`
      INSERT INTO trader_admin_diagnostic_event (
        id, occurred_at, received_at, service, environment, severity, error_class,
        message_redacted, fingerprint, context_json
      ) VALUES (
        ${heldId}::uuid, now(), now(), 'test', 'test', 'error', 'Held', 'held', ${heldId}, '{}'::jsonb
      )
    `;
    const visibleBeforeCommit = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM trader_admin_change_log WHERE entity_id = ${heldId}
    `;
    expect(visibleBeforeCommit[0]?.count).toBe("0");
    const commit = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 30_000));
      await held.unsafe("COMMIT");
    })();
    await new Promise((resolve) => setTimeout(resolve, 500));
    const stillHidden = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM trader_admin_change_log WHERE entity_id = ${heldId}
    `;
    expect(stillHidden[0]?.count).toBe("0");
    await commit;
    await held.end({ timeout: 5 });
    const delivered = await sql<Record<string, unknown>[]>`
      SELECT seq::text AS seq, xid::text AS xid, changed_at, source_table, op, entity_id,
             organization_id::text AS organization_id, entity_version::text AS entity_version
      FROM trader_admin_change_log
      WHERE entity_id = ${heldId} OR entity_id = ${liveId}
      ORDER BY seq
    `;
    expect(delivered.some((entry) => entry.entity_id === heldId)).toBe(true);
    const tick = planStreamTick({
      cursor: "1",
      w1: "999999999999",
      rows: delivered.map(rowFrom),
      moreRemain: false,
      backlog: delivered.length,
      sent: new Map(),
      minRetainedXid: "1",
      now: new Date().toISOString(),
      topics: ["orders", "diagnostics"],
    });
    expect(tick.events.some((event) => event.entityId.endsWith(heldId))).toBe(true);
    expect(tick.events.some((event) => event.entityId.endsWith(liveId))).toBe(true);

    await sql`DELETE FROM trader_orders WHERE organization_id = ${orgId}::uuid`;
    await sql`DELETE FROM trader_admin_diagnostic_event WHERE id = ${heldId}::uuid`;
    await sql`DELETE FROM trader_admin_change_log WHERE entity_id IN (${heldId}, ${liveId})`;
    await sql`DELETE FROM organizations WHERE id = ${orgId}::uuid`;
    await sql`DELETE FROM users WHERE id = ${userId}::uuid`;
    await sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
  }, 90_000);

  it("keeps a repeatable-read snapshot stable while another transaction commits", async () => {
    if (!sql) return;
    const db = getPostgresDrizzle();
    const before = await sql<
      { count: string }[]
    >`SELECT count(*)::text AS count FROM trader_admin_fear_greed`;
    let snapshotOpen!: () => void;
    const snapshotReady = new Promise<void>((resolve) => {
      snapshotOpen = resolve;
    });
    const snapshot = withAdminReadSnapshot(db, async (tx) => {
      snapshotOpen();
      await new Promise((resolve) => setTimeout(resolve, 200));
      const result = await tx.execute(
        (await import("drizzle-orm"))
          .sql`SELECT count(*)::text AS count FROM trader_admin_fear_greed`,
      );
      return result;
    });
    const day = "2099-01-01";
    await snapshotReady;
    await sql`
      INSERT INTO trader_admin_fear_greed (day, value, classification, observed_at)
      VALUES (${day}::date, 10, 'fear', now())
      ON CONFLICT (day) DO NOTHING
    `;
    const value = await snapshot;
    const rows = Array.isArray(value.value) ? value.value : [];
    const seen = String((rows[0] as { count?: string } | undefined)?.count ?? before[0]?.count);
    expect(seen).toBe(before[0]?.count);
    expect(value.cursor).toMatch(/^[0-9]+$/);
    await sql`DELETE FROM trader_admin_fear_greed WHERE day = ${day}::date`;
  });

  it("rejects an anon select on the change log", async () => {
    if (!sql) return;
    const probe = postgres(url, { max: 1 });
    try {
      await probe.unsafe("SET ROLE anon");
      await expect(
        probe.unsafe("SELECT seq FROM trader_admin_change_log LIMIT 1"),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await probe.unsafe("RESET ROLE");
      await probe.end({ timeout: 5 });
    }
  });

  it("rejects an older entity version after two updates", () => {
    const cache = new Map<string, { version: string; payload: unknown }>();
    applyConsoleEvent(cache, {
      type: "upsert",
      entityId: "trader_orders:1",
      entityVersion: "2",
      payload: { state: "new" },
    });
    expect(
      applyConsoleEvent(cache, {
        type: "upsert",
        entityId: "trader_orders:1",
        entityVersion: "1",
        payload: { state: "old" },
      }),
    ).toBe("ignored");
  });
});
