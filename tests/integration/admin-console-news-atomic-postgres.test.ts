import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema.postgres";
import { createPostgresCollectorStore } from "@/lib/trader/admin-console/collectors/postgres-store";
import {
  planNewsWrite,
  type NewsDraft,
  type NewsWrite,
} from "@/lib/trader/admin-console/collectors/news-persist";

const url = process.env.DATABASE_URL_POSTGRES;
describe.skipIf(process.env.WAIA_PG_INTEGRATION !== "1" || !url)(
  "atomic news evidence on PostgreSQL",
  () => {
    const prefix = `news-atomic-${randomUUID()}`;
    const objectName = `news_atomic_${randomUUID().replaceAll("-", "")}`;
    const observedBase = Date.now();
    let client: ReturnType<typeof postgres>;
    let store: ReturnType<typeof createPostgresCollectorStore>;
    function draft(key: string, title = "first", second = 0): NewsDraft {
      return {
        source: prefix,
        guid: key,
        url: `https://example.test/${key}`,
        title: `${prefix} ${title}`,
        summary: null,
        publishedAt: new Date(observedBase - 60_000).toISOString(),
        observedAt: new Date(observedBase + second * 1000).toISOString(),
      };
    }
    function initial(key: string): NewsWrite {
      return planNewsWrite(null, draft(key))!;
    }
    async function saved(key: string) {
      const write = initial(key);
      return store.findNews(write.dedupeKey);
    }
    async function versions(key: string) {
      return client`SELECT v.version,v.title,i.current_version FROM trader_admin_news_item i JOIN trader_admin_news_item_version v ON v.news_item_id=i.id WHERE i.dedupe_key=${initial(key).dedupeKey} ORDER BY v.version`;
    }
    beforeAll(() => {
      if (!["localhost", "127.0.0.1"].includes(new URL(url!).hostname))
        throw new Error("LOCAL_TEST_DATABASE_REQUIRED");
      client = postgres(url!, { max: 4, prepare: false });
      store = createPostgresCollectorStore(drizzle(client, { schema }));
    });
    afterAll(async () => {
      if (!client) return;
      await client.unsafe(`DROP TRIGGER IF EXISTS ${objectName} ON trader_admin_news_item_version`);
      await client.unsafe(`DROP TRIGGER IF EXISTS ${objectName} ON trader_admin_news_item`);
      await client.unsafe(`DROP FUNCTION IF EXISTS ${objectName}()`);
      await client`DELETE FROM trader_admin_news_item WHERE source=${prefix}`;
      await client.end();
    });
    it("serializes identical plans from overlapping collectors without duplicate records", async () => {
      const write = initial("overlap");
      const results = await Promise.allSettled([store.applyNews(write), store.applyNews(write)]);
      expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
      expect(await versions("overlap")).toMatchObject([{ version: 1, current_version: 1 }]);
    });
    it("replans concurrent edits against the locked head and preserves newest observed content", async () => {
      await store.applyNews(initial("edits"));
      const head = await saved("edits");
      const results = await Promise.allSettled([
        store.applyNews(planNewsWrite(head, draft("edits", "second", 1))!),
        store.applyNews(planNewsWrite(head, draft("edits", "third", 2))!),
      ]);
      expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
      const rows = await versions("edits");
      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(rows.map((r) => r.version)).toEqual(rows.map((_, i) => i + 1));
      expect(rows.at(-1)).toMatchObject({ title: `${prefix} third`, current_version: rows.length });
    });
    it("rolls back a new item when its first version fails, then permits a clean retry", async () => {
      const write = initial("rollback-insert");
      await client.unsafe(
        `CREATE FUNCTION ${objectName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.title = '${prefix} first' THEN RAISE EXCEPTION 'NEWS_TEST_VERSION_FAILURE'; END IF; RETURN NEW; END $$`,
      );
      await client.unsafe(
        `CREATE TRIGGER ${objectName} BEFORE INSERT ON trader_admin_news_item_version FOR EACH ROW EXECUTE FUNCTION ${objectName}()`,
      );
      try {
        await expect(store.applyNews(write)).rejects.toThrow();
        expect(
          await client`SELECT id FROM trader_admin_news_item WHERE dedupe_key=${write.dedupeKey}`,
        ).toHaveLength(0);
      } finally {
        await client.unsafe(`DROP TRIGGER ${objectName} ON trader_admin_news_item_version`);
        await client.unsafe(`DROP FUNCTION ${objectName}()`);
      }
      await store.applyNews(write);
      expect(await versions("rollback-insert")).toHaveLength(1);
    });
    it("rolls back an appended version when advancing its pointer fails", async () => {
      await store.applyNews(initial("rollback-update"));
      const write = planNewsWrite(
        await saved("rollback-update"),
        draft("rollback-update", "second", 1),
      )!;
      await client.unsafe(
        `CREATE FUNCTION ${objectName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.source = '${prefix}' THEN RAISE EXCEPTION 'NEWS_TEST_POINTER_FAILURE'; END IF; RETURN NEW; END $$`,
      );
      await client.unsafe(
        `CREATE TRIGGER ${objectName} BEFORE UPDATE ON trader_admin_news_item FOR EACH ROW EXECUTE FUNCTION ${objectName}()`,
      );
      try {
        await expect(store.applyNews(write)).rejects.toThrow();
        expect(await versions("rollback-update")).toMatchObject([
          { version: 1, current_version: 1 },
        ]);
        expect(await versions("rollback-update")).toHaveLength(1);
      } finally {
        await client.unsafe(`DROP TRIGGER ${objectName} ON trader_admin_news_item`);
        await client.unsafe(`DROP FUNCTION ${objectName}()`);
      }
      await store.applyNews(write);
      expect(await versions("rollback-update")).toMatchObject([
        { version: 1, current_version: 2 },
        { version: 2, current_version: 2 },
      ]);
    });
    it("does not append an older delayed observation after a newer version", async () => {
      await store.applyNews(initial("late"));
      const head = await saved("late");
      await store.applyNews(planNewsWrite(head, draft("late", "newer", 10))!);
      await expect(
        store.applyNews(planNewsWrite(head, draft("late", "older", 1))!),
      ).resolves.toBeUndefined();
      expect(await versions("late")).toMatchObject([
        { version: 1, current_version: 2 },
        { version: 2, title: `${prefix} newer`, current_version: 2 },
      ]);
    });
  },
);
