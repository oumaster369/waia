import { randomUUID } from "node:crypto";

import { sql as drizzleSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  bindPostgresReservedSession,
  withPostgresSessionTransaction,
} from "@/db/postgres-session-transaction";

const enabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES_SESSION?.trim() ?? "";
const parsed = (() => {
  try { return url ? new URL(url) : null; } catch { return null; }
})();
const databaseName = parsed?.pathname.replace(/^\//, "") ?? "";
const disposable = Boolean(
  parsed && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname) &&
  ["waia_it", "waia_validate"].includes(databaseName) && parsed.port !== "6543",
);

if (enabled && url && !disposable) {
  throw new Error("RESERVED_DRIZZLE_PG_REFUSED:LOCAL_DISPOSABLE_DATABASE_REQUIRED");
}

describe.skipIf(!enabled || !url || !disposable)(
  "reserved-session Drizzle adapter PostgreSQL integration",
  () => {
    const pool = postgres(url, { max: 2 });
    let reserved: postgres.ReservedSql;
    let held: postgres.Sql;
    const lockId = 919_917_002;

    beforeAll(async () => {
      reserved = await pool.reserve();
      held = bindPostgresReservedSession(pool, reserved);
      await held`SELECT pg_advisory_lock(${lockId})`;
    });

    afterAll(async () => {
      if (held) await held`SELECT pg_advisory_unlock(${lockId})`;
      if (reserved) reserved.release();
      await pool.end({ timeout: 5 });
    });

    it("keeps raw and Drizzle codecs isolated on one backend and rolls back", async () => {
      const tableName = `dee919_reserved_adapter_${randomUUID().replaceAll("-", "")}`;
      const adapterTable = pgTable(tableName, {
        id: integer("id").primaryKey(),
        payload: jsonb("payload").notNull(),
        payloadText: text("payload_text").notNull(),
        labels: text("labels").array().notNull(),
        recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
      });
      const rawBackend = await reserved<Array<Readonly<{ pid: number }>>>
        `SELECT pg_backend_pid()::int AS pid`;
      const db = drizzle(held);
      const drizzleBackend = await db.execute<{ pid: number }>(
        drizzleSql`SELECT pg_backend_pid()::int AS pid`,
      );
      expect(drizzleBackend[0]?.pid).toBe(rawBackend[0]?.pid);
      const lockRows = await held<Array<Readonly<{ held: boolean }>>>
        `SELECT EXISTS (
          SELECT 1 FROM pg_locks
          WHERE locktype='advisory' AND pid=pg_backend_pid() AND granted
        ) AS held`;
      expect(lockRows[0]?.held).toBe(true);

      await expect(withPostgresSessionTransaction(
        held,
        "SERIALIZABLE",
        async (transaction) => {
          await transaction`
            CREATE TABLE ${transaction(tableName)} (
              id integer PRIMARY KEY,
              payload jsonb NOT NULL,
              payload_text text NOT NULL,
              labels text[] NOT NULL,
              recorded_at timestamptz NOT NULL
            )
          `;
          const txDb = drizzle(transaction);
          const drizzleRecordedAt = new Date("2026-09-03T01:00:00.000Z");
          await txDb.insert(adapterTable).values({
            id: 1,
            payload: { writer: "drizzle", nested: [1, 2] },
            payloadText: JSON.stringify({ writer: "text", nested: [1, 2] }),
            labels: ["d1", "d2"],
            recordedAt: drizzleRecordedAt,
          });
          await transaction`
            INSERT INTO ${transaction(tableName)} (
              id, payload, payload_text, labels, recorded_at
            )
            VALUES (
              2,
              ${transaction.json({ writer: "raw", nested: [3, 4] })},
              ${JSON.stringify({ writer: "raw-text", nested: [3, 4] })},
              ${transaction.array(["r1", "r2"])},
              ${new Date("2026-09-03T02:00:00.000Z")}
            )
          `;

          const drizzleRows = await txDb.select().from(adapterTable);
          expect(drizzleRows).toHaveLength(2);
          expect(drizzleRows[0]).toEqual({
            id: 1,
            payload: { writer: "drizzle", nested: [1, 2] },
            payloadText: JSON.stringify({ writer: "text", nested: [1, 2] }),
            labels: ["d1", "d2"],
            recordedAt: drizzleRecordedAt,
          });
          const rawRows = await transaction<Array<Readonly<{
            id: number;
            payload: { writer: string; nested: number[] };
            payload_type: string;
            payload_text: string;
            labels: string[];
            recorded_at: Date;
          }>>>`
            SELECT id, payload, jsonb_typeof(payload) AS payload_type,
              payload_text, labels, recorded_at
            FROM ${transaction(tableName)} ORDER BY id
          `;
          expect(rawRows[0]).toEqual({
            id: 1,
            payload: { writer: "drizzle", nested: [1, 2] },
            payload_type: "object",
            payload_text: JSON.stringify({ writer: "text", nested: [1, 2] }),
            labels: ["d1", "d2"],
            recorded_at: new Date("2026-09-03T01:00:00.000Z"),
          });
          expect(rawRows[1]).toEqual({
            id: 2,
            payload: { writer: "raw", nested: [3, 4] },
            payload_type: "object",
            payload_text: JSON.stringify({ writer: "raw-text", nested: [3, 4] }),
            labels: ["r1", "r2"],
            recorded_at: new Date("2026-09-03T02:00:00.000Z"),
          });
          const invisible = await pool<Array<Readonly<{ relation: string | null }>>>
            `SELECT to_regclass(${tableName})::text AS relation`;
          expect(invisible[0]?.relation).toBeNull();
          throw new Error("EXPECTED_ADAPTER_ROLLBACK");
        },
      )).rejects.toThrow("EXPECTED_ADAPTER_ROLLBACK");

      const afterRollback = await pool<Array<Readonly<{ relation: string | null }>>>
        `SELECT to_regclass(${tableName})::text AS relation`;
      expect(afterRollback[0]?.relation).toBeNull();
    }, 30_000);
  },
);
