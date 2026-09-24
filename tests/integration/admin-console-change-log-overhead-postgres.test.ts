/**
 * Opt-in profile 9.3.3. Requires an isolated local Postgres:
 * WAIA_PG_INTEGRATION=1, WAIA_ADMIN_CONSOLE_PROFILE=1, DATABASE_URL_POSTGRES on 127.0.0.1.
 * Never reads .env.local. Each mode warms 40 orders before the timed 5000, and WAL starts after that warmup.
 * CI assert is 2x. The tighter plan budgets are reported, not the hard fail.
 */

import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { eq } from "drizzle-orm";

import { getPostgresDrizzle } from "@/db/postgres-client";
import * as pgSchema from "@/db/schema.postgres";
import {
  createOrderPostgres,
  recordFillPostgres,
  transitionOrderPostgres,
} from "@/lib/trader/execution/repository-postgres";
import { insertKillSwitchRowPostgres } from "@/lib/trader/risk/kill-switch/repository-postgres";

const url = process.env.DATABASE_URL_POSTGRES?.trim() ?? "";
const host = url ? new URL(url).hostname : "";
const local = host === "127.0.0.1" || host === "localhost";
const enabled =
  process.env.WAIA_PG_INTEGRATION === "1" &&
  process.env.WAIA_ADMIN_CONSOLE_PROFILE === "1" &&
  local;

const ORDER_N = 1250;
const ACCOUNT_N = 625;
const KILL_N = 625;

