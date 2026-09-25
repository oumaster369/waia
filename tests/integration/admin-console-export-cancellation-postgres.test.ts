import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema.postgres";
import { withAdminExportSnapshot } from "@/lib/trader/admin-console/repositories/export-snapshot.postgres";
const url = process.env.DATABASE_URL_POSTGRES;
describe.skipIf(process.env.WAIA_PG_INTEGRATION !== "1" || !url)(
  "cancellable admin export snapshot with one database connection",
  () => {
    let client: postgres.Sql;
    beforeAll(() => {
      if (!["localhost", "127.0.0.1"].includes(new URL(url!).hostname))
        throw new Error("LOCAL_ONLY");
      client = postgres(url!, { max: 1, prepare: false });
    });
    afterAll(async () => {
      await client?.end();
    });
    const runtime = () => ({
      kind: "postgres" as const,
      db: drizzle(client, { schema }),
      _sql: client,
    });
    it("keeps every read repeatable and rejects writes", async () => {
      const result = await withAdminExportSnapshot(
        runtime(),
        new AbortController().signal,
        async (tx, cursor) => {
          const setting = await tx.execute(
            sql`select current_setting('transaction_isolation') as isolation, current_setting('transaction_read_only') as readonly`,
          );
          expect(cursor).toMatch(/^\d+$/);
          return setting;
        },
      );
      expect(result).toMatchObject([{ isolation: "repeatable read", readonly: "on" }]);
      await expect(
        withAdminExportSnapshot(runtime(), new AbortController().signal, (tx) =>
          tx.execute(sql`create table admin_export_must_not_write(id int)`),
        ),
      ).rejects.toThrow();
    });
    it("cancels an in-flight query, rolls back and releases the single connection", async () => {
      const abort = new AbortController();
      const start = Date.now();
      const task = withAdminExportSnapshot(runtime(), abort.signal, async (tx) => {
        setTimeout(() => abort.abort(), 100);
        await tx.execute(sql`select pg_sleep(10)`);
      });
      await expect(task).rejects.toThrow("EXPORT_ABORTED");
      expect(Date.now() - start).toBeLessThan(3000);
      expect(await client`select 1 as reusable`).toMatchObject([{ reusable: 1 }]);
    });
    it("enforces the deadline while a query is running", async () => {
      const start = Date.now();
      await expect(
        withAdminExportSnapshot(
          runtime(),
          new AbortController().signal,
          (tx) => tx.execute(sql`select pg_sleep(10)`),
          100,
        ),
      ).rejects.toThrow("EXPORT_LIMIT");
      expect(Date.now() - start).toBeLessThan(3000);
      expect(await client`select 1 as reusable`).toMatchObject([{ reusable: 1 }]);
    });
  },
);
