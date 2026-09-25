import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import * as schema from "@/db/schema";
import * as audit from "@/lib/waia-core/audit/write";
import { createSqliteStrategyPromotionService } from "@/lib/trader/validation-gate/promotion-service";
import {
  getPromotionRecordByIdSqlite,
  findPromotionByIdempotencyKeySqlite,
} from "@/lib/trader/validation-gate/repository-sqlite";
import { buildAtomicPromotionAssembly } from "@/tests/helpers/atomic-promotion-assembly";

const user = crypto.randomUUID();
let organizationId: string;
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
  return createSqliteStrategyPromotionService(getDb(), {
    nowMs: () => now,
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
  return getDb()
    .select()
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.organizationId, organizationId),
        eq(schema.auditLogs.entityId, recordId),
        eq(schema.auditLogs.action, expectedAction),
      ),
    )
    .all();
}

describe("DEE-1101 native SQLite promotion state and Core audit atomicity", () => {
  beforeAll(() => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "waia-promotion-atomic-"));
    process.env.DATABASE_URL = `file:${path.join(directory, "test.sqlite")}`;
    migrateDatabaseFromEnv();
    insertEmailPasswordUser(getDb(), {
      id: user,
      email: `${user}@waia.invalid`,
      password: "fixture-password",
    });
    organizationId = ensureUserCoreSeedSqlite(getDb(), {
      userId: user,
      displayName: "Atomic promotion fixture",
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("rolls back request when audit append fails and permits an exact retry", async () => {
    const input = {
      idempotencyKey: crypto.randomUUID(),
      assembly: await buildAtomicPromotionAssembly(organizationId, crypto.randomUUID()),
    };
    vi.spyOn(audit, "writeAuditLogSqlite").mockImplementationOnce(() => {
      throw new Error("SYNTHETIC_AUDIT_FAILURE");
    });
    await expect(service().requestPromotion(actor, { organizationId }, input)).rejects.toThrow(
      "SYNTHETIC_AUDIT_FAILURE",
    );
    expect(
      await findPromotionByIdempotencyKeySqlite(getDb(), { organizationId }, input.idempotencyKey),
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
      vi.spyOn(audit, "writeAuditLogSqlite").mockImplementationOnce(() => {
        throw new Error("SYNTHETIC_AUDIT_FAILURE");
      });
      await expect(invoke()).rejects.toThrow("SYNTHETIC_AUDIT_FAILURE");
      expect(
        await getPromotionRecordByIdSqlite(getDb(), { organizationId }, record.id),
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
  it("CAS admits only one concurrent transition and one audit", async () => {
    const ready = service();
    const record = await request();
    const results = await Promise.allSettled(
      Array.from({ length: 2 }, () =>
        ready.confirmPromotion(actor, { organizationId }, record.id, {
          expectedStateVersion: record.stateVersion,
          coolingOffMs: 1,
        }),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await audits(record.id, action.confirm)).toHaveLength(1);
    expect(
      await getPromotionRecordByIdSqlite(getDb(), { organizationId }, record.id),
    ).toMatchObject({ state: "COOLING_OFF", stateVersion: 2 });
  });
});