function percentile(samples: number[], ratio: number): number {
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(ratio * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

function budgetOk(fact: number, threshold: number): "ok" | "over" {
  return fact <= threshold ? "ok" : "over";
}

describe.skipIf(!enabled)("admin console change-log overhead profile 9.3.3", () => {
  const sql = enabled ? postgres(url, { max: 1 }) : null;

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it("measures 5000 real writes with triggers and without", async () => {
    if (!sql) return;
    const db = getPostgresDrizzle();
    const orgId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const credentialId = crypto.randomUUID();
    const context = { organizationId: orgId };
    const triggerTables = [...readTriggerTables()];

    await sql`INSERT INTO auth.users (id) VALUES (${userId}::uuid)`;
    await sql`INSERT INTO users (id, identity_label, email) VALUES (${userId}, ${"overhead"}, ${`${userId}@waia.invalid`})`;
    await sql`INSERT INTO organizations (id, owner_user_id, kind, name) VALUES (${orgId}, ${userId}, ${"personal"}, ${"overhead"})`;
    await db.insert(pgSchema.exchangeCredentials).values({
      id: credentialId,
      organizationId: orgId,
      venue: "htx",
      exchangeAccountId: "overhead-account",
      status: "active",
    });
    await db.insert(pgSchema.traderAccountCollectionState).values({
      organizationId: orgId,
      credentialId,
      exchangeAccountId: "overhead-account",
      configurationRevision: "profile",
      symbols: ["BTCUSDT"],
    });

    const measure = async (triggersOn: boolean) => {
      for (const table of triggerTables) {
        await sql.unsafe(
          `ALTER TABLE public.${table} ${triggersOn ? "ENABLE" : "DISABLE"} TRIGGER trader_admin_change_log_trg`,
        );
      }
      const label = triggersOn ? "on" : "off";
      for (let index = 0; index < 40; index += 1) {
        const suffix = `warm-${label}-${index}`;
        const created = await createOrderPostgres(db, context, {
          venue: "htx",
          executionMode: "live",
          symbol: "BTCUSDT",
          side: "buy",
          type: "market",
          quantity: "1",
          clientOrderId: `client-${suffix}`,
          idempotencyKey: `idem-${suffix}`,
          riskDecisionId: "risk",
        });
        await transitionOrderPostgres(db, context, {
          orderId: created.id,
          expectedStateVersion: 1,
          toState: "RISK_APPROVED",
        });
        await recordFillPostgres(db, context, {
          orderId: created.id,
          exchangeTradeId: `trade-${suffix}`,
          price: "1",
          quantity: "1",
          executedAt: new Date("2026-09-24T00:00:00.000Z"),
        });
      }
      const startLsn = await sql<{ lsn: string }[]>`SELECT pg_current_wal_lsn()::text AS lsn`;
      const samples: number[] = [];
      const time = async (write: () => Promise<unknown>) => {
        const started = performance.now();
        await write();
        samples.push(performance.now() - started);
      };
      const orderIds: string[] = [];
      for (let index = 0; index < ORDER_N; index += 1) {
        const suffix = `${triggersOn ? "on" : "off"}-${index}`;
        await time(async () => {
          const created = await createOrderPostgres(db, context, {
            venue: "htx",
            executionMode: "live",
            symbol: "BTCUSDT",
            side: "buy",
            type: "market",
            quantity: "1",
            clientOrderId: `client-${suffix}`,
            idempotencyKey: `idem-${suffix}`,
            riskDecisionId: "risk",
          });
          orderIds.push(created.id);
        });
        const orderId = orderIds[index]!;
        await time(() =>
          transitionOrderPostgres(db, context, {
            orderId,
            expectedStateVersion: 1,
            toState: "RISK_APPROVED",
          }),
        );
        await time(() =>
          recordFillPostgres(db, context, {
            orderId,
            exchangeTradeId: `trade-${suffix}`,
            price: "1",
            quantity: "1",
            executedAt: new Date("2026-09-24T00:00:00.000Z"),
          }),
        );
      }
      for (let index = 0; index < ACCOUNT_N; index += 1) {
        await time(() =>
          db
            .update(pgSchema.traderAccountCollectionState)
            .set({ consecutiveFailures: index % 30 })
            .where(eq(pgSchema.traderAccountCollectionState.credentialId, credentialId)),
        );
      }
      for (let index = 0; index < KILL_N; index += 1) {
        await time(() =>
          insertKillSwitchRowPostgres(
            db,
            { scopeType: "organization", organizationId: orgId },
            {
              scopeType: "organization",
              scopeRef: `${triggersOn ? "on" : "off"}-${index}`,
              switchType: "PAUSE",
            },
            {
              enforcementMode: "REJECT",
              origin: "manual",
              reason: "profile",
              state: "ACTIVE",
            },
          ),
        );
      }
      const endLsn = await sql<{ lsn: string }[]>`SELECT pg_current_wal_lsn()::text AS lsn`;
      const wal = await sql<{ bytes: string }[]>`
        SELECT pg_wal_lsn_diff(${endLsn[0]!.lsn}::pg_lsn, ${startLsn[0]!.lsn}::pg_lsn)::text AS bytes
      `;
      expect(samples).toHaveLength(ORDER_N * 3 + ACCOUNT_N + KILL_N);
      return {
        p95: percentile(samples, 0.95),
        p99: percentile(samples, 0.99),
        wal: Number(wal[0]?.bytes ?? "0"),
      };
    };

    let off = { p95: 0, p99: 0, wal: 0 };
    let on = { p95: 0, p99: 0, wal: 0 };
    try {
      on = await measure(true);
      off = await measure(false);
    } finally {
      for (const table of triggerTables) {
        await sql.unsafe(`ALTER TABLE public.${table} ENABLE TRIGGER trader_admin_change_log_trg`);
      }
      await sql`DELETE FROM trader_fills WHERE organization_id = ${orgId}::uuid`;
      await sql`DELETE FROM trader_order_events WHERE organization_id = ${orgId}::uuid`;
      await sql`DELETE FROM trader_orders WHERE organization_id = ${orgId}::uuid`;
      await sql`DELETE FROM trader_kill_switches WHERE organization_id = ${orgId}::uuid`;
      await sql`DELETE FROM trader_account_collection_state WHERE organization_id = ${orgId}::uuid`;
      await sql`DELETE FROM exchange_credentials WHERE organization_id = ${orgId}::uuid`;
      await sql`DELETE FROM trader_admin_change_log WHERE organization_id = ${orgId}::uuid OR entity_id LIKE ${`${orgId}%`}`;
      await sql`DELETE FROM organizations WHERE id = ${orgId}::uuid`;
      await sql`DELETE FROM users WHERE id = ${userId}::uuid`;
      await sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
    }

    const p95Threshold = Math.max(off.p95 * 1.2, off.p95 + 1);
    const walThreshold = off.wal * 1.3;
    const ciP95 = Math.max(off.p95 * 2, off.p95 + 1);
    const ciWal = off.wal * 2;
    const rows = [
      ["p95", p95Threshold, on.p95, budgetOk(on.p95, p95Threshold)],
      ["p99", "reported", on.p99, "ok"],
      ["WAL", walThreshold, on.wal, budgetOk(on.wal, walThreshold)],
      ["CI p95", ciP95, on.p95, budgetOk(on.p95, ciP95)],
      ["CI WAL", ciWal, on.wal, budgetOk(on.wal, ciWal)],
    ] as const;
    console.info("metric | threshold | fact | ok");
    for (const [metric, threshold, fact, ok] of rows) {
      const factText = typeof fact === "number" ? fact.toFixed(3) : String(fact);
      const thresholdText = typeof threshold === "number" ? threshold.toFixed(3) : threshold;
      console.info(`${metric} | ${thresholdText} | ${factText} | ${ok}`);
    }
    console.info(
      `overhead baseline p95=${off.p95.toFixed(3)} p99=${off.p99.toFixed(3)} wal=${off.wal.toFixed(0)} enabled p95=${on.p95.toFixed(3)} p99=${on.p99.toFixed(3)} wal=${on.wal.toFixed(0)}`,
    );
    expect(on.p95).toBeLessThanOrEqual(ciP95);
    expect(on.wal).toBeLessThanOrEqual(Math.max(ciWal, 1));
  }, 1_200_000);
});

function readTriggerTables(): string[] {
  const source = readFileSync(
    join(process.cwd(), "db/migrations_postgres/0216_trader_admin_change_log_triggers.sql"),
    "utf8",
  );
  return [
    ...new Set(
      [...source.matchAll(/TRIGGER trader_admin_change_log_trg ON public\.([a-z0-9_]+)/g)].map(
        (match) => match[1]!,
      ),
    ),
  ];
}
