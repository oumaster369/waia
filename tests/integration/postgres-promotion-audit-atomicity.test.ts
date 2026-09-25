import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import * as schema from "@/db/schema.postgres";
import * as audit from "@/lib/waia-core/audit/write";
import { createPostgresStrategyPromotionService } from "@/lib/trader/validation-gate/promotion-service";
import {
  getPromotionRecordByIdPostgres,
  findPromotionByIdempotencyKeyPostgres,
} from "@/lib/trader/validation-gate/repository-postgres";
import { seedHtrPostgresUser } from "@/tests/integration/htr-postgres-fixture-prelude";
import { buildAtomicPromotionAssembly } from "@/tests/helpers/atomic-promotion-assembly";

const enabled =
  process.env.WAIA_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL_POSTGRES);
const user = crypto.randomUUID();
let organizationId: string;
let client: postgres.Sql;
let database: WaiaPostgresDb;
let now = Date.parse("2026-09-25T00:00:00Z");
const actor = { actorType: "service" as const, actorId: null };
const action = {
  request: "trader.strategy_promotion.requested",
  confirm: "trader.strategy_promotion.confirmed",
  effective: "trader.strategy_promotion.effective",
  cancel: "trader.strategy_promotion.cancelled",
  demote: "trader.strategy_promotion.demoted",
};
function service() {
  return createPostgresStrategyPromotionService(database, {
    nowMs: () => now,
    validateResearchProvenance: false, // Synthetic documents, never admission evidence.
  });
}
async function request() {
  return service().requestPromotion(
    actor,
    { organizationId },
    {
      idempotencyKey: crypto.randomUUID(),
      assembly: await buildAtomicPromotionAssembly(organizationId, crypto.randomUUID()),
    },
  );
}
async function audits(recordId: string, expectedAction: string) {
  return database
    .select()
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.organizationId, organizationId),
        eq(schema.auditLogs.entityId, recordId),
        eq(schema.auditLogs.action, expectedAction),
      ),
    );
}

