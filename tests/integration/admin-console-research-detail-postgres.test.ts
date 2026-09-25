/** Opt-in disposable local Postgres. Sealed payload markers must never be selected. */
import { handleAdminConsolePromotionsGet } from "@/lib/trader/admin-console/handlers/promotions";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import * as schema from "@/db/schema.postgres";
import type { AdminPostgresDb } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import { withAdminReadSnapshot } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import { canonicalSqlOnSnapshot } from "@/lib/trader/admin-console/repositories/canonical-sql-adapter";
import { handleAdminConsoleResearchDetailGet } from "@/lib/trader/admin-console/handlers/research-detail";
import { handleAdminConsoleResearchRunsGet } from "@/lib/trader/admin-console/handlers/research-runs";
import { handleAdminConsoleStrategyDetailGet } from "@/lib/trader/admin-console/handlers/strategy-detail";
import { readAssistantTool } from "@/lib/trader/admin-console/handlers/assistant-reads";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import type { AdminRouteHandlerDeps } from "@/lib/trader/admin-route-shared";
const url = process.env.DATABASE_URL_POSTGRES,
  enabled = process.env.WAIA_PG_INTEGRATION === "1" && !!url;
describe.skipIf(!enabled)("research evidence and comparison on Postgres", () => {
  let client: postgres.Sql, db: AdminPostgresDb;
  const admin = randomUUID(),
    other = randomUUID(),
    org = personalOrganizationIdFromUserId(admin),
    foreign = personalOrganizationIdFromUserId(other),
    first = randomUUID(),
    second = randomUUID(),
    blind = randomUUID(),
    outside = randomUUID();
  const deps = (): AdminRouteHandlerDeps => ({
    getUserId: async () => admin,
    getRuntimeDb: async () => ({ kind: "postgres", db, _sql: client }),
    disposeRuntimeDb: async () => undefined,
  });
  const request = (extra = "", organization = org) =>
    new Request(
      `http://localhost/api/trader/admin/console/research?organization_id=${organization}&mode=history&${extra}`,
    );
  const id = (run: string, organization = org) => `backtest:${organization}:${run}`;
  beforeAll(async () => {
    if (!["localhost", "127.0.0.1", "::1"].includes(new URL(url!).hostname))
      throw new Error("LOCAL_TEST_DATABASE_REQUIRED");
    client = postgres(url!, { max: 3, prepare: false });
    db = drizzle(client, { schema });
    for (const user of [admin, other]) {
      await client`INSERT INTO auth.users(id) VALUES (${user}::uuid)`;
      await client`INSERT INTO users(id,identity_label,email) VALUES (${user}::uuid,'Research fixture',${`${user}@waia.invalid`})`;
      await ensureUserCoreSeedPostgres(db, { userId: user, displayName: "Research fixture" });
    }
    await client`UPDATE user_platform_roles SET role='admin' WHERE user_id=${admin}::uuid`;
    for (const organization of [org, foreign]) {
      const dataset = randomUUID();
      await client`INSERT INTO research_dataset(id,organization_id,name,symbol,interval,train_bar_count,validation_bar_count,blind_bar_count,train_digest,validation_digest,blind_digest,sealed_at,metadata_json) VALUES (${dataset}::uuid,${organization}::uuid,${dataset},'BTCUSDT','1m',10,5,5,${"a".repeat(64)},${"b".repeat(64)},${"c".repeat(64)},now(),'SEALED_DATASET_SECRET')`;
      for (const run of organization === org ? [first, second, blind] : [outside]) {
        await client`INSERT INTO trader_backtest_runs(id,organization_id,dataset_id,strategy_id,strategy_version,cost_model_version,split,status,completed_at) VALUES (${run}::uuid,${organization}::uuid,${dataset}::uuid,'version-proof',${run === second ? "v2" : "v1"},'cost-v1',${run === blind ? "blind" : "validation"}::research_dataset_split,'completed',now())`;
        await client`INSERT INTO trader_backtest_results(id,organization_id,run_id,regime_label,metrics_json) VALUES (${randomUUID()}::uuid,${organization}::uuid,${run}::uuid,'RANGE',${run === blind ? "BLIND_PAYLOAD_MUST_NEVER_PARSE" : JSON.stringify([{ strategySignalId: "signal", periodRealizedPnl: "123456789.12345678", periodTotalFees: "0.00000001", closedTradeCount: 1, evidenceContentDigest: "digest", secret: "UNRELATED_MUST_NOT_APPEAR" }])})`;
      }
    }
  });
  afterAll(async () => {
    await client?.end();
  });
  it("lists historical and non-blind tests and opens a direct id beyond the list limit", async () => {
    const list = await handleAdminConsoleResearchRunsGet(request("limit=1"), deps());
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({
      data: {
        total: 2,
        items: [expect.objectContaining({ kind: "backtest", committedCycles: null })],
      },
    });
    const detail = await handleAdminConsoleResearchDetailGet(request("limit=1"), deps(), [
      id(first),
    ]);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      data: {
        items: [
          expect.objectContaining({
            resultSlices: [
              expect.objectContaining({ realizedPnl: "123456789.12345678", fees: "0.00000001" }),
            ],
            metrics: expect.objectContaining({ netPnl: null }),
          }),
        ],
      },
    });
    for (const marker of [
      "SEALED_DATASET_SECRET",
      "BLIND_PAYLOAD_MUST_NEVER_PARSE",
      "UNRELATED_MUST_NOT_APPEAR",
    ])
      expect(JSON.stringify(detail.body)).not.toContain(marker);
  });
  it("returns 404 for blind, foreign, wrong account and wrong mode before payload access", async () => {
    for (const [req, ids] of [
      [request(), [id(blind)]],
      [request(), [id(outside, foreign)]],
      [request("exchange_account_id=x"), [id(first)]],
      [new Request(`http://localhost/?organization_id=${org}&mode=live`), [id(first)]],
    ] as const) {
      expect((await handleAdminConsoleResearchDetailGet(req, deps(), ids)).status).toBe(404);
    }
  });
  it("compares conditions before metrics and assistant calls the exact same reader", async () => {
    const ids = [id(first), id(second)],
      direct = await handleAdminConsoleResearchDetailGet(request(), deps(), ids);
    expect(direct.body).toMatchObject({
      data: {
        comparison: {
          sameConditions: false,
          differences: ["version"],
          unknownConditions: expect.arrayContaining(["period", "model"]),
        },
      },
    });
    const tool = await readAssistantTool(
      "compare_research_runs",
      request(ids.map((v) => `run_id=${encodeURIComponent(v)}`).join("&")),
      deps(),
    );
    expect((tool.body as { data: unknown }).data).toEqual((direct.body as { data: unknown }).data);
    expect(
      (await handleAdminConsoleResearchDetailGet(request(), deps(), [id(first), id(first)])).status,
    ).toBe(400);
  });
  it("binds canonical reader parameters and preserves read-only repeatable-read", async () => {
    const snapshot = await withAdminReadSnapshot(db, async (tx) => {
      const adapter = canonicalSqlOnSnapshot(tx);
      return adapter.unsafe(
        "SELECT $1::text AS value, current_setting('transaction_isolation') AS isolation, current_setting('transaction_read_only') AS readonly",
        ["x'; DELETE FROM users; --"],
      );
    });
    expect(snapshot.value[0]).toMatchObject({
      value: "x'; DELETE FROM users; --",
      isolation: "repeatable read",
      readonly: "on",
    });
  });
  it("reads strategy detail from the real schema with mode-separated empty evidence", async () => {
    const result = await handleAdminConsoleStrategyDetailGet(
      request("strategy_id=version-proof&strategy_version=v1"),
      deps(),
    );
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      data: {
        performance: [{ mode: "history", state: "empty", realized: "0" }],
        decisions: [],
        returnPct: { reason: "RETURN_METHOD_NOT_RATIFIED" },
      },
    });
  });
  it("promotion metadata never selects Paper/research documents or sealed payloads", async () => {
    const promotion = randomUUID();
    await client`INSERT INTO trader_strategy_promotion_records(id,organization_id,strategy_id,strategy_version,git_commit_sha,target_deployment_state,hypothesis,intended_regime,cost_model_json,failure_modes_json,reason_code_distribution_json,paper_trading_evidence_json,research_evidence_json,evidence_content_digest,confidence_attestation_json,record_content_digest,schema_version,state,requested_at,cooling_off_ends_at,state_version) VALUES (${promotion}::uuid,${org}::uuid,'metadata-safe','v1',${"a".repeat(40)},'LIVE_LIMITED','Synthetic','RANGE','{}','[]','{}','{"secret":"PAPER_DOCUMENT_NOT_FOR_UI"}','{"blind_payload":"HOLDOUT_DOCUMENT_NOT_FOR_UI"}','digest','{}','record-digest','fixture','COOLING_OFF',now(),now()+interval '1 day',7)`;
    const result = await handleAdminConsolePromotionsGet(
      request("strategy_id=metadata-safe"),
      deps(),
    );
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      data: {
        pending: { id: promotion, stateVersion: 7, revision: `promotion:${promotion}:7` },
        effective: null,
      },
    });
    expect(JSON.stringify(result.body)).not.toContain("DOCUMENT_NOT_FOR_UI");
    const foreignResult = await handleAdminConsolePromotionsGet(
      request("strategy_id=metadata-safe", foreign),
      deps(),
    );
    expect(foreignResult.body).toMatchObject({ data: { pending: null, effective: null } });
  });
});
