/** Disposable PostgreSQL only; no production credentials, network dispatch or live authority. */
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema.postgres";
import type { AdminPostgresDb } from "@/lib/trader/admin-console/repositories/snapshot.postgres";
import type { AdminRouteHandlerDeps } from "@/lib/trader/admin-route-shared";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { consoleObservation } from "@/tests/helpers/admin-console-observation";
import { handleAdminConsoleOrderDetailGet } from "@/lib/trader/admin-console/handlers/order-detail";
import { handleAdminConsoleAccountDetailGet } from "@/lib/trader/admin-console/handlers/account-detail";
import { handleAdminConsoleClientHistoryGet } from "@/lib/trader/admin-console/handlers/client-history";
import { postgresTestOnlyExecutionV2Authority } from "@/tests/helpers/execution-v2-test-only-postgres";
import { persistIntelligenceCycleBundle } from "@/lib/trader/intelligence/records/atomic-cycle-bundle-repository-postgres";
import { persistForecastDecisionBundle } from "@/lib/trader/intelligence/forecast-decision/atomic-forecast-decision-bundle-repository-postgres";
import { buildWp13Bundle } from "./wp13-intelligence-test-helpers";
import {
  buildWp14Bundle,
  buildWp14PersistenceAuthorization,
} from "./wp14-forecast-decision-test-helpers";
import { CONTROL_REPLAY_AUTHORITY_IDENTITY } from "@/lib/trader/observability/control-replay-test-authority";
const url = process.env.DATABASE_URL_POSTGRES,
  enabled = process.env.WAIA_PG_INTEGRATION === "1" && !!url;