describe.skipIf(!enabled)("DEE-1101 native PG promotion state and Core audit atomicity", () => {
  beforeAll(async () => {
    const url = process.env.DATABASE_URL_POSTGRES!;
    if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname))
      throw new Error("LOCAL_TEST_DATABASE_REQUIRED");
    client = postgres(url, { max: 8, prepare: false });
    database = drizzle(client, { schema });
    organizationId = await seedHtrPostgresUser(url, user, "Atomic promotion fixture");
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await client?.end();
  }); // Keep append-only test audits.

  it("rolls back request when audit append fails and permits an exact retry", async () => {
    const input = {
      idempotencyKey: crypto.randomUUID(),
      assembly: await buildAtomicPromotionAssembly(organizationId, crypto.randomUUID()),
    };
    vi.spyOn(audit, "writeAuditLogPostgres").mockRejectedValueOnce(
      new Error("SYNTHETIC_AUDIT_FAILURE"),
    );
    await expect(service().requestPromotion(actor, { organizationId }, input)).rejects.toThrow(
      "SYNTHETIC_AUDIT_FAILURE",
    );
    expect(
      await findPromotionByIdempotencyKeyPostgres(
        database,
        { organizationId },
        input.idempotencyKey,
      ),
    ).toBeNull();
    const record = await service().requestPromotion(actor, { organizationId }, input);
    expect(await audits(record.id, action.request)).toHaveLength(1);
  });
  for (const transition of ["confirm", "effective", "cancel", "demote"] as const) {
    it(`rolls back ${transition} and its audit on failure, then retries once`, async () => {
      const ready = service();
      let record = await request();
      if (transition === "effective" || transition === "demote") {
        record = await ready.confirmPromotion(actor, { organizationId }, record.id, {
          expectedStateVersion: record.stateVersion,
          coolingOffMs: 1,
        });
        now += 2;
      }
      if (transition === "demote")
        record = await ready.markEffective(actor, { organizationId }, record.id, {
          expectedStateVersion: record.stateVersion,
        });
      const invoke = () => {
        const input = {
          expectedStateVersion: record.stateVersion,
          coolingOffMs: 1,
          reason: "fixture",
        };
        if (transition === "confirm")
          return ready.confirmPromotion(actor, { organizationId }, record.id, input);
        if (transition === "effective")
          return ready.markEffective(actor, { organizationId }, record.id, input);
        if (transition === "cancel")
          return ready.cancelPromotion(actor, { organizationId }, record.id, input);
        return ready.demoteStrategy(actor, { organizationId }, record.strategyId, input);
      };
      vi.spyOn(audit, "writeAuditLogPostgres").mockRejectedValueOnce(
        new Error("SYNTHETIC_AUDIT_FAILURE"),
      );
      await expect(invoke()).rejects.toThrow("SYNTHETIC_AUDIT_FAILURE");
      expect(
        await getPromotionRecordByIdPostgres(database, { organizationId }, record.id),
      ).toMatchObject({ state: record.state, stateVersion: record.stateVersion });
      expect(await audits(record.id, action[transition])).toHaveLength(0);
      const updated = await invoke();
      expect(updated.stateVersion).toBe(record.stateVersion + 1);
      expect(await audits(record.id, action[transition])).toHaveLength(1);
      await expect(invoke()).rejects.toThrow(); // Lost response retry must not repeat a stale command.
      expect(await audits(record.id, action[transition])).toHaveLength(1);
    });
  }
  it("collapses concurrent exact requests into one audited record", async () => {
    const ready = service();
    const input = {
      idempotencyKey: crypto.randomUUID(),
      assembly: await buildAtomicPromotionAssembly(organizationId, crypto.randomUUID()),
    };
    const records = await Promise.all(
      Array.from({ length: 6 }, () => ready.requestPromotion(actor, { organizationId }, input)),
    );
    expect(new Set(records.map((record) => record.id)).size).toBe(1);
    expect(await audits(records[0]!.id, action.request)).toHaveLength(1);
    await expect(
      ready.requestPromotion(
        actor,
        { organizationId },
        {
          ...input,
          assembly: { ...input.assembly, hypothesis: "different claim" },
        },
      ),
    ).rejects.toMatchObject({ code: "STRATEGY_PROMOTION_IDEMPOTENCY_CONFLICT" });
    expect(await audits(records[0]!.id, action.request)).toHaveLength(1);
  });
  it("CAS admits only one transition after both transactions read the old version", async () => {
    const ready = service();
    const record = await request();
    const db = database;
    let release!: () => void, acquired!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const blocker = db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT id FROM trader_strategy_promotion_records WHERE id=${record.id}::uuid FOR UPDATE`,
      );
      acquired();
      await held;
    });
    await locked;
    const pending = Promise.allSettled(
      Array.from({ length: 2 }, () =>
        ready.confirmPromotion(actor, { organizationId }, record.id, {
          expectedStateVersion: record.stateVersion,
          coolingOffMs: 1,
        }),
      ),
    );
    try {
      let waiting = 0;
      for (let attempt = 0; attempt < 200 && waiting < 2; attempt += 1) {
        const rows = await db.execute(sql`SELECT count(*)::integer AS n FROM pg_stat_activity
          WHERE datname=current_database() AND wait_event_type='Lock'
          AND query LIKE 'update "trader_strategy_promotion_records"%'`);
        waiting = Number(rows[0]!.n);
        if (waiting < 2) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting, "both CAS updates must be blocked after reading v1").toBe(2);
    } finally {
      release();
      await blocker;
    }
    const results = await pending;
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await audits(record.id, action.confirm)).toHaveLength(1);
    expect(
      await getPromotionRecordByIdPostgres(database, { organizationId }, record.id),
    ).toMatchObject({ state: "COOLING_OFF", stateVersion: 2 });
  });

  it("refuses a mutation when the executor cannot transact", async () => {
    const db = database;
    const ready = createPostgresStrategyPromotionService(
      {
        select: db.select.bind(db),
        insert: db.insert.bind(db),
        update: db.update.bind(db),
      },
      { validateResearchProvenance: false },
    );
    const input = {
      idempotencyKey: crypto.randomUUID(),
      assembly: await buildAtomicPromotionAssembly(organizationId, crypto.randomUUID()),
    };
    await expect(ready.requestPromotion(actor, { organizationId }, input)).rejects.toMatchObject({
      code: "STRATEGY_PROMOTION_TRANSACTION_REQUIRED",
    });
    expect(
      await findPromotionByIdempotencyKeyPostgres(db, { organizationId }, input.idempotencyKey),
    ).toBeNull();
  });

  it("does not let a future expected revision attach to another command's newly committed state", async () => {
    const record = await request();
    const db = database;
    const nativeTransaction = db.transaction.bind(db);
    // Force the other command to commit between the service read and its write transaction.
    vi.spyOn(db, "transaction").mockImplementationOnce((async (callback, config) => {
      await service().confirmPromotion(actor, { organizationId }, record.id, {
        expectedStateVersion: record.stateVersion,
        coolingOffMs: 1,
      });
      return nativeTransaction(callback, config);
    }) as typeof db.transaction);
    await expect(
      service().confirmPromotion(actor, { organizationId }, record.id, {
        expectedStateVersion: record.stateVersion + 1,
        coolingOffMs: 1,
      }),
    ).rejects.toMatchObject({ code: "STRATEGY_PROMOTION_STATE_VERSION_MISMATCH" });
    expect((await audits(record.id, action.confirm)).length).toBeLessThanOrEqual(1);
  });

  it("keeps the savepoint mutation and audit inside the caller's outer transaction", async () => {
    const db = database;
    const input = {
      idempotencyKey: crypto.randomUUID(),
      assembly: await buildAtomicPromotionAssembly(organizationId, crypto.randomUUID()),
    };
    let recordId = "";
    await expect(
      db.transaction(async (tx) => {
        const ready = createPostgresStrategyPromotionService(tx, {
          validateResearchProvenance: false,
        });
        recordId = (await ready.requestPromotion(actor, { organizationId }, input)).id;
        throw new Error("SYNTHETIC_OUTER_FAILURE");
      }),
    ).rejects.toThrow("SYNTHETIC_OUTER_FAILURE");
    expect(recordId).not.toBe("");
    expect(
      await findPromotionByIdempotencyKeyPostgres(db, { organizationId }, input.idempotencyKey),
    ).toBeNull();
    expect(await audits(recordId, action.request)).toHaveLength(0);
  });
});
