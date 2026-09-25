import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql as sqlExpression } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import * as schema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { buildPaperLoopDepsFromEnv } from "@/lib/trader/paper/build-worker-deps";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import { createPostgresRiskLimitsService } from "@/lib/trader/risk/limits/limits-service";
import { traderAuditActions } from "@/lib/trader/types";
import { seedWp13User } from "./wp13-intelligence-test-helpers";

const url = process.env.DATABASE_URL_POSTGRES?.trim();
const enabled = process.env.WAIA_PG_INTEGRATION === "1" && !!url;

// Unique fixtures retain their append-only audit in the isolated test database.
describe.skipIf(!enabled)("Postgres Risk profile initialization", () => {
  let client: postgres.Sql;
  let db: WaiaPostgresDb;
  let organizationId: string;
  const context = () => ({ organizationId });

  beforeAll(() => {
    client = postgres(url!, { max: 8 });
    db = drizzle(client, { schema });
  });
  beforeEach(async () => {
    organizationId = await seedWp13User(url!, randomUUID(), "Risk bootstrap test");
  });
  afterAll(async () => { await client?.end({ timeout: 5 }); });

  async function rows() {
    return client`SELECT * FROM trader_risk_limits WHERE organization_id = ${organizationId}::uuid`;
  }
  async function audits() {
    return client`SELECT * FROM audit_logs WHERE organization_id = ${organizationId}::uuid
      AND action IN (${traderAuditActions.riskLimitsCreated}, ${traderAuditActions.riskLimitsUpdated})`;
  }
  async function startup(flag: string, accountKey = "paper-internal") {
    const built = await buildPaperLoopDepsFromEnv({
      DATABASE_URL_POSTGRES: url!,
      PAPER_LOOP_ENABLED: flag,
      PAPER_LOOP_ORGANIZATION_ID: organizationId,
      PAPER_LOOP_ACCOUNT_KEY: accountKey,
    });
    await built.dispose();
  }

  it.each(["0", "1"])("repeated startup flag=%s preserves a strict profile, version, timestamps and audit", async (flag) => {
    await createPostgresRiskLimitsService(db).upsertLimitsForOrg(context(), {
      ...DEFAULT_ORG_RISK_LIMITS, maxNotional: "1", actorType: "admin", reason: "test strict envelope",
    });
    const before = await rows();
    const auditBefore = await audits();
    await startup(flag);
    await startup(flag);
    expect(await rows()).toEqual(before);
    expect(await audits()).toEqual(auditBefore);
  });

  it.each([["0", "paper-internal"], ["1", ""]])("disabled/incomplete startup (%s,%s) creates no policy or audit", async (flag, accountKey) => {
    await startup(flag, accountKey);
    expect(await rows()).toHaveLength(0);
    expect(await audits()).toHaveLength(0);
  });

  it("enabled first startup creates the unchanged defaults once", async () => {
    await startup("1");
    const profile = await createPostgresRiskLimitsService(db).getLimitsForOrg(context());
    expect(profile).toMatchObject({ maxNotional: "10000", configVersion: 1 });
    expect(await rows()).toHaveLength(1);
    expect(await audits()).toHaveLength(1);
  });

  it("concurrent initializers create exactly one profile and one audit", async () => {
    const values = await Promise.all(Array.from({ length: 8 }, () =>
      createPostgresRiskLimitsService(db).getOrCreateLimitsForOrg(context())));
    expect(new Set(values.map((v) => v.id)).size).toBe(1);
    expect(values.every((v) => v.configVersion === 1)).toBe(true);
    expect(await rows()).toHaveLength(1);
    expect(await audits()).toHaveLength(1);
  });

  it("a concurrent uncommitted operator insert wins over defaults", async () => {
    let signalInserted!: (pid: number) => void;
    const inserted = new Promise<number>((resolve) => { signalInserted = resolve; });
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    const operator = db.transaction(async (tx) => {
      await createPostgresRiskLimitsService(tx).upsertLimitsForOrg(context(), {
        ...DEFAULT_ORG_RISK_LIMITS, maxNotional: "1", actorType: "admin", reason: "concurrent strict profile",
      });
      const pid = await tx.execute<{ pid: number }>(sqlExpression`select pg_backend_pid() as pid`);
      signalInserted(pid[0]!.pid);
      await released;
    });
    const pid = await inserted;
    const initializer = createPostgresRiskLimitsService(db).getOrCreateLimitsForOrg(context());
    // Observe a real unique-key wait; do not assume scheduler ordering from sleep.
    let blocked = false;
    try {
      for (let i = 0; i < 200; i++) {
        const result = await client<{ blocked: boolean }[]>`SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))
        ) AS blocked`;
        if (result[0]!.blocked) { blocked = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    } finally { release(); }
    const [profile] = await Promise.all([initializer, operator]);
    expect(blocked).toBe(true);
    expect(profile).toMatchObject({ maxNotional: "1", configVersion: 1 });
    expect(await rows()).toHaveLength(1);
    expect(await audits()).toHaveLength(1);
  });

  it("audit failure rolls initialization back, and retry creates one audited row", async () => {
    const service = createPostgresRiskLimitsService(db, {
      writeAudit: async () => { throw new Error("INJECTED_AUDIT_FAILURE"); },
    });
    await expect(service.getOrCreateLimitsForOrg(context())).rejects.toThrow("INJECTED_AUDIT_FAILURE");
    expect(await rows()).toHaveLength(0);
    expect(await audits()).toHaveLength(0);
    await createPostgresRiskLimitsService(db).getOrCreateLimitsForOrg(context());
    expect(await rows()).toHaveLength(1);
    expect(await audits()).toHaveLength(1);
  });

  it("a nontransactional executor fails closed before initialization", async () => {
    const ex = { select: db.select.bind(db), insert: db.insert.bind(db), update: db.update.bind(db) };
    await expect(createPostgresRiskLimitsService(ex).getOrCreateLimitsForOrg(context()))
      .rejects.toThrow("RISK_LIMITS_INITIALIZATION_TRANSACTION_REQUIRED");
    expect(await rows()).toHaveLength(0);
    expect(await audits()).toHaveLength(0);
  });
});