describe.skipIf(!enabled)("scoped entity evidence on Postgres", () => {
  let client: postgres.Sql, db: AdminPostgresDb;
  const admin = randomUUID(),
    org = personalOrganizationIdFromUserId(admin),
    account = randomUUID(),
    credential = randomUUID(),
    order = randomUUID(),
    fill = randomUUID();
  const deps = (): AdminRouteHandlerDeps => ({
    getUserId: async () => admin,
    getRuntimeDb: async () => ({ kind: "postgres", db, _sql: client }),
    disposeRuntimeDb: async () => undefined,
  });
  const request = (query = "") =>
    new Request(
      `http://localhost/api/trader/admin/console/entity?organization_id=${org}&exchange_account_id=${account}&mode=live&${query}`,
    );
  beforeAll(async () => {
    if (!["localhost", "127.0.0.1", "::1"].includes(new URL(url!).hostname))
      throw new Error("TEST_REQUIRES_LOCAL_DISPOSABLE_POSTGRES");
    client = postgres(url!, { max: 3, prepare: false });
    db = drizzle(client, { schema });
    await client`INSERT INTO auth.users(id) VALUES (${admin}::uuid)`;
    await client`INSERT INTO users(id,identity_label,email) VALUES (${admin}::uuid,'Entity fixture',${`${admin}@waia.invalid`})`;
    await ensureUserCoreSeedPostgres(db, { userId: admin, displayName: "Entity fixture" });
    await client`UPDATE user_platform_roles SET role='admin' WHERE user_id=${admin}::uuid`;
    await client`INSERT INTO exchange_credentials(id,organization_id,venue,exchange_account_id,encrypted_payload) VALUES (${credential}::uuid,${org}::uuid,'htx',${account},'SECRET_MUST_NOT_APPEAR')`;
    const binding = {
      organizationId: org,
      credentialId: credential,
      exchangeAccountId: account,
      credentialRevision: "1",
      configurationRevision: "test",
    };
    const obs = consoleObservation(binding, "123.456", Date.now());
    await client`INSERT INTO trader_account_collection_state(organization_id,credential_id,exchange_account_id,configuration_revision,symbols) VALUES (${org}::uuid,${credential}::uuid,${account},'test','["BTCUSDT"]')`;
    await client`INSERT INTO trader_account_observations(organization_id,credential_id,exchange_account_id,observation_id,credential_revision,configuration_revision,lease_token,payload,recorded_at) VALUES (${org}::uuid,${credential}::uuid,${account},${obs.observationId}::uuid,1,'test',${randomUUID()}::uuid,${JSON.stringify(obs)}::jsonb,now())`;
    await client`UPDATE trader_account_collection_state SET last_observation_id=${obs.observationId}::uuid WHERE credential_id=${credential}::uuid`;
    await client`INSERT INTO trader_orders(id,organization_id,credential_id,venue,execution_mode,symbol,side,type,price,quantity,filled_quantity,state,client_order_id,idempotency_key,risk_decision_id) VALUES (${order}::uuid,${org}::uuid,${credential}::uuid,'htx','live','BTCUSDT','buy','limit','100','1','0.5','PARTIALLY_FILLED',${order},${order},'legacy')`;
    await client`INSERT INTO trader_fills(id,organization_id,order_id,exchange_trade_id,price,quantity,fee,fee_asset,executed_at) VALUES (${fill}::uuid,${org}::uuid,${order}::uuid,${fill},'100','0.5','0.01','USDT',now())`;
    await client`INSERT INTO trader_order_events(id,organization_id,order_id,seq,to_state,event_type,payload,occurred_at) VALUES (${randomUUID()}::uuid,${org}::uuid,${order}::uuid,1,'PARTIALLY_FILLED','PARTIAL_FILL','SECRET_RAW_PAYLOAD',now())`;
  });
  afterAll(async () => {
    await client?.end();
  });
  it("reads legacy events and fills without manufacturing V2 stages or leaking raw payloads", async () => {
    const result = await handleAdminConsoleOrderDetailGet(request(), deps(), order);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      schemaVersion: "admin-console/v1",
      cursor: expect.any(String),
      scope: { kind: "account", organizationId: org, exchangeAccountId: account },
      data: {
        order: { id: order, label: "Частично исполнен", filledQuantity: "0.5" },
        trace: {
          allowedActions: [],
          steps: [{ state: "not_applicable", reason: "LEGACY_ORDER_NO_V2_BINDING" }],
        },
        fills: [{ id: fill, fee: "0.01", fee_asset: "USDT" }],
        events: [{ type: "PARTIAL_FILL" }],
      },
    });
    expect(JSON.stringify(result.body)).not.toContain("SECRET_");
    const wrongAccount = new Request(
      `http://localhost/entity?organization_id=${org}&exchange_account_id=other&mode=live`,
    );
    expect((await handleAdminConsoleOrderDetailGet(wrongAccount, deps(), order)).status).toBe(404);
    expect(
      (
        await handleAdminConsoleOrderDetailGet(
          new Request(`http://localhost/entity?organization_id=${org}&mode=paper`),
          deps(),
          order,
        )
      ).status,
    ).toBe(404);
    expect((await handleAdminConsoleOrderDetailGet(request(), deps(), "bad")).status).toBe(400);
  });
  it("restores a real test-only V2 attempt/plan/allowance/verdict/report chain and proves missing decisions", async () => {
    const runId = randomUUID();
    const intelligence = buildWp13Bundle(org, runId, "0");
    const bundle = buildWp14Bundle(org, runId, "0");
    const at = new Date();
    const forecast = {
      id: randomUUID(),
      organizationId: org,
      cycleEnvelopeId: intelligence.envelope.id,
      hypothesisRecordId: intelligence.hypotheses[0]!.id,
      convictionRecordId: intelligence.conviction.id,
      runId,
      cycleId: "0",
      symbol: "BTC/USDT",
      forecastKeyDigest: "a".repeat(64),
      evaluatedAt: at,
      issuedAt: at,
      evidenceCutoffAt: at,
      targetWindowStartAt: at,
      targetWindowEndAt: new Date(at.getTime() + 60000),
      marketQuestion: "Synthetic evidence question",
      invalidationConditionsJson: "[]",
      scenarioSetJson: "[]",
      forecastConfidenceJson: "{}",
      historicalProfileId: "test",
      historicalProfileDigest: "c".repeat(64),
      matrixDigest: "c".repeat(64),
      evidenceDigest: "c".repeat(64),
      authoritativeLinkDigest: "c".repeat(64),
      forecastModelVersion: "test",
      contentDigest: "c".repeat(64),
      schemaVersion: "waia.trader.intelligence_forecast_record.v1",
    };
    const decisionId = bundle.decision.id,
      forecastId = forecast.id;
    const proof = await postgresTestOnlyExecutionV2Authority({
      authority: CONTROL_REPLAY_AUTHORITY_IDENTITY,
      organizationId: org,
      accountId: "console-detail-test",
      symbol: "BTCUSDT",
      baseAsset: "BTC",
      qualifiedQuantity: "0.01",
      referencePrice: "100",
      decision: {
        decisionId,
        semanticDigestHex: "a".repeat(64),
        contentDigestHex: bundle.decision.contentDigest,
        forecastId,
        forecastContentDigestHex: forecast.contentDigest,
        canonicalCausalLineageDigestHex: "d".repeat(64),
        executionPolicyDigestHex: "e".repeat(64),
        economicSizeSetId: "console-test",
        economicSizeSetDigestHex: "f".repeat(64),
      },
    });
    const result = await handleAdminConsoleOrderDetailGet(
      new Request(`http://localhost/entity?organization_id=${org}&mode=all`),
      deps(),
      proof.orderId,
    );
    expect(result.status).toBe(200);
    const data = (
      result.body as {
        data: {
          trace: { steps: { step: string; state: string; reason: string | null }[] };
          reports: unknown[];
          order: { mode: string };
          evidence: unknown;
        };
      }
    ).data;
    expect(data.order.mode).toBe("undetermined");
    for (const step of [
      "execution_attempt",
      "execution_plan",
      "risk_allowance",
      "risk_verdict",
      "exchange_reports",
    ])
      expect(data.trace.steps.find((s) => s.step === step)?.state, step).toBe("ok");
    expect(data.trace.steps.find((s) => s.step === "decision")).toMatchObject({
      state: "unavailable",
      reason: "DECISION_MISSING",
    });
    expect(data.reports.length).toBeGreaterThan(0);
    expect(JSON.stringify(result.body)).not.toMatch(
      /exact_request_payload|raw_observation|holdout/,
    );
    await persistIntelligenceCycleBundle({ organizationId: org }, intelligence, db);
    await persistForecastDecisionBundle(
      { organizationId: org },
      bundle,
      db,
      buildWp14PersistenceAuthorization(org, bundle),
    );
    await db.insert(schema.traderIntelligenceForecastRecord).values(forecast);
    const complete = await handleAdminConsoleOrderDetailGet(
      new Request(`http://localhost/entity?organization_id=${org}&mode=all`),
      deps(),
      proof.orderId,
    );
    expect(complete.body).toMatchObject({
      data: {
        evidence: {
          decision_record_id: decisionId,
          forecast_record_id: forecastId,
          market_question: forecast.marketQuestion,
        },
        trace: {
          steps: expect.arrayContaining([
            expect.objectContaining({ step: "decision", state: "ok" }),
            expect.objectContaining({ step: "forecast", state: "ok" }),
          ]),
        },
      },
    });
  });
  it("keeps asset amounts and five facets distinct and never grants authority from absent Risk", async () => {
    const result = await handleAdminConsoleAccountDetailGet(request(), deps(), `htx:${account}`);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      financeRevision: expect.any(String),
      cursor: expect.any(String),
      data: {
        finance: {
          equity: "123.456",
          portfolio: "live",
          assets: [{ asset: "USDT", free: "123.456", locked: "0", value: "123.456" }],
        },
        identity: {
          portfolio: "live",
          activity: "live",
          deployment: "undetermined",
          tradePermission: "undetermined",
        },
        facets: expect.arrayContaining([
          {
            id: "reconciliation",
            label: "Сверка",
            value: null,
            reason: "RISK_ACCOUNT_BINDING_NOT_PERSISTED",
          },
        ]),
      },
    });
    expect(JSON.stringify(result.body)).not.toContain("SECRET_");
    expect((await handleAdminConsoleAccountDetailGet(request(), deps(), "htx:other")).status).toBe(
      404,
    );
    const wrongOrg = new Request(
      `http://localhost/entity?organization_id=${randomUUID()}&mode=live`,
    );
    expect(
      (await handleAdminConsoleAccountDetailGet(wrongOrg, deps(), `htx:${account}`)).status,
    ).toBe(404);
  });
  it("retains revoked credential history and rejects a foreign client id", async () => {
    const revoked = randomUUID();
    await client`INSERT INTO exchange_credentials(id,organization_id,venue,exchange_account_id,status,revoked_at,encrypted_payload) VALUES (${revoked}::uuid,${org}::uuid,'htx',${account},'revoked',now(),'SECRET_REVOKED')`;
    const result = await handleAdminConsoleClientHistoryGet(request(), deps(), org);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      data: {
        items: expect.arrayContaining([
          expect.objectContaining({ type: "CREDENTIAL_REVOKED", exchangeAccountId: account }),
        ]),
      },
    });
    expect(JSON.stringify(result.body)).not.toContain("SECRET_");
    expect((await handleAdminConsoleClientHistoryGet(request(), deps(), randomUUID())).status).toBe(
      404,
    );
  });
});
