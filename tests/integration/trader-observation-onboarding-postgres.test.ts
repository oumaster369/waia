import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as schema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { HtxExchangeConnector } from "@/lib/trader/connectors/htx/htx-exchange-connector";
import {
  handleHtxConnectPost,
  type ConnectHandlerDeps,
} from "@/lib/trader/credentials/connect-handler";
import { createPostgresCredentialService } from "@/lib/trader/credentials/credential-service";
import { SecretsStoreMasterKeyProvider } from "@/lib/trader/security/secrets-store-master-key-provider";
import { createObservationCredentialReader } from "@/lib/trader/account-observation/credential-read-boundary";
import { createPostgresObservationAssignmentSource } from "@/lib/trader/account-observation/postgres-assignments";
import {
  ACCOUNT_OBSERVATION_SELF_SERVICE_READER_LIMITS,
  createAccountObservationSelfServiceConfiguration,
} from "@/lib/trader/account-observation/self-service-envelope";
import { createHtxReadAdmission } from "@/lib/trader/account-observation/htx-read-admission";
import { accountObservationClock } from "@/lib/trader/account-observation/clock";
import { createConfiguredHtxObservationRuntime } from "@/lib/trader/account-observation/configured-runtime";
import { createPostgresObservationReader } from "@/lib/trader/account-observation/postgres-reader";
import { handleAccountObservationGet } from "@/lib/trader/account-observation/read-handler";
import { createAssertLivePathAuthorized } from "@/lib/trader/live/assert-live-path-authorized";

