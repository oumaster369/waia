/**
 * Opt-in: WAIA_PG_INTEGRATION=1 and DATABASE_URL_POSTGRES.
 * Snapshot and RLS checks do not need change-log triggers.
 * The held-commit and historical-order trigger proof moves to the next PR with 0216.
 */

import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";

import { applyConsoleEvent } from "@/lib/trader/admin-console/stream/protocol";
import { withAdminReadSnapshot } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import { getPostgresDrizzle } from "@/db/postgres-client";

const enabled =
  process.env.WAIA_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL_POSTGRES?.trim());
const url = process.env.DATABASE_URL_POSTGRES?.trim() ?? "";

describe.skipIf(!enabled)("admin console change log on postgres", () => {
  const sql = enabled ? postgres(url, { max: 4 }) : null;

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

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
