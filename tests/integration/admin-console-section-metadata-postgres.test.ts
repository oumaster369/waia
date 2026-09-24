/** Opt-in disposable local PostgreSQL only; append-only synthetic evidence is retained. */
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema.postgres";
import type { AdminRouteHandlerDeps } from "@/lib/trader/admin-route-shared";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import type { AdminPostgresDb } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import { handleAdminConsoleResearchCatalogGet } from "@/lib/trader/admin-console/handlers/research-catalog";
import { handleAdminConsoleStrategiesGet } from "@/lib/trader/admin-console/handlers/strategies";
import { handleAdminConsoleSystemGet } from "@/lib/trader/admin-console/handlers/system";
import { handleAdminConsoleResearchRunsGet } from "@/lib/trader/admin-console/handlers/research-runs";
const url = process.env.DATABASE_URL_POSTGRES;
const enabled = process.env.WAIA_PG_INTEGRATION === "1" && Boolean(url);
const admin = randomUUID();
const ordinary = randomUUID();
function request(path: string, body?: unknown, origin = "http://localhost") {
  return new Request(
    `http://localhost/api/trader/admin/console/${path}`,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
}
describe.skipIf(!enabled)("admin console section metadata on Postgres", () => {
  let client: postgres.Sql;
  let db: AdminPostgresDb;
  const deps = (userId = admin): AdminRouteHandlerDeps => ({
    getUserId: async () => userId,
    getRuntimeDb: async () => ({ kind: "postgres", db, _sql: client }),
    disposeRuntimeDb: async () => undefined,
  });
  beforeAll(async () => {
    if (!["localhost", "127.0.0.1", "::1"].includes(new URL(url!).hostname))
      throw new Error("TEST_REQUIRES_LOCAL_DISPOSABLE_POSTGRES");
    client = postgres(url!, { max: 5, prepare: false });
    db = drizzle(client, { schema });
    for (const id of [admin, ordinary]) {
      await client`INSERT INTO auth.users (id) VALUES (${id}::uuid)`;
      await client`INSERT INTO users (id, identity_label, email) VALUES (${id}::uuid, 'Console workflow test', ${`${id}@waia.invalid`})`;
      await ensureUserCoreSeedPostgres(db, { userId: id, displayName: "Console workflow test" });
    }
    await client`UPDATE user_platform_roles SET role = 'admin' WHERE user_id = ${admin}::uuid`;
  });
  afterAll(async () => {
    await client?.end();
  });
  it("reads each section from real tables and distinguishes unsupported account/mode bindings", async () => {
    const org = personalOrganizationIdFromUserId(admin);
    for (const tab of ["campaigns", "knowledge", "qualification"]) {
      const result = await handleAdminConsoleResearchCatalogGet(
        request(`research/catalog?organization_id=${org}&tab=${tab}`),
        deps(),
      );
      expect(result.status, tab).toBe(200);
      expect(result.body).toMatchObject({
        schemaVersion: "admin-console/v1",
        scope: { kind: "organization", organizationId: org },
        data: { items: expect.any(Array) },
      });
      const account = await handleAdminConsoleResearchCatalogGet(
        request(`research/catalog?organization_id=${org}&exchange_account_id=unbound&tab=${tab}`),
        deps(),
      );
      expect(account.body).toMatchObject({
        data: {
          state: "not_applicable",
          total: null,
          reasons: ["RESEARCH_EXCHANGE_ACCOUNT_BINDING_NOT_PERSISTED"],
        },
      });
    }
    const live = await handleAdminConsoleResearchRunsGet(
      request(`research/runs?organization_id=${org}&mode=live`),
      deps(),
    );
    expect(live.body).toMatchObject({
      data: { state: "not_applicable", reasons: ["RESEARCH_REQUIRES_HISTORY_MODE"] },
    });
    const history = await handleAdminConsoleResearchRunsGet(
      request(`research/runs?organization_id=${org}&mode=history`),
      deps(),
    );
    expect(history.status).toBe(200);
    expect(history.body).toMatchObject({ data: { items: [] } });
    for (const tab of ["services", "sources", "jobs", "ai", "authority", "releases", "audit"]) {
      const result = await handleAdminConsoleSystemGet(
        request(`system?organization_id=${org}&tab=${tab}`),
        deps(),
      );
      expect(result.status, tab).toBe(200);
      expect(result.body).toMatchObject({
        data: { diagnosticScope: "fleet", jobs: expect.any(Array) },
      });
    }
  });
  it("filters research and version evidence before projection without reading sealed payloads", async () => {
    const own = personalOrganizationIdFromUserId(admin);
    const other = personalOrganizationIdFromUserId(ordinary);
    const token = randomUUID();
    for (const org of [own, other]) {
      await client`INSERT INTO trader_discovery_research_campaign (id,organization_id,campaign_key,name,research_program,description,symbol_scope,current_state,content_digest)
        VALUES (${randomUUID()}::uuid,${org}::uuid,${token},${`campaign-${org}`},'test','metadata only','BTCUSDT','DRAFT',${"a".repeat(64)})`;
      await client`INSERT INTO research_dataset (id,organization_id,name,symbol,interval,train_bar_count,validation_bar_count,blind_bar_count,train_digest,validation_digest,blind_digest,sealed_at,metadata_json)
        VALUES (${randomUUID()}::uuid,${org}::uuid,${`dataset-${org}`},'BTCUSDT','1m',10,5,5,${"a".repeat(64)},${"b".repeat(64)},${"c".repeat(64)},now(),${"DO_NOT_READ_HOLDOUT_PAYLOAD"})`;
      await client`INSERT INTO trader_strategy_candidates (id,organization_id,strategy_id,strategy_version,status,params_json)
        VALUES (${randomUUID()}::uuid,${org}::uuid,${`strategy-${org}`},'version-a','draft','{}')`;
    }
    const campaigns = await handleAdminConsoleResearchCatalogGet(
      request(`research/catalog?organization_id=${own}&tab=campaigns&limit=1`),
      deps(),
    );
    expect(JSON.stringify(campaigns.body)).toContain(`campaign-${own}`);
    expect(JSON.stringify(campaigns.body)).not.toContain(`campaign-${other}`);
    const qualification = await handleAdminConsoleResearchCatalogGet(
      request(`research/catalog?organization_id=${own}&tab=qualification`),
      deps(),
    );
    expect(JSON.stringify(qualification.body)).toContain(`dataset-${own}`);
    expect(JSON.stringify(qualification.body)).not.toContain("DO_NOT_READ_HOLDOUT_PAYLOAD");
    expect(JSON.stringify(qualification.body)).not.toContain(`dataset-${other}`);
    const strategies = await handleAdminConsoleStrategiesGet(
      request(`strategies?organization_id=${own}&mode=live`),
      deps(),
    );
    expect(strategies.status).toBe(200);
    expect(JSON.stringify(strategies.body)).toContain(`strategy-${own}`);
    expect(JSON.stringify(strategies.body)).not.toContain(`strategy-${other}`);
    const account = await handleAdminConsoleStrategiesGet(
      request(`strategies?organization_id=${own}&exchange_account_id=unbound&mode=live`),
      deps(),
    );
    expect(JSON.stringify(account.body)).not.toContain(`strategy-${own}`);
    expect(account.body).toMatchObject({
      data: { scopeReason: "STRATEGY_ACCOUNT_DEPLOYMENT_NOT_PERSISTED" },
    });
  });
  it("keeps audit metadata read-only and scoped without arbitrary payloads", async () => {
    const own = personalOrganizationIdFromUserId(admin);
    const other = personalOrganizationIdFromUserId(ordinary);
    for (const org of [own, other]) {
      await client`INSERT INTO audit_logs(id,organization_id,actor_type,actor_id,action,entity_type,entity_id,metadata_json)
        VALUES (${randomUUID()}::uuid,${org}::uuid,'admin',${admin},'trader.console.synthetic','trader_test',${`entity-${org}`},${JSON.stringify({ secret: "NEVER_INCLUDE_METADATA_SECRET" })}::jsonb)`;
    }
    const audit = await handleAdminConsoleSystemGet(
      request(`system?organization_id=${own}&tab=audit`),
      deps(),
    );
    expect(audit.status).toBe(200);
    expect(JSON.stringify(audit.body)).toContain(`entity-${own}`);
    expect(JSON.stringify(audit.body)).not.toContain(`entity-${other}`);
    expect(JSON.stringify(audit.body)).not.toContain("NEVER_INCLUDE_METADATA_SECRET");
    const account = await handleAdminConsoleSystemGet(
      request(`system?organization_id=${own}&exchange_account_id=unbound&tab=audit`),
      deps(),
    );
    expect(account.body).toMatchObject({
      data: {
        audit: { items: [], total: null, reason: "AUDIT_EXCHANGE_ACCOUNT_BINDING_NOT_PERSISTED" },
      },
    });
  });
});