// Only an explicit opt-in may connect. The endpoint is a dedicated loopback PostgreSQL 17
// fixture; never read DATABASE_URL or any production/developer environment fallback.
const enabled = process.env.DEE1235_LOCAL_PG17 === "1";
const url = "postgres://waia_local_admin:local_validation_only@127.0.0.1:55731/waia_dee1235_local";
const accountId = "73737331";
const apiKey = "dee1235_synthetic_read_trade_key";
const apiSecret = "dee1235_synthetic_api_secret_only";
const masterKey = Buffer.alloc(32, 71).toString("base64");

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe.skipIf(!enabled)("DEE-1235 synthetic HTX observation onboarding on PostgreSQL 17", () => {
  let sql: postgres.Sql;
  let db: WaiaPostgresDb;
  let credentialSql: postgres.Sql;
  let userId: string;
  let organizationId: string;
  let credentialId: string;
  let calls: string[];
  let provider: SecretsStoreMasterKeyProvider;
  let service: ReturnType<typeof createPostgresCredentialService>;
  let disposeAdmission: (() => void) | undefined;
  let inventoryFixtureInstalled = false;

  const fetchSynthetic: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (method !== "GET") throw new Error("SYNTHETIC_FIXTURE_REFUSED_NON_GET");
    calls.push(`${method} ${url.pathname}`);
    if (url.pathname === "/v1/account/accounts") {
      return response({
        status: "ok",
        data: [{ id: Number(accountId), type: "spot", state: "working" }],
      });
    }
    if (url.pathname === "/v2/user/uid") return response({ code: 200, data: 63628520 });
    if (url.pathname === "/v2/user/api-key") {
      if (url.searchParams.get("accessKey") !== apiKey)
        throw new Error("SYNTHETIC_FIXTURE_KEY_MISMATCH");
      return response({
        code: 200,
        data: [{ accessKey: apiKey, status: "normal", permission: "readOnly,trade" }],
      });
    }
    if (url.pathname === `/v1/account/accounts/${accountId}/balance`) {
      return response({
        status: "ok",
        data: {
          id: Number(accountId),
          type: "spot",
          state: "working",
          list: [
            { currency: "usdt", type: "trade", balance: "10001" },
            { currency: "usdt", type: "frozen", balance: "0" },
          ],
        },
      });
    }
    if (url.pathname === "/v1/order/openOrders" || url.pathname === "/v1/order/matchresults") {
      return response({ status: "ok", data: [] });
    }
    throw new Error(`SYNTHETIC_FIXTURE_UNEXPECTED_PATH:${url.pathname}`);
  };

  beforeAll(async () => {
    sql = postgres(url, { max: 8, prepare: false, connect_timeout: 5, onnotice: () => {} });
    const [server] = await sql<{ server_version_num: string }[]>`SHOW server_version_num`;
    const version = Number(server?.server_version_num);
    expect(version).toBeGreaterThanOrEqual(170000);
    expect(version).toBeLessThan(180000);
    const journal = JSON.parse(
      readFileSync("db/migrations_postgres/meta/_journal.json", "utf8"),
    ) as {
      entries: Array<{ tag: string }>;
    };
    const latestTag = journal.entries.at(-1)?.tag;
    expect(journal.entries).toHaveLength(232);
    expect(latestTag).toBe("0231_trader_observation_purpose_projection_v1");
    const expectedLatestHash = createHash("sha256")
      .update(readFileSync(join("db/migrations_postgres", `${latestTag}.sql`)))
      .digest("hex");
    const [migrationHead] = await sql<{ n: number; hash: string }[]>`
      SELECT count(*)::int AS n,
        (SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at DESC, id DESC LIMIT 1) AS hash
      FROM drizzle.__drizzle_migrations`;
    expect(migrationHead).toMatchObject({ n: 232, hash: expectedLatestHash });

    db = drizzle(sql, { schema }) as WaiaPostgresDb;
    userId = randomUUID();
    organizationId = personalOrganizationIdFromUserId(userId);
    await sql`INSERT INTO auth.users (id) VALUES (${userId})`;
    await db.insert(schema.users).values({
      id: userId,
      email: `${userId}@waia.invalid`,
      identityLabel: "Synthetic onboarding acceptance",
    });
    await ensureUserCoreSeedPostgres(db, {
      userId,
      displayName: "Synthetic onboarding acceptance",
    });
    await db
      .insert(schema.organizationSubscriptions)
      .values({ id: randomUUID(), organizationId, module: "trader", status: "active" });
    await db.insert(schema.organizationEntitlements).values({
      id: randomUUID(),
      organizationId,
      entitlementKey: "trader",
      enabled: true,
      sourceModule: "trader",
    });

    provider = await SecretsStoreMasterKeyProvider.create({
      secretGetter: async () => masterKey,
      productionReady: true,
    });
    service = createPostgresCredentialService(db, { createProvider: async () => provider });
    credentialSql = postgres(url, {
      max: 2,
      prepare: false,
      connect_timeout: 5,
      onnotice: () => {},
    });
    calls = [];
  }, 30000);

  afterAll(async () => {
    disposeAdmission?.();
    if (inventoryFixtureInstalled && sql) {
      await sql
        .unsafe(
          `DROP POLICY IF EXISTS trader_observer_credential_inventory ON public.exchange_credentials;
        DROP POLICY IF EXISTS trader_observer_state_inventory ON public.trader_account_collection_state;`,
        )
        .simple()
        .catch(() => {});
    }
    await credentialSql?.end({ timeout: 3 }).catch(() => {});
    await sql?.end({ timeout: 3 }).catch(() => {});
  });

  it("connects a synthetic Read+Trade key, enrolls it, inventories it, decrypts by role, and admits fresh same-key GETs", async () => {
    const deps: ConnectHandlerDeps = {
      getUserId: async () => userId,
      // This is an injected test gate, not a browser session or real partner entitlement flow.
      hasTraderAccess: async (id) => id === userId,
      getRuntimeDb: async () => ({ kind: "postgres", db }),
      disposeRuntimeDb: async () => undefined,
      createProvider: async () => provider,
      createConnector: (config) =>
        new HtxExchangeConnector({ ...config, fetchImpl: fetchSynthetic }),
      createCredentialService: (runtime) =>
        createPostgresCredentialService(runtime.db as WaiaPostgresDb, {
          createProvider: async () => provider,
        }),
    };

    const connected = await handleHtxConnectPost(
      new Request("https://waia.invalid/api/trader/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          venue: "htx",
          apiKey,
          apiSecret,
          accountLabel: "synthetic-acceptance",
        }),
      }),
      deps,
    );
    expect(connected.status, JSON.stringify(connected.body)).toBe(200);
    expect(connected.waiaDbBackend).toBe("postgres");
    const dto = connected.body as {
      id: string;
      exchangeAccountId: string;
      status: string;
      permissionMetadata: Record<string, unknown>;
    };
    credentialId = dto.id;
    expect(dto).toMatchObject({
      exchangeAccountId: accountId,
      status: "active",
      permissionMetadata: { version: 2, purpose: "observation", scopes: ["read", "trade"] },
    });
    expect(calls).toEqual(["GET /v1/account/accounts", "GET /v2/user/uid", "GET /v2/user/api-key"]);

    const [stored] = await sql<
      {
        permission_metadata: string;
        observation_read_permitted: boolean;
        observation_revision: string;
      }[]
    >`
      SELECT permission_metadata, observation_read_permitted, observation_revision::text
      FROM public.exchange_credentials WHERE id=${credentialId} AND organization_id=${organizationId}`;
    expect(JSON.parse(stored!.permission_metadata)).toMatchObject({
      version: 2,
      purpose: "observation",
      scopes: ["read", "trade"],
    });
    expect(stored!.observation_read_permitted).toBe(true);
    expect(stored!.observation_revision).toMatch(/^\d+$/);
    const [enrolled] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM public.trader_account_collection_state
      WHERE organization_id=${organizationId} AND credential_id=${credentialId} AND exchange_account_id=${accountId}`;
    expect(enrolled?.n).toBe(1);

    // Canonical 0231/0230 schemas do not include the two already-observed deployed
    // inventory policies. Preserve that distinction: first prove the canonical
    // baseline is row-empty under the real observer role, then add only a local
    // test-fixture mirror of the production catalog (never a migration or prod write).
    const canonicalInventory = await sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL ROLE waia_account_observer");
      return tx<{ n: number }[]>`SELECT count(*)::int AS n FROM public.exchange_credentials c
        JOIN public.trader_account_collection_state s ON s.organization_id=c.organization_id
          AND s.credential_id=c.id AND s.exchange_account_id=c.exchange_account_id
        WHERE c.venue='htx' AND c.status='active'`;
    });
    expect(canonicalInventory[0]?.n).toBe(0);
    const policiesBefore = await sql<
      { relation: string; name: string; command: string; expression: string | null }[]
    >`
      SELECT c.relname AS relation, p.polname AS name, p.polcmd::text AS command,
        pg_get_expr(p.polqual, p.polrelid) AS expression
      FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
      WHERE c.oid IN ('public.exchange_credentials'::regclass,
        'public.trader_account_collection_state'::regclass)
      ORDER BY relation, name`;
    await sql
      .unsafe(
        `CREATE POLICY trader_observer_credential_inventory
      ON public.exchange_credentials FOR SELECT TO waia_account_observer
      USING (venue = 'htx'::text AND status = 'active'::exchange_credential_status);
      CREATE POLICY trader_observer_state_inventory
      ON public.trader_account_collection_state FOR SELECT TO waia_account_observer
      USING (true);`,
      )
      .simple();
    inventoryFixtureInstalled = true;
    const policiesAfter = await sql<
      { relation: string; name: string; command: string; expression: string | null }[]
    >`
      SELECT c.relname AS relation, p.polname AS name, p.polcmd::text AS command,
        pg_get_expr(p.polqual, p.polrelid) AS expression
      FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
      WHERE c.oid IN ('public.exchange_credentials'::regclass,
        'public.trader_account_collection_state'::regclass)
      ORDER BY relation, name`;
    expect(
      policiesAfter.filter(
        (policy) =>
          !policiesBefore.some(
            (before) => before.relation === policy.relation && before.name === policy.name,
          ),
      ),
    ).toEqual([
      {
        relation: "exchange_credentials",
        name: "trader_observer_credential_inventory",
        command: "r",
        expression: "((venue = 'htx'::text) AND (status = 'active'::exchange_credential_status))",
      },
      {
        relation: "trader_account_collection_state",
        name: "trader_observer_state_inventory",
        command: "r",
        expression: "true",
      },
    ]);
    expect(
      policiesAfter.filter((policy) =>
        policiesBefore.some(
          (before) => before.relation === policy.relation && before.name === policy.name,
        ),
      ),
    ).toEqual(policiesBefore);

    const configuration = createAccountObservationSelfServiceConfiguration();
    const dummyBinding = {
      organizationId,
      credentialId: randomUUID(),
      exchangeAccountId: "99999999",
      credentialRevision: "1",
      configurationRevision: configuration.revision,
    };
    const assignments = createPostgresObservationAssignmentSource(
      sql,
      [{ binding: dummyBinding, config: configuration }],
      sql,
    );
    const discovered = await assignments.loadAssignments(new AbortController().signal);
    expect(discovered.length).toBeGreaterThan(0);
    expect(discovered.length).toBeLessThanOrEqual(20);
    const matching = discovered.filter(
      (assignment) =>
        assignment.binding.organizationId === organizationId &&
        assignment.binding.credentialId === credentialId &&
        assignment.binding.exchangeAccountId === accountId,
    );
    expect(matching).toHaveLength(1);
    const binding = matching[0]!.binding;
    expect(binding).toMatchObject({
      organizationId,
      credentialId,
      exchangeAccountId: accountId,
      credentialRevision: stored!.observation_revision,
      configurationRevision: configuration.revision,
    });
    expect(await assignments.authorizeOpen(binding, new AbortController().signal)).toBe(true);

    const reader = createObservationCredentialReader({
      sql: credentialSql,
      provider,
      assignments: [{ organizationId, credentialId, exchangeAccountId: accountId }],
    });
    const plaintext = await reader.getDecryptedCredentials(
      { organizationId, exchangeAccountId: accountId },
      credentialId,
    );
    expect(plaintext).toEqual({ apiKey, apiSecret });
    await expect(
      reader.getDecryptedCredentials({ organizationId: randomUUID() }, credentialId),
    ).rejects.toThrow("ACCOUNT_OBSERVATION_CREDENTIAL_REFUSED:NOT_ASSIGNED");

    calls = [];
    const digest = createHash("sha256").update(apiKey).digest("hex");
    let heldKey = plaintext.apiKey;
    let heldSecret = plaintext.apiSecret;
    const credentialHandle = {
      binding,
      get apiKey() {
        return heldKey;
      },
      get apiSecret() {
        return heldSecret;
      },
      dispose() {
        heldKey = "";
        heldSecret = "";
      },
    };
    const admission = createHtxReadAdmission({
      credential: credentialHandle,
      host: "api.huobi.pro",
      clock: accountObservationClock,
      fetchImpl: fetchSynthetic,
      timeoutMs: 5000,
      maxResponseBytes: 32768,
      authorizeCurrent: (candidate, signal) => assignments.authorizeOpen(candidate, signal),
    });
    disposeAdmission = () => admission.dispose();
    await expect(
      admission.verifyReadAdmission(binding, digest, new AbortController().signal),
    ).resolves.toBe(true);
    credentialHandle.dispose();
    expect([credentialHandle.apiKey, credentialHandle.apiSecret]).toEqual(["", ""]);
    admission.dispose();
    expect(calls).toEqual(["GET /v1/account/accounts", "GET /v2/user/uid", "GET /v2/user/api-key"]);

    const collectorRuntimeSql = postgres(url, {
      max: 2,
      prepare: false,
      connect_timeout: 5,
      onnotice: () => {},
    });
    const observationRuntimeSql = postgres(url, {
      max: 2,
      prepare: false,
      connect_timeout: 5,
      onnotice: () => {},
    });
    const runtimeAbort = new AbortController();
    let resolveCommitted!: () => void;
    let rejectCommitted!: (error: Error) => void;
    const committed = new Promise<void>((resolve, reject) => {
      resolveCommitted = resolve;
      rejectCommitted = reject;
    });
    const observationRuntime = createConfiguredHtxObservationRuntime({
      collectorSql: collectorRuntimeSql,
      readerSql: observationRuntimeSql,
      protectedCredentialService: reader,
      configured: [
        {
          binding,
          config: configuration,
          readerLimits: ACCOUNT_OBSERVATION_SELF_SERVICE_READER_LIMITS,
        },
      ],
      host: "api.huobi.pro",
      fetchImpl: fetchSynthetic,
      clock: accountObservationClock,
      report(event) {
        if (event === "COLLECTION_COMMITTED") resolveCommitted();
        if (event === "COLLECTION_FAILED" || event === "ASSIGNMENTS_FAILED")
          rejectCommitted(new Error(`SYNTHETIC_OBSERVATION_RUNTIME:${event}`));
      },
      ownerId: "dee1235-synthetic-acceptance",
      intervalMs: 1000,
      iterationTimeoutMs: 300000,
    });
    const runObservation = observationRuntime.run(runtimeAbort.signal);
    const runtimeTimeout = setTimeout(
      () => rejectCommitted(new Error("SYNTHETIC_OBSERVATION_RUNTIME:TIMEOUT")),
      15000,
    );
    try {
      await committed;
    } finally {
      clearTimeout(runtimeTimeout);
      runtimeAbort.abort();
      observationRuntime.dispose();
      await runObservation;
      await collectorRuntimeSql.end({ timeout: 3 });
      await observationRuntimeSql.end({ timeout: 3 });
    }
    expect(calls).toContain(`GET /v1/account/accounts/${accountId}/balance`);
    expect(calls).toContain("GET /v1/order/openOrders");
    expect(calls).toContain("GET /v1/order/matchresults");
    const [persisted] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM public.trader_account_observations
      WHERE organization_id=${organizationId} AND credential_id=${credentialId} AND exchange_account_id=${accountId}`;
    expect(persisted?.n).toBeGreaterThan(0);

    const observationReader = createPostgresObservationReader(credentialSql);
    const query = new URLSearchParams({
      organizationId,
      credentialId,
      exchangeAccountId: accountId,
      credentialRevision: binding.credentialRevision,
      configurationRevision: binding.configurationRevision,
    });
    const observationResponse = await handleAccountObservationGet(
      new Request(`https://waia.invalid/api/trader/account-observation?${query}`),
      "tenant",
      {
        getUserId: async () => userId,
        async hasTraderAccess(candidate, targetOrganization) {
          const rows = await sql<
            { enabled: boolean }[]
          >`SELECT enabled FROM public.organization_entitlements
            WHERE organization_id=${targetOrganization} AND entitlement_key='trader'`;
          return candidate === userId && rows.some((row) => row.enabled);
        },
        async hasOrgMembership(candidate, targetOrganization) {
          const rows =
            await sql`SELECT 1 FROM public.organization_members WHERE user_id=${candidate} AND organization_id=${targetOrganization}`;
          return rows.length === 1;
        },
        hasOperatorAccess: async () => false,
        isAdminListedOrganization: async () => false,
        resolveActiveBinding: (scope) => observationReader.resolveActiveBinding(scope),
        readLatest: (currentBinding) => observationReader.readLatest(currentBinding),
      },
    );
    expect(observationResponse.status).toBe(200);
    const observed = (await observationResponse.json()) as {
      binding: typeof binding;
      balances: { values: Array<{ asset: string; free: string; locked: string; total: string }> };
    };
    expect(observed.binding).toEqual(binding);
    expect(observed.balances.values).toContainEqual({
      asset: "USDT",
      free: "10001",
      locked: "0",
      total: "10001",
    });
    expect(JSON.stringify(observed)).not.toContain(apiSecret);

    const [liveEnableRowsAfterOnboarding] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM public.trader_org_live_enable WHERE organization_id=${organizationId}`;
    expect(liveEnableRowsAfterOnboarding?.n).toBe(0);
    const context = { organizationId, userId };
    let decryptCalls = 0;
    const credentialService = {
      ...service,
      getDecryptedCredentials: async (
        ...args: Parameters<typeof service.getDecryptedCredentials>
      ) => {
        decryptCalls += 1;
        return service.getDecryptedCredentials(...args);
      },
    };
    const authorize = createAssertLivePathAuthorized({
      env: { WAIA_TRADER_ORG0_ORGANIZATION_ID: organizationId },
      orgLiveEnableService: {
        getState: async () => ({ organizationId, state: "ENABLED", maxNotionalCap: "1000" }),
      } as never,
      promotionService: { getEffectivePromotion: async () => ({ strategyVersion: "1" }) } as never,
      killSwitchResolver: {
        getEffectiveState: async () => ({ organizationId, blocked: false, resolutionStatus: "ok" }),
      } as never,
      riskLimitsService: {} as never,
      credentialService,
      probeHostHealth: async () => true,
    });
    await expect(
      authorize(context, {
        strategyId: "synthetic-strategy",
        strategyVersion: "1",
        submitInput: {
          clientOrderId: "synthetic-no-order",
          idempotencyKey: "synthetic-no-order",
          executionMode: "live",
          symbol: "BTC/USDT",
          side: "buy",
          type: "market",
          quantity: "1",
          referencePrice: "1",
          accountKey: accountId,
          credentialId,
        },
      }),
    ).rejects.toThrow();
    expect(decryptCalls).toBe(0);
    const [liveEnableRows] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM public.trader_org_live_enable WHERE organization_id=${organizationId}`;
    expect(liveEnableRows?.n).toBe(0);
  }, 30000);
});
