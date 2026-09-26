import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { createOrderExecutionServiceFromDeps } from "@/lib/trader/execution/execution-service";
import type { OrderExecutionServiceDeps } from "@/lib/trader/execution/execution-service.types";
import * as evaluationCycle from "@/lib/trader/intelligence/evaluation-cycle";
import { createLifecycleRecorder } from "@/lib/trader/lifecycle/lifecycle-recorder";
import { createPostgresLifecycleRepository } from "@/lib/trader/lifecycle/lifecycle-repository-postgres";
import { runPaperCycleOnce } from "@/lib/trader/paper/paper-cycle-runner";
import type { PaperCycleDeps } from "@/lib/trader/paper/paper-cycle.types";
import { guardianScopeFixture } from "@/tests/helpers/guardian-observation-scope-fixture";
import { seedWp13User } from "./wp13-intelligence-test-helpers";

const url = process.env.DATABASE_URL_POSTGRES?.trim();
const enabled = process.env.WAIA_PG_INTEGRATION === "1" && !!url;

describe.skipIf(!enabled)("Postgres Guardian observation scope (DEE-1119)", () => {
  let client: postgres.Sql;
  let db: WaiaPostgresDb;
  beforeAll(() => {
    if (!new Set(["localhost", "127.0.0.1", "::1", "[::1]"]).has(new URL(url!).hostname)) {
      throw new Error("GUARDIAN_SCOPE_TEST_REQUIRES_LOOPBACK_POSTGRES");
    }
    client = postgres(url!, { max: 2 }); db = drizzle(client, { schema });
  });
  beforeEach(() => vi.restoreAllMocks());
  afterAll(async () => { await client?.end({ timeout: 5 }); });

  async function seed() {
    const org = await seedWp13User(url!, randomUUID(), "Guardian scope native");
    const otherOrg = await seedWp13User(url!, randomUUID(), "Guardian scope other tenant");
    const f = guardianScopeFixture(org);
    const repository = createPostgresLifecycleRepository(db);
    const lots = [];
    for (const [organizationId, symbol, accountKey] of [
      [org, "BTC/USDT", "account-a"], [org, "ETH/USDT", "account-a"],
      [org, "BTC/USDT", "account-b"], [org, "ETH/USDT", "account-b"],
      [otherOrg, "BTC/USDT", "account-a"],
    ]) {
      const context = { organizationId }, tradeId = randomUUID();
      await repository.insertTrade(context, { trade: { ...f.trade, id: tradeId, organizationId, symbol, accountKey } });
      lots.push(await repository.insertPositionLot(context, { lot: { ...f.lot, id: randomUUID(), tradeId, organizationId, symbol, accountKey, avgCost: symbol === "ETH/USDT" ? "2000" : "64000" } }));
    }
    const forbidden = vi.fn(() => { throw new Error("UNEXPECTED_CAPITAL_OR_PROVIDER_PORT"); });
    // Real legacy execution boundary, with all capital/provider dependencies inert.
    const execution = createOrderExecutionServiceFromDeps({
      nowMs: () => 0, connectorForMode: forbidden, writeAudit: forbidden,
      riskEngine: { evaluate: forbidden }, killSwitchResolver: { resolve: forbidden }, orderRepository: {},
    } as unknown as OrderExecutionServiceDeps);
    const submit = vi.spyOn(execution, "submitOrder");
    const deps = { execution, lifecycleRepository: repository, lifecycleRecorder: createLifecycleRecorder({ repository, newId: randomUUID }) } as PaperCycleDeps;
    vi.spyOn(evaluationCycle, "runEvaluationCycle").mockReturnValue(f.evaluation);
    return { f, org, otherOrg, lots, repository, deps, forbidden, submit };
  }

  it.each(["ONLY_CLOSE_POSITIONS", "ALLOW_TRADING"] as const)("records only the matching lot with %s in a mixed native dataset", async (permission) => {
    const h = await seed(); h.f.evaluation.msv.derived.tradingPermission = permission;
    const result = await runPaperCycleOnce(h.deps, h.f.input);
    expect(result.guardian?.evaluations).toHaveLength(1);
    expect(result.guardian?.evaluations[0]).toMatchObject({ positionLotId: h.lots[0]!.id, reason: { unrealizedPnlUsdt: "1000" } });
    const events = await h.repository.listLifecycleEvents({ organizationId: h.org });
    expect(events).toHaveLength(permission === "ONLY_CLOSE_POSITIONS" ? 2 : 1);
    expect(events.every((event) => event.entityId === h.lots[0]!.id)).toBe(true);
    expect(await h.repository.listLifecycleEvents({ organizationId: h.otherOrg })).toEqual([]);
    if (permission === "ONLY_CLOSE_POSITIONS") {
      expect(result.guardianExecutions?.[0]?.execution).toMatchObject({ status: "execution_v2_required", order: null });
      expect(h.submit).toHaveBeenCalledTimes(1);
      expect(h.submit.mock.calls[0]?.[1]).toMatchObject({ accountKey: "account-a", symbol: "BTC/USDT", quantity: "1" });
    } else expect(h.submit).not.toHaveBeenCalled();
    expect(h.forbidden).not.toHaveBeenCalled();
    expect(await h.repository.listOpenPositionLots({ organizationId: h.org })).toHaveLength(4);
    expect((await h.repository.listTrades({ organizationId: h.org })).every((trade) => trade.state === "OPEN")).toBe(true);
  });

  it.each(["foreign-account", "foreign-tenant", "mismatched-trade", "wrong-snapshot"])("refuses %s before actual recorder writes", async (kind) => {
    const h = await seed();
    if (kind === "foreign-account" || kind === "foreign-tenant") {
      vi.spyOn(h.repository, "listOpenPositionLots").mockResolvedValue([h.lots[0]!, h.lots[kind === "foreign-account" ? 2 : 4]!]);
    } else if (kind === "mismatched-trade") {
      const other = await h.repository.getTradeById({ organizationId: h.org }, h.lots[2]!.tradeId);
      vi.spyOn(h.repository, "getTradeById").mockResolvedValue({ ...other!, id: h.lots[0]!.tradeId });
    } else h.f.input.snapshot.quote.symbol = "ETH/USDT";
    await expect(runPaperCycleOnce(h.deps, h.f.input)).rejects.toMatchObject({ code: "GUARDIAN_OBSERVATION_SCOPE_MISMATCH" });
    expect(await h.repository.listLifecycleEvents({ organizationId: h.org })).toEqual([]);
    expect(await h.repository.listLifecycleEvents({ organizationId: h.otherOrg })).toEqual([]);
    expect(h.submit).not.toHaveBeenCalled(); expect(h.forbidden).not.toHaveBeenCalled();
  });

  it("honestly returns empty when the exact scope has no lots", async () => {
    const h = await seed(); h.f.input.accountKey = "empty-account";
    const result = await runPaperCycleOnce(h.deps, h.f.input);
    expect(result.guardian).toEqual({ evaluations: [], exitIntents: [] });
    expect(await h.repository.listLifecycleEvents({ organizationId: h.org })).toEqual([]);
    expect(h.submit).not.toHaveBeenCalled(); expect(h.forbidden).not.toHaveBeenCalled();
  });
});
