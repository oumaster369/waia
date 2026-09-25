import { describe, it, expect } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema.postgres";
import { createPostgresCollectorStore } from "@/lib/trader/admin-console/collectors/postgres-store";
const url = process.env.DATABASE_URL_POSTGRES;
describe.skipIf(process.env.WAIA_PG_INTEGRATION !== "1" || !url)(
  "real collector retention SQL",
  () => {
    it("executes every batch with bound cutoff and limit and preserves recent evidence", async () => {
      if (!["localhost", "127.0.0.1"].includes(new URL(url!).hostname))
        throw new Error("LOCAL_TEST_DATABASE_REQUIRED");
      const client = postgres(url!, { max: 1, prepare: false });
      try {
        const db = drizzle(client, { schema });
        await client`INSERT INTO trader_admin_market_quote_minute(source,symbol,minute,close,observed_at)
     VALUES ('retention-proof','btcusdt','2000-01-01','1','2000-01-01'),('retention-proof','btcusdt',now(),'2',now()) ON CONFLICT DO NOTHING`;
        const removed = await createPostgresCollectorStore(db).retain(new Date());
        expect(removed).toBeGreaterThan(0);
        const rows =
          await client`SELECT close::text FROM trader_admin_market_quote_minute WHERE source='retention-proof'`;
        expect(rows).toHaveLength(1);
        expect(rows[0]?.close).toBe("2");
      } finally {
        await client`DELETE FROM trader_admin_market_quote_minute WHERE source='retention-proof'`;
        await client.end();
      }
    });
  },
);
