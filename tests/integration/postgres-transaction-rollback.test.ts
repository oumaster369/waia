/**
 * D6-core: Postgres transaction commit/rollback validation (opt-in).
 * Proves async transaction semantics without claiming SQLite parity.
 *
 * Enable with: WAIA_PG_INTEGRATION=1 and DATABASE_URL_POSTGRES set (see docs/postgres-development.md).
 */

import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import { runWaiaPostgresTransaction } from "@/db/waia-postgres-transaction";
import { waiaPostgresTxValidation } from "@/db/schema.postgres";
import * as pgSchema from "@/db/schema.postgres";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

describe.skipIf(!integrationEnabled || !url)("postgres transaction rollback (D6-core)", () => {
  afterEach(async () => {
    if (!url) return;
    const cleanupClient = postgres(url, { max: 1 });
    try {
      await cleanupClient.unsafe(`DELETE FROM waia_postgres_tx_validation`);
    } finally {
      await cleanupClient.end({ timeout: 5 });
    }
    await resetPostgresSingletonForTests();
  });

  it("commits successfully and row is visible in separate session", async () => {
    const db = getPostgresDrizzle();
    const testId = crypto.randomUUID();

    await runWaiaPostgresTransaction(db, async (tx) => {
      await tx.insert(waiaPostgresTxValidation).values({
        id: testId,
        payload: "commit-test",
      });
    });

    // Verify with separate raw postgres connection (not the same Drizzle singleton)
    const verifyClient = postgres(url!, { max: 1 });
    try {
      const rows = await verifyClient<{ id: string; payload: string }[]>`
        SELECT id, payload FROM waia_postgres_tx_validation WHERE id = ${testId}
      `;
      expect(rows.length).toBe(1);
      expect(rows[0]?.payload).toBe("commit-test");
    } finally {
      await verifyClient.end({ timeout: 5 });
    }
  });

  it("rolls back when callback throws and row is not visible", async () => {
    const db = getPostgresDrizzle();
    const testId = crypto.randomUUID();

    await expect(
      runWaiaPostgresTransaction(db, async (tx) => {
        await tx.insert(waiaPostgresTxValidation).values({
          id: testId,
          payload: "throw-test",
        });
        throw new Error("intentional rollback");
      }),
    ).rejects.toThrow("intentional rollback");

    // Verify rollback with separate connection
    const verifyClient = postgres(url!, { max: 1 });
    try {
      const rows = await verifyClient<{ id: string }[]>`
        SELECT id FROM waia_postgres_tx_validation WHERE id = ${testId}
      `;
      expect(rows.length).toBe(0);
    } finally {
      await verifyClient.end({ timeout: 5 });
    }
  });

  it("rolls back when callback rejects promise and row is not visible", async () => {
    const db = getPostgresDrizzle();
    const testId = crypto.randomUUID();

    await expect(
      runWaiaPostgresTransaction(db, async (tx) => {
        await tx.insert(waiaPostgresTxValidation).values({
          id: testId,
          payload: "reject-test",
        });
        return Promise.reject(new Error("intentional rejection"));
      }),
    ).rejects.toThrow("intentional rejection");

    // Verify rollback with separate connection
    const verifyClient = postgres(url!, { max: 1 });
    try {
      const rows = await verifyClient<{ id: string }[]>`
        SELECT id FROM waia_postgres_tx_validation WHERE id = ${testId}
      `;
      expect(rows.length).toBe(0);
    } finally {
      await verifyClient.end({ timeout: 5 });
    }
  });

  it("separate Drizzle instance built from raw postgres can also run transactions", async () => {
    // Smoke check: runner doesn't depend on singleton; any Postgres Drizzle works
    const rawClient = postgres(url!, { max: 1 });
    const independentDb = drizzle(rawClient, { schema: pgSchema });
    const testId = crypto.randomUUID();

    try {
      await runWaiaPostgresTransaction(independentDb, async (tx) => {
        await tx.insert(waiaPostgresTxValidation).values({
          id: testId,
          payload: "independent-db-test",
        });
      });

      const rows = await independentDb
        .select()
        .from(waiaPostgresTxValidation)
        .where(eq(waiaPostgresTxValidation.id, testId));
      expect(rows.length).toBe(1);
      expect(rows[0]?.payload).toBe("independent-db-test");
    } finally {
      await rawClient.end({ timeout: 5 });
    }
  });
});
