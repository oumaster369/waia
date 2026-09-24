/**
 * Opt-in: WAIA_PG_INTEGRATION=1 and DATABASE_URL_POSTGRES.
 * One response reads its rows inside a single repeatable-read snapshot.
 */

import { describe, expect, it } from "vitest";

import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import { withAdminReadSnapshot } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import { sql } from "drizzle-orm";

const enabled =
  process.env.WAIA_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL_POSTGRES?.trim());

describe.skipIf(!enabled)("admin console read snapshot", () => {
  it("returns one xmin for every read in the callback", async () => {
    const db = getPostgresDrizzle();
    try {
      const snapshot = await withAdminReadSnapshot(db, async (tx) => {
        const first = await tx.execute(
          sql`SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS xmin`,
        );
        const second = await tx.execute(
          sql`SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS xmin`,
        );
        const rows = (value: unknown) => (Array.isArray(value) ? value : []) as { xmin?: string }[];
        return { first: rows(first)[0]?.xmin, second: rows(second)[0]?.xmin };
      });
      expect(snapshot.cursor).toBe(snapshot.value.first);
      expect(snapshot.value.first).toBe(snapshot.value.second);
    } finally {
      await resetPostgresSingletonForTests();
    }
  });
});
