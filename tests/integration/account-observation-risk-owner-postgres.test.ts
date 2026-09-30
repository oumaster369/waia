// DEE-1135 observation-only PG17 composition. No active profile, basis, allowance or order.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres, { type Sql } from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema.postgres";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";
import { accountObservationClock } from "@/lib/trader/account-observation/clock";
import { createObservationConfiguration, type ObservationAssignment } from "@/lib/trader/account-observation/runtime";
import { observationPoolLimits, probeObservationPool, probeObservationCredentialPool } from "@/lib/trader/account-observation/host-role-probe";
import { encryptCredentialPayload } from "@/lib/trader/credentials/envelope-crypto";
import { SecretsStoreMasterKeyProvider } from "@/lib/trader/security/secrets-store-master-key-provider";
import type { MasterKeyProvider } from "@/lib/trader/security/master-key-provider";
import { createEncryptedReferenceRawStoreV1 } from "@/lib/trader/mi/htx-reference-quote-collector-v1";
import { createHtxAccountAcquisitionJobV1, readHtxAccountAcquisitionV1Postgres,
  type HtxAccountAcquisitionJobV1 } from "@/lib/trader/reality/v2/htx-account-acquisition-postgres";
import { decodeHtxAccountAcquisitionPageV1, htxAccountAcquisitionLanesV1, htxAccountAcquisitionRequestV1,
  type HtxAccountAcquisitionSpecV1 } from "@/lib/trader/reality/v2/htx-account-acquisition-v1";
import { acquireConfiguredHtxAccountV1Postgres, createProtectedHtxAccountAcquisitionSessionV1 } from "@/lib/trader/risk/v2/current-account-capital-service-v1";
import { createRiskAccountProfileV1, createRiskAccountReferenceV1, riskAccountDigestV1,
  sealRiskAccountRecordV1, RISK_ACCOUNT_CHANNELS_V1, RISK_REFERENCE_METHOD_V1,
  type RiskReferenceMemberV1 } from "@/lib/trader/risk/v2/risk-account-source-profile-v1";
import { ACCOUNT_OBSERVATION_LOGIN_PLAN, provisionAccountObservationLoginsV1 } from "@/scripts/ops/provision-account-observation-logins.mjs";

const enabled = process.env.DEE960_LOCAL_PG17 === "1";
const url = "postgres://waia_local_admin:local_validation_only@127.0.0.1:55460/waia_dee960_local";
// These are the existing synthetic CI passwords, never production credentials or environment URLs.
const passwords = Object.freeze({ collector: "dee1015_synthetic_collector_password_0001",
  reader: "dee1015_synthetic_reader_password_00000002", credential: "dee1015_synthetic_credential_password_0003" });
const receipt = (stage: string, body: unknown) => console.log(JSON.stringify({ kind: "DEE1135_PG17_OWNER_RECEIPT", stage, body }));
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
function gate() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
function errorShape(value: unknown, depth = 0): unknown {
  if (depth > 5 || !value || typeof value !== "object") return String(value);
  const error = value as { name?: string; message?: string; code?: string; cause?: unknown };
  return { name: error.name, message: error.message, code: error.code,
    ...(error.cause ? { cause: errorShape(error.cause, depth + 1) } : {}) };
}
function watch<T>(promise: Promise<T>) {
  let settled = false;
  const outcome = promise.then(value => { settled = true; return { status: "fulfilled" as const, value }; },
    reason => { settled = true; return { status: "rejected" as const, reason }; });
  return { outcome, settled: () => settled };
}
async function entered<T>(barrier: ReturnType<typeof gate>, work: ReturnType<typeof watch<T>>) {
  let timer!: ReturnType<typeof setTimeout>;
  try {
    const winner = await Promise.race([
      barrier.promise.then(() => ({ kind: "BARRIER" as const })),
      work.outcome.then(result => ({ kind: "OWNER" as const, result })),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("CONTROLLED_BARRIER_NOT_REACHED")), 5000); }),
    ]);
    if (winner.kind === "OWNER") {
      const result = winner.result;
      receipt("failed-before-barrier", result.status === "rejected" ? errorShape(result.reason) : { status: result.status });
      throw new Error("OWNER_SETTLED_BEFORE_CONTROLLED_BARRIER");
    }
  } finally { clearTimeout(timer); }
}
function rejected<T>(stage: string, result: Awaited<ReturnType<typeof watch<T>>["outcome"]>) {
  receipt(stage, result.status === "rejected" ? { status: result.status, cause: errorShape(result.reason) } : { status: result.status });
  expect(result.status).toBe("rejected");
  if (result.status !== "rejected") throw new Error("EXPECTED_OWNER_REFUSAL");
  return result.reason as unknown;
}

type Client = { sql: Sql; name: string; pid: number; closed: boolean; statements: string[] };
const clients: Client[] = [], directories: string[] = [], masters: Buffer[] = [];
let owner: Client, controller: Client, database: string, adminUrl: string;
let organizationId: string, sourceId: string, actorId: string, auditId: string;
let accountSequence = 113500;
async function connect(address: string, name: string, restricted = false, observe?: (statement: string) => void): Promise<Client> {
  const statements: string[] = [];
  const sql = postgres(address, { ...(restricted ? observationPoolLimits : { max: 1, connect_timeout: 3,
    max_lifetime: 300, prepare: false as const }), onnotice: () => {},
    connection: { application_name: `dee1135-pg17-${name}`, ...(restricted ? {} : { statement_timeout: 30000, lock_timeout: 5000 }) },
    debug: (_connection, statement) => { statements.push(statement); observe?.(statement); } });
  const client = { sql, name, pid: 0, closed: false, statements }; clients.push(client);
  const row = (await sql`SELECT pg_backend_pid() AS pid, current_database() AS database,
    session_user::text AS login, current_user::text AS role, current_setting('server_version_num') AS version,
    current_setting('session_replication_role') AS replication_role`)[0]!;
  client.pid = Number(row.pid);
  expect(Number(row.version)).toBeGreaterThanOrEqual(170000); expect(Number(row.version)).toBeLessThan(180000);
  expect(row.replication_role).toBe("origin"); expect(row.role).toBe(row.login);
  receipt("client-open", { ...row, name }); return client;
}
async function close(client: Client) { if (!client.closed) { await client.sql.end({ timeout: 5 }); client.closed = true; } }
function runtimeUrl(purpose: keyof typeof passwords) {
  const target = new URL(adminUrl), entry = ACCOUNT_OBSERVATION_LOGIN_PLAN.find(item => item.purpose === purpose)!;
  target.username = entry.loginRole; target.password = passwords[purpose]; return target.toString();
}
function db() { return drizzle(owner.sql, { schema }); }
async function runtimeRows() {
  await controller.sql`SELECT pg_stat_clear_snapshot()`;
  return controller.sql`SELECT pid, usename, application_name, state, wait_event_type, wait_event
    FROM pg_stat_activity WHERE datname=${database} AND usename IN
    ('waia_account_observation_reader_login','waia_account_observation_credential_login') ORDER BY pid`;
}
async function closedRuntime(stage: string) {
  const rows = await runtimeRows(); receipt(stage, { sessions: rows }); expect(rows).toHaveLength(0);
}
async function noAuthority() {
  const counts = (await owner.sql`SELECT
    (SELECT count(*)::int FROM trader_risk_account_current_v1 WHERE organization_id=${organizationId}::uuid) AS current,
    (SELECT count(*)::int FROM trader_risk_account_bases_v1 WHERE organization_id=${organizationId}::uuid) AS bases,
    (SELECT count(*)::int FROM trader_risk_allowances_v2 WHERE organization_id=${organizationId}::uuid) AS allowances,
    (SELECT count(*)::int FROM trader_orders WHERE organization_id=${organizationId}::uuid) AS orders`)[0];
  receipt("no-authority-effects", counts); expect(counts).toEqual({ current: 0, bases: 0, allowances: 0, orders: 0 });
}
type Fixture = { job: HtxAccountAcquisitionJobV1; directory: string; assignment: ObservationAssignment;
  provider: MasterKeyProvider; key: string; secret: string; keyCalls: { unwrap: number; wrap: number }; markers: string[] };

async function fixture(): Promise<Fixture> {
  const master = randomBytes(32); masters.push(master);
  const actual = await SecretsStoreMasterKeyProvider.create({ secretGetter: async () => master.toString("base64"), productionReady: true });
  const keyCalls = { unwrap: 0, wrap: 0 }, markers: string[] = [];
  const provider: MasterKeyProvider = { isProductionReady: () => actual.isProductionReady(),
    getCurrentKeyVersion: () => actual.getCurrentKeyVersion(),
    encryptDataKey: value => { keyCalls.wrap++; return actual.encryptDataKey(value); },
    async decryptDataKey(value) { keyCalls.unwrap++; markers.push("actual-unwrap-enter");
      const result = await actual.decryptDataKey(value); markers.push("actual-unwrap-return"); return result; } };
  const credentialId = randomUUID(), exchangeAccountId = String(++accountSequence);
  const key = `synthetic_${credentialId.replaceAll("-", "")}`, secret = `synthetic_secret_${randomUUID()}`;
  const envelope = await encryptCredentialPayload(provider, { apiKey: key, apiSecret: secret });
  const config = createObservationConfiguration({ symbols: ["BTCUSDT"], pollIntervalMs: 1000,
    maxBackoffMs: 1000, readTimeoutMs: 2000, leaseTtlMs: 10000,
    htxCoverage: { host: "api.huobi.pro", pageSize: 2, maxPages: 10, maxRecords: 100,
      maxResponseBytes: 1048576, tradeWindowMs: 60000 } });
  await owner.sql`INSERT INTO public.exchange_credentials (id, organization_id, venue, exchange_account_id,
    api_key_masked, encrypted_payload, payload_key_version, wrapped_dek_key_version, wrapped_dek_key,
    permission_metadata, status) VALUES (${credentialId}::uuid, ${organizationId}::uuid, 'htx', ${exchangeAccountId},
    'synthetic****', ${envelope.encryptedPayload}, ${envelope.payloadKeyVersion}, ${envelope.wrappedDekKeyVersion},
    ${envelope.wrappedDekKey}, '{"scopes":["read"]}', 'active')`;
  await owner.sql`INSERT INTO public.trader_account_collection_state
    (organization_id, credential_id, exchange_account_id, configuration_revision, symbols)
    VALUES (${organizationId}::uuid, ${credentialId}::uuid, ${exchangeAccountId}, ${config.revision}, '["BTCUSDT"]')`;
  const revision = (await owner.sql`SELECT observation_revision::text AS revision FROM public.exchange_credentials
    WHERE id=${credentialId}::uuid`)[0]!.revision;
  expect(revision).toBe("1");
  const assignment: ObservationAssignment = { binding: { organizationId, credentialId, exchangeAccountId,
    credentialRevision: revision, configurationRevision: config.revision }, config };
  const accountId = `inactive-component-${randomUUID()}`, acquisitionId = randomUUID(), now = Date.now() - 2000;
  const from = new Date(now - 60000).toISOString(), until = new Date(now + 3600000).toISOString();
  const rawEvidence = { sourceId, captureReceiptDigest: hash("INACTIVE_FIXTURE_CAPTURE"), storageBindingDigest: hash("INACTIVE_FIXTURE_STORAGE"),
    validationReceiptDigest: hash("INACTIVE_FIXTURE_VALIDATION"), rawBytesDigest: hash("INACTIVE_FIXTURE_RAW") };
  const profile = createRiskAccountProfileV1({ organizationId, accountId, credentialId, exchangeAccountId,
    accountSourceId: sourceId, venue: "HTX", market: "SPOT", referenceCurrency: "USDT", assets: ["BTC", "USDT"],
    instruments: [{ instrumentIdentityDigestHex: hash("BTC/USDT"), symbol: "BTC/USDT", baseAsset: "BTC", quoteAsset: "USDT", referenceSourceId: sourceId }],
    strategyId: "INACTIVE_FK_FIXTURE_ONLY", strategyVersion: "v1",
    sourceContract: { evidence: rawEvidence, statementDigest: hash("UNQUALIFIED_FIXTURE_CONTRACT"),
      anchorMethod: "INDEPENDENT_SOURCE_ASSERTED_DATED_ACCOUNT", validFromUtc: from, validUntilUtc: until,
      maxSourceAgeMs: 60000, maxReportClockSkewMs: 0, coveredAssetSetDigest: riskAccountDigestV1(["BTC", "USDT"]) },
    mutationBounds: ["BTC", "USDT"].flatMap(asset => RISK_ACCOUNT_CHANNELS_V1.map(channel => ({ asset, channel,
      intervalStartUtc: from, intervalEndUtc: until, maximumPositiveQuantity: "1", maximumNegativeQuantity: "1",
      contractStatementDigest: hash("UNQUALIFIED_FIXTURE_CONTRACT") }))),
    reference: { qualification: { evidence: rawEvidence, statementDigest: hash("UNQUALIFIED_FIXTURE_METHOD"), methodVersion: RISK_REFERENCE_METHOD_V1,
      validFromUtc: from, validUntilUtc: until, reportTimeSemantics: "HTX_RESPONSE_GENERATION_WITH_QUALIFIED_SIDE_AGE_BOUND", venueDependence: "SINGLE_VENUE_HTX" },
      windowDurationMs: 1000, slotOffsetsMs: [0, 500], slotToleranceMs: 0, maxSideAgeMs: 10, validityMs: 60000 },
    allocation: { evidence: rawEvidence, statementDigest: hash("NOT_AN_ADOPTED_CAP"), allocationId: "INACTIVE_FIXTURE_ONLY", version: "v1",
      approvedNotional: "1", allowedSymbols: ["BTC/USDT"], validFromUtc: from, validUntilUtc: until },
    governance: { coolingOffMs: 1, reviewReason: "Root-admitted inactive FK fixture; no authority/activation" },
    work: { maxRawBytes: 1048576, requestTimeoutMs: 2000, maxPages: 20, maxMembers: 100,
      maxLedgerEvents: 20, retentionSeconds: 3600 } });
  const members: RiskReferenceMemberV1[] = [0, 1].map(slot => sealRiskAccountRecordV1({ schemaVersion: "risk-reference-member/v1" as const,
    organizationId, accountId, profileDigest: profile.contentDigest, windowId: acquisitionId, slot,
    instrumentIdentityDigestHex: hash("BTC/USDT"), symbol: "BTC/USDT", baseAsset: "BTC", quoteAsset: "USDT" as const,
    ...rawEvidence, sourceReportTimeUtc: new Date(now + slot * 500).toISOString(), availableAtUtc: new Date(now + slot * 500).toISOString(),
    rawMemberPath: "tick" as const, decoderVersion: "htx-merged-lossless-scale8/v1", normalizedInputDigest: hash(`normal${slot}`),
    gatewayReceiptDigest: hash(`gateway${slot}`), observationId: hash(`observation${slot}`), observationContentDigest: hash(`content${slot}`),
    trustAsOfReceiptId: hash(`trust${slot}`), bid: "9", ask: "10", last: "11" }));
  const reference = createRiskAccountReferenceV1({ profile, windowId: acquisitionId,
    windowStartUtc: new Date(now).toISOString(), assembledAtUtc: new Date(now + 1000).toISOString(), members });
  const { contentDigest: profileDigest, ...profileBody } = profile, { contentDigest: referenceDigest, ...referenceBody } = reference;
  await db().insert(schema.traderRiskAccountProfilesV1).values({ organizationId, accountId, contentDigest: profileDigest,
    bodyText: canonicalJsonString(profileBody), actorId, auditId });
  await db().insert(schema.traderRiskAccountReferencesV1).values({ organizationId, accountId, contentDigest: referenceDigest,
    bodyText: canonicalJsonString(referenceBody), profileDigest, windowId: acquisitionId });
  const spec: HtxAccountAcquisitionSpecV1 = { acquisitionId, accountId,
    binding: assignment.binding,
    sourceId, profileDigest, referenceDigest, assets: ["BTC", "USDT"], symbols: ["BTC/USDT"], knownOrders: [{ orderId: "999", symbol: "BTC/USDT" }],
    historyStartUtc: from, historyEndUtc: new Date(now).toISOString(), pageSize: 2,
    maxPages: profile.work.maxPages, maxMembers: profile.work.maxMembers, maxRawBytes: profile.work.maxRawBytes,
    requestTimeoutMs: profile.work.requestTimeoutMs, retentionSeconds: profile.work.retentionSeconds };
  const job = createHtxAccountAcquisitionJobV1({ schemaVersion: "risk-account-acquisition-job/v1", organizationId, accountId,
    id: acquisitionId, profileDigest, referenceDigest, spec, expected: { currentRevision: "1", riskStateVersion: "0",
      riskEventHeadDigest: null, realityProjectionId: "NO_REALITY_AUTHORITY", realityFrontierHeadDigest: null } });
  const { contentDigest, ...body } = job;
  await db().insert(schema.traderRiskAccountAcquisitionJobsV1).values({ organizationId, accountId, contentDigest,
    bodyText: canonicalJsonString(body), id: acquisitionId, profileDigest, referenceDigest });
  const directory = await mkdtemp(join(homedir(), ".waia-dee1135-pg17-owner-test-")); directories.push(directory);
  return { job, directory, assignment, provider, key, secret, keyCalls, markers };
}

function wire(f: Fixture, before?: (path: string, occurrence: number) => Promise<Response | void>) {
  const paths: string[] = [];
  const fetchImpl: typeof fetch = async (address, options) => {
    const target = new URL(String(address));
    expect(target.origin).toBe("https://api.huobi.pro"); expect(options?.method).toBe("GET");
    expect(target.searchParams.get("AccessKeyId")).toBe(f.key);
    expect(target.searchParams.get("Signature")).toBeTruthy();
    const path = target.pathname; paths.push(path); f.markers.push(`http:${path}`);
    const override = await before?.(path, paths.filter(value => value === path).length);
    if (override) return override;
    if (path === "/v1/account/accounts") return Response.json({ status: "ok",
      data: [{ id: Number(f.assignment.binding.exchangeAccountId), type: "spot", state: "working" }] });
    if (path === "/v2/user/uid") return Response.json({ code: 200, data: 456 });
    if (path === "/v2/user/api-key") {
      expect(target.searchParams.get("accessKey")).toBe(f.key);
      return Response.json({ code: 200, data: [{ accessKey: f.key, status: "normal", permission: "readOnly" }] });
    }
    const account = f.assignment.binding.exchangeAccountId;
    let data: unknown;
    if (path === `/v1/account/accounts/${account}/balance`) data = { id: Number(account), type: "spot", state: "working", list: [
      { currency: "btc", type: "trade", balance: "2" }, { currency: "btc", type: "frozen", balance: "0" },
      { currency: "usdt", type: "trade", balance: "100" }, { currency: "usdt", type: "frozen", balance: "0" }] };
    else if (["/v1/order/openOrders", "/v2/algo-orders/opening", "/v2/algo-orders/history", "/v1/account/history"].includes(path)) data = [];
    else if (path === "/v1/order/orders/999/matchresults") data = [{ "order-id": 999, "trade-id": "123456", symbol: "btcusdt",
      type: "buy-limit", price: "10", "filled-amount": "1", "filled-fees": "0", "filled-points": "0", "fee-currency": "usdt",
      "created-at": Date.parse(f.job.spec.historyEndUtc) - 1 }];
    else throw new Error("UNEXPECTED_SYNTHETIC_HTX_PATH");
    return Response.json({ ...(path.startsWith("/v2/") ? { code: 200 } : { status: "ok" }), data });
  };
  return { fetchImpl, paths };
}
function configured(f: Fixture, signal = new AbortController().signal,
  provider = f.provider, assignment = f.assignment) {
  return acquireConfiguredHtxAccountV1Postgres({ db: db(), context: { organizationId }, accountId: f.job.accountId,
    acquisitionId: f.job.id, signal, infrastructure: { readerDatabaseUrl: runtimeUrl("reader"),
      credentialDatabaseUrl: runtimeUrl("credential"), masterKeyProvider: provider, assignment, host: "api.huobi.pro",
      rawStorage: { directory: f.directory, maxStoredBytes: 33554432, maxStoredObjects: 128 } } });
}
function snapshot(f: Fixture) {
  return readHtxAccountAcquisitionV1Postgres(db(), { organizationId }, { accountId: f.job.accountId, acquisitionId: f.job.id });
}
async function objects(f: Fixture) {
  return Promise.all((await readdir(f.directory)).sort().map(async name => ({ name, digest: hash(await readFile(join(f.directory, name))) })));
}
async function direct(f: Fixture, fetchImpl: typeof fetch) {
  const reader = await connect(runtimeUrl("reader"), "direct-reader", true, statement => {
    if (statement.includes("SELECT state.symbols")) f.markers.push("actual-assignment-query");
    if (statement.includes("SELECT c.observation_revision")) f.markers.push("actual-binding-query");
  });
  const credential = await connect(runtimeUrl("credential"), "direct-credential", true, statement => {
    if (statement.includes("SELECT id, organization_id, exchange_account_id, status, encrypted_payload")) f.markers.push("actual-credential-query");
  });
  const session = createProtectedHtxAccountAcquisitionSessionV1({ readerSql: reader.sql, credentialSql: credential.sql,
    masterKeyProvider: f.provider, assignment: f.assignment, spec: f.job.spec,
    host: "api.huobi.pro", clock: accountObservationClock, fetchImpl });
  return { reader, credential, session,
    async close() { try { await session.dispose(); f.markers.push("full-session-disposed"); }
      finally { await Promise.all([close(reader), close(credential)]); f.markers.push("restricted-pools-closed"); } } };
}
async function heldRuntime(stage: string, settled: () => boolean) {
  // Both the controlled dependency and actual still-owned PostgreSQL sessions must exist.
  const rows = await runtimeRows();
  receipt(stage, { settled: settled(), sessions: rows });
  expect(settled()).toBe(false); expect(rows.length).toBeGreaterThan(0); expect(rows.length).toBeLessThanOrEqual(4);
}
async function loginPosture(sql: Sql) {
  return sql`SELECT login.rolname, login.rolcanlogin, login.rolinherit, login.rolsuper, login.rolcreatedb,
    login.rolcreaterole, login.rolreplication, login.rolbypassrls, login.rolconnlimit,
    (SELECT jsonb_agg(jsonb_build_object('parent',parent.rolname,'admin',m.admin_option,
      'inherit',m.inherit_option,'set',m.set_option) ORDER BY parent.rolname)
      FROM pg_auth_members m JOIN pg_roles parent ON parent.oid=m.roleid WHERE m.member=login.oid) AS membership
    FROM pg_roles login WHERE login.rolname IN
    ('waia_account_observer_login','waia_account_observation_reader_login','waia_account_observation_credential_login') ORDER BY login.rolname`;
}
async function catalogPosture(sql: Sql) {
  // Stable semantic catalog fields only: no row contents, sequence values or catalog OIDs.
  return {
    relations: await sql`SELECT n.nspname,c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,
      c.relacl::text AS acl,pg_get_userbyid(c.relowner) AS owner,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('column',a.attname,'acl',a.attacl::text) ORDER BY a.attnum),'[]'::jsonb)
        FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS column_acls FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%'
      AND n.nspname<>'information_schema' ORDER BY n.nspname,c.relname,c.relkind`,
    policies: await sql`SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
      FROM pg_policies ORDER BY schemaname,tablename,policyname`,
    triggers: await sql`SELECT n.nspname,c.relname,t.tgname,t.tgenabled,t.tgisinternal,
      pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%'
      AND n.nspname<>'information_schema' ORDER BY n.nspname,c.relname,t.tgname`,
    functions: await sql`SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,
      pg_get_userbyid(p.proowner) AS owner,p.proacl::text AS acl,p.prosecdef,p.proconfig,
      pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema' AND p.prokind IN ('f','p')
      ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)`,
    schemas: await sql`SELECT nspname,nspacl::text AS acl,pg_get_userbyid(nspowner) AS owner
      FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname<>'information_schema' ORDER BY nspname`,
    defaults: await sql`SELECT pg_get_userbyid(d.defaclrole) AS role,n.nspname,d.defaclobjtype,d.defaclacl::text AS acl
      FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
      ORDER BY pg_get_userbyid(d.defaclrole),n.nspname,d.defaclobjtype`,
    constraints: await sql`SELECT n.nspname,COALESCE(c.relname,ty.typname) AS relation,k.conname,k.contype,
      k.condeferrable,k.condeferred,k.convalidated,k.connoinherit,pg_get_constraintdef(k.oid,true) AS definition
      FROM pg_constraint k JOIN pg_namespace n ON n.oid=k.connamespace LEFT JOIN pg_class c ON c.oid=k.conrelid
      LEFT JOIN pg_type ty ON ty.oid=k.contypid WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'
      ORDER BY n.nspname,COALESCE(c.relname,ty.typname),k.conname`,
    indexes: await sql`SELECT schemaname,tablename,indexname,tablespace,indexdef FROM pg_indexes
      WHERE schemaname NOT LIKE 'pg_%' AND schemaname<>'information_schema' ORDER BY schemaname,tablename,indexname`,
  };
}
let initialPosture: Awaited<ReturnType<typeof loginPosture>>;
let initialCatalog: Awaited<ReturnType<typeof catalogPosture>>;

describe.skipIf(!enabled)("DEE-1135 actual PostgreSQL 17 protected observational owner", () => {
  beforeAll(async () => {
    const root = await connect(url, "root");
    const requested = process.env.DEE1135_PG17_DATABASE_NAME;
    const freshCi = requested === undefined && process.env.CI === "true" && process.env.GITHUB_ACTIONS === "true";
    // Name-only local routing. No environment database URL, role, password or permissive probe flag.
    if (!freshCi && requested === undefined) throw new Error("EXPLICIT_LOCAL_FRESH_DATABASE_REQUIRED");
    database = requested ?? `waia_dee1121_dee1135_acquisition_pg17_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    if (!/^waia_dee1121_dee1135_acquisition_pg17_[a-z0-9_]+$/.test(database) || database.length > 63)
      throw new Error("SYNTHETIC_DATABASE_NAME");
    try {
      expect((await root.sql`SELECT current_user::text AS role`)[0]!.role).toBe("waia_local_admin");
      expect(await root.sql`SELECT datname FROM pg_database WHERE datname=${database}`).toHaveLength(0);
      const logins = await loginPosture(root.sql);
      if (logins.length !== 3 && !(freshCi && logins.length === 0)) throw new Error("PRESERVED_LOGIN_SET_REQUIRED");
      // A separate reviewed local runner owns the wider zero-client/service admission.
      expect(await root.sql`SELECT pid FROM pg_stat_activity WHERE usename IN
        ('waia_account_observer_login','waia_account_observation_reader_login','waia_account_observation_credential_login')`).toHaveLength(0);
      await root.sql.unsafe(`CREATE DATABASE "${database}"`);
      const target = new URL(url); target.pathname = `/${database}`; adminUrl = target.toString();
      owner = await connect(adminUrl, "journal");
      await owner.sql.unsafe(readFileSync("scripts/postgres-validation/prelude-auth-stub.sql", "utf8"));
      const folder = "db/migrations_postgres";
      const journal = JSON.parse(readFileSync(`${folder}/meta/_journal.json`, "utf8")) as {
        entries: { idx: number; tag: string; when: number }[] };
      expect(journal.entries).toHaveLength(230);
      expect(journal.entries.at(-1)).toMatchObject({ idx: 229, tag: "0229_trader_observation_read_only_credential_v1", when: 1780000000229 });
      await migrate(db(), { migrationsFolder: folder });
      const actual = await owner.sql`SELECT hash,created_at::text AS when FROM drizzle.__drizzle_migrations ORDER BY created_at`;
      expect(actual).toEqual(journal.entries.map(entry => ({ hash: hash(readFileSync(`${folder}/${entry.tag}.sql`)), when: String(entry.when) })));
      receipt("genuine-migration-chain", { database, count: actual.length, entries: actual });
      if (logins.length === 0) {
        // This branch is unreachable in retained local mode; no existing role is reset or repaired.
        expect(freshCi).toBe(true);
        const provisioned = await provisionAccountObservationLoginsV1({ WAIA_POSTGRES_ADMIN_SESSION_URL: adminUrl,
          WAIA_OBSERVATION_COLLECTOR_DB_PASSWORD: passwords.collector,
          WAIA_OBSERVATION_READER_DB_PASSWORD: passwords.reader,
          WAIA_OBSERVATION_CREDENTIAL_DB_PASSWORD: passwords.credential });
        expect(provisioned.status).toBe("OK"); expect(provisioned.logins.every((entry: { created: boolean }) => entry.created)).toBe(true);
        receipt("fresh-ci-only-provisioning", provisioned);
      }
      initialPosture = await loginPosture(owner.sql); expect(initialPosture).toHaveLength(3);
      for (const row of initialPosture) {
        const plan = ACCOUNT_OBSERVATION_LOGIN_PLAN.find(entry => entry.loginRole === row.rolname)!;
        expect(row).toMatchObject({ rolcanlogin: true, rolinherit: false, rolsuper: false, rolcreatedb: false,
          rolcreaterole: false, rolreplication: false, rolbypassrls: false, rolconnlimit: 2,
          membership: [{ parent: plan.parentRole, admin: false, inherit: false, set: true }] });
      }
      receipt("runtime-login-posture", { mode: freshCi ? "FRESH_CI" : "PRESERVED_LOCAL", rows: initialPosture });
      for (const purpose of ["collector", "reader", "credential"] as const) {
        const client = await connect(runtimeUrl(purpose), `authenticate-${purpose}`, true);
        try {
          const login = purpose === "credential" ? await probeObservationCredentialPool(client.sql) : await probeObservationPool(client.sql, purpose);
          expect(login).toBe(ACCOUNT_OBSERVATION_LOGIN_PLAN.find(entry => entry.purpose === purpose)!.loginRole);
          receipt("actual-runtime-probe", { purpose, login, pid: client.pid });
        } finally { await close(client); }
      }
      initialCatalog = await catalogPosture(owner.sql);
      receipt("catalog-posture-before", { digest: hash(canonicalJsonString(initialCatalog)), catalog: initialCatalog });
    } finally { await close(root); }
    controller = await connect(adminUrl, "controller");
    actorId = randomUUID(); auditId = randomUUID(); sourceId = randomUUID();
    await owner.sql`INSERT INTO auth.users(id) VALUES(${actorId}::uuid)`;
    await db().insert(schema.users).values({ id: actorId, identityLabel: "DEE1135 PG17 inactive synthetic fixture",
      email: `${actorId}@waia.invalid`, passwordHash: null });
    organizationId = await ensureUserCoreSeedPostgres(db(), { userId: actorId, displayName: "DEE1135 PG17 observation-only" });
    await db().insert(schema.auditLogs).values({ id: auditId, actorType: "user", actorId, action: "DEE1135_INACTIVE_COMPONENT_FIXTURE",
      entityType: "test-fixture", entityId: sourceId, organizationId, metadataJson: { authority: "NONE", activation: false } });
    await db().insert(schema.traderMiSource).values({ id: sourceId, organizationId, venue: "HTX", feedKind: "account_snapshot",
      description: "Synthetic PG17 component source; not qualified for account authority", status: "active" });
  }, 300000);
  afterEach(async () => {
    vi.unstubAllGlobals();
    if (controller && !controller.closed) await closedRuntime("case-runtime-closure");
    if (organizationId) await noAuthority();
  });
  afterAll(async () => {
    try {
      if (initialCatalog && owner && !owner.closed) {
        const finalCatalog = await catalogPosture(owner.sql);
        receipt("catalog-posture-after", { digest: hash(canonicalJsonString(finalCatalog)), catalog: finalCatalog });
        expect(finalCatalog).toEqual(initialCatalog);
      }
      if (initialPosture && owner && !owner.closed) {
        const finalPosture = await loginPosture(owner.sql); receipt("preserved-login-posture", finalPosture);
        expect(finalPosture).toEqual(initialPosture);
      }
      if (controller && !controller.closed) {
        await closedRuntime("final-runtime-closure");
        const remaining = await controller.sql`SELECT pid,application_name FROM pg_stat_activity
          WHERE datname=${database} AND pid<>${controller.pid} AND pid<>${owner.pid}`;
        receipt("no-unowned-clients", remaining); expect(remaining).toHaveLength(0);
      }
    } finally {
      const outcomes = await Promise.allSettled(clients.map(close)); masters.forEach(master => master.fill(0));
      receipt("client-closure", { clients: clients.map(({ name, pid, closed, statements }) => ({ name, pid, closed, queryCount: statements.length })),
        outcomes: outcomes.map(result => result.status === "fulfilled" ? { status: result.status } : { status: result.status, cause: errorShape(result.reason) }),
        retainedSyntheticDatabase: database, retainedSyntheticDirectories: directories, mutableMasterBuffersZeroed: masters.every(master => master.every(value => value === 0)) });
      expect(outcomes.every(result => result.status === "fulfilled")).toBe(true);
    }
  }, 60000);

  it("admits the actual PG17 restricted pools and same-key protected session", async () => {
    const f = await fixture(), io = wire(f), opened = await direct(f, io.fetchImpl);
    const abort = new AbortController();
    try {
      const transport = await opened.session.open(abort.signal);
      f.markers.push("protected-transport-admitted");
      // These are actual SQL-send/key-return/HTTP/admission observations, not fabricated internal flags.
      // A post-decrypt binding query establishes that the preceding credential owner returned successfully.
      for (const marker of ["actual-assignment-query", "actual-binding-query", "actual-credential-query",
        "actual-unwrap-enter", "actual-unwrap-return", "http:/v1/account/accounts", "protected-transport-admitted"])
        expect(f.markers).toContain(marker);
      const unwrap = f.markers.indexOf("actual-unwrap-return"), credential = f.markers.indexOf("actual-credential-query");
      const bindBefore = f.markers.indexOf("actual-binding-query"), bindAfter = f.markers.indexOf("actual-binding-query", unwrap + 1);
      expect(f.markers.indexOf("actual-assignment-query")).toBeLessThan(bindBefore);
      expect(bindBefore).toBeLessThan(credential); expect(credential).toBeLessThan(unwrap);
      expect(bindAfter).toBeGreaterThan(unwrap);
      expect(f.markers.indexOf("http:/v1/account/accounts")).toBeGreaterThan(bindAfter);
      expect(transport.binding).toEqual(f.job.spec.binding);
      expect(io.paths).toEqual(["/v1/account/accounts", "/v2/user/uid", "/v2/user/api-key"]);
      expect(f.keyCalls.unwrap).toBe(1);
      const response = await transport.signedGet(htxAccountAcquisitionRequestV1(f.job.spec,
        htxAccountAcquisitionLanesV1(f.job.spec)[0]!, null, abort.signal));
      expect(response.httpStatus).toBe(200); expect(response.binding).toEqual(f.job.spec.binding);
      expect(io.paths).toHaveLength(10);
      for (const client of [opened.reader, opened.credential]) {
        expect(client.statements).toContain("SET LOCAL transaction_timeout = '5000ms'");
        expect(client.statements).toContain("SET LOCAL lock_timeout = '1000ms'");
        expect(client.statements).toContain("SET LOCAL statement_timeout = '3000ms'");
      }
      expect(opened.reader.statements).toContain("SET LOCAL ROLE waia_account_observation_reader");
      expect(opened.credential.statements).toContain("SET LOCAL ROLE waia_account_observation_credential");
      expect(opened.reader.statements.some(statement => statement.includes("SELECT state.symbols"))).toBe(true);
      expect(opened.credential.statements.some(statement => statement.includes("SELECT id, organization_id, exchange_account_id, status, encrypted_payload"))).toBe(true);
      receipt("protected-session", { binding: transport.binding, readerPid: opened.reader.pid, credentialPid: opened.credential.pid,
        paths: io.paths, markers: f.markers, statements: { reader: opened.reader.statements, credential: opened.credential.statements }, keyCalls: f.keyCalls });
      expect((await snapshot(f)).journal).toHaveLength(0);
    } finally { abort.abort(); await opened.close(); receipt("protected-session-closed", { markers: f.markers }); }
  }, 30000);

  it("records a complete observational job through the actual configured owner", async () => {
    const f = await fixture(), io = wire(f); vi.stubGlobal("fetch", io.fetchImpl);
    const result = await configured(f), saved = await snapshot(f);
    expect(result.kind).toBe("TERMINAL");
    if (result.kind !== "TERMINAL") throw new Error("TERMINAL_REQUIRED");
    expect(result.payload).toMatchObject({ recordingStatus: "RECORDED", pages: 8, members: 5, coverage: "PARTIAL", stateValidTime: "UNKNOWN" });
    expect(saved.journal).toHaveLength(18); expect(io.paths).toHaveLength(59);
    // Fresh store reader, actual retained encrypted bytes, actual PAGE/capture/validation joins.
    const store = await createEncryptedReferenceRawStoreV1({ directory: f.directory, masterKeyProvider: f.provider,
      maxStoredObjects: 128, maxStoredBytes: 33554432 });
    for (const entry of saved.journal) if (entry.kind === "PAGE") {
      const bytes = await store.read(entry.payload.binding, f.job.spec.maxRawBytes);
      const decoded = decodeHtxAccountAcquisitionPageV1({ spec: f.job.spec, lane: entry.payload.page.lane,
        cursor: entry.payload.page.requestCursor, bytes, acquiredAtUtc: entry.payload.page.acquiredAtUtc });
      expect(decoded).toEqual(entry.payload.page); expect(decoded.members.every(member => member.stateValidTime === "UNKNOWN")).toBe(true);
      const capture = (await owner.sql`SELECT content_digest FROM trader_mi_raw_capture_receipt_v1 WHERE id=${entry.payload.capture.contentDigest}`)[0];
      const validation = (await owner.sql`SELECT status,capture_receipt_digest FROM trader_mi_raw_validation_receipt_v1 WHERE id=${entry.payload.validation.contentDigest}`)[0];
      expect(capture?.content_digest).toBe(entry.payload.capture.contentDigest);
      expect(validation).toMatchObject({ status: "VALID", capture_receipt_digest: entry.payload.capture.contentDigest });
    }
    expect(await objects(f)).toHaveLength(8);
    receipt("configured-owner-recorded", { job: f.job.id, terminal: result, paths: io.paths,
      entryDigests: saved.journal.map(entry => entry.contentDigest), objects: await objects(f) });
  }, 90000);

  it("replays the retained terminal on a fresh owner without reopening external resources", async () => {
    const f = await fixture(), io = wire(f); vi.stubGlobal("fetch", io.fetchImpl);
    const first = await configured(f), before = await snapshot(f), beforeObjects = await objects(f);
    const calls = { ...f.keyCalls }, paths = [...io.paths], oldPid = owner.pid;
    await closedRuntime("pre-replay-runtime-closure"); await close(owner); owner = await connect(adminUrl, "fresh-journal");
    expect(owner.pid).not.toBe(oldPid);
    const replay = await configured(f);
    expect(replay).toEqual(first); expect(await snapshot(f)).toEqual(before);
    expect(await objects(f)).toEqual(beforeObjects); expect(f.keyCalls).toEqual(calls); expect(io.paths).toEqual(paths);
    receipt("immutable-terminal-replay", { job: f.job.id, oldPid, freshPid: owner.pid, digest: replay.contentDigest,
      extraHttp: io.paths.length - paths.length, extraUnwrap: f.keyCalls.unwrap - calls.unwrap,
      objects: beforeObjects, entryDigests: before.journal.map(entry => entry.contentDigest) });
  }, 90000);

  it("refuses an actual assignment revoke during protected acquisition admission", async () => {
    const f = await fixture(); let revoked = false;
    const io = wire(f, async (path, occurrence) => {
      if (path === "/v1/account/accounts" && occurrence === 2) {
        await controller.sql`UPDATE public.exchange_credentials SET status='revoked',revoked_at=clock_timestamp()
          WHERE id=${f.assignment.binding.credentialId}::uuid`;
        revoked = true;
      }
    }); vi.stubGlobal("fetch", io.fetchImpl);
    const outcome = await watch(configured(f)).outcome; rejected("actual-revoke-refusal", outcome);
    expect(revoked).toBe(true);
    expect((await owner.sql`SELECT observation_revision::text AS revision,status FROM public.exchange_credentials
      WHERE id=${f.assignment.binding.credentialId}::uuid`)[0]).toMatchObject({ revision: "2", status: "revoked" });
    expect(io.paths).toEqual(["/v1/account/accounts", "/v2/user/uid", "/v2/user/api-key", "/v1/account/accounts"]);
    const saved = await snapshot(f); expect(saved.journal.map(entry => entry.kind)).toEqual(["START", "TERMINAL"]);
    expect(saved.journal.at(-1)?.payload).toMatchObject({ recordingStatus: "PARTIAL", pages: 0, members: 0,
      coverage: "PARTIAL", stateValidTime: "UNKNOWN" });
    expect(await objects(f)).toHaveLength(0);
    receipt("revoked-prefix", { job: f.job.id, paths: io.paths, journal: saved.journal });
  }, 30000);

  it("refuses exact binding drift before opening credentials or recording a job", async () => {
    const f = await fixture(), io = wire(f), keyCalls = { ...f.keyCalls }; vi.stubGlobal("fetch", io.fetchImpl);
    const wrong = { ...f.assignment, binding: { ...f.assignment.binding, credentialRevision: "2" } };
    const reason = rejected("binding-drift-refusal", await watch(configured(f, new AbortController().signal, f.provider, wrong)).outcome);
    expect(reason).toMatchObject({ reason: "ASSIGNMENT_SPEC_MISMATCH" });
    expect(f.keyCalls).toEqual(keyCalls); expect(io.paths).toHaveLength(0);
    expect((await snapshot(f)).journal).toHaveLength(0); expect(await objects(f)).toHaveLength(0);
  }, 30000);

  it("waits on the actual reader query and settles its abort before closing pools", async () => {
    const f = await fixture(), io = wire(f), opened = await direct(f, io.fetchImpl), abort = new AbortController();
    const acquired = gate(), release = gate(); let holder: ReturnType<typeof watch<unknown>> | undefined;
    let work: ReturnType<typeof watch<unknown>> | undefined;
    try {
      const transport = await opened.session.open(abort.signal);
      holder = watch(controller.sql.begin(async tx => {
        await tx`SET LOCAL lock_timeout = '1000ms'`; await tx`SET LOCAL statement_timeout = '3000ms'`;
        await tx`SET LOCAL transaction_timeout = '10000ms'`;
        await tx`LOCK TABLE public.trader_account_collection_state IN ACCESS EXCLUSIVE MODE`;
        acquired.release(); await release.promise;
      }));
      await entered(acquired, holder);
      work = watch(transport.signedGet(htxAccountAcquisitionRequestV1(f.job.spec,
        htxAccountAcquisitionLanesV1(f.job.spec)[0]!, null, abort.signal)));
      let wait: Record<string, unknown> | undefined;
      // The held controller session cannot run another query until its transaction ends.
      // Observe through the idle journal connection, clearing stats before every actual poll.
      const until = performance.now() + 700;
      while (performance.now() < until) {
        await owner.sql`SELECT pg_stat_clear_snapshot()`;
        const rows = await owner.sql`SELECT pid,query,state,wait_event_type,wait_event,pg_blocking_pids(pid) AS blockers
          FROM pg_stat_activity WHERE pid=${opened.reader.pid}`;
        const row = rows[0];
        if (row?.wait_event_type === "Lock" && String(row.query).includes("SELECT state.symbols") &&
          String(row.query).includes("trader_account_collection_state") && row.blockers.includes(controller.pid)) { wait = row; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      receipt("actual-reader-wait", { wait, readerPid: opened.reader.pid, blockerPid: controller.pid });
      expect(wait, "actual reader wait must be observed, never inferred from delay").toBeDefined();
      expect(opened.reader.pid).not.toBe(controller.pid); abort.abort();
      rejected("public-reader-abort", await work.outcome);
      const settlement = watch(opened.session.dispose());
      expect(settlement.settled()).toBe(false);
      // Release before the unchanged one-second runtime lock timeout; await both real transactions.
      release.release(); expect((await holder.outcome).status).toBe("fulfilled");
      const settled = await settlement.outcome;
      receipt("reader-settlement", settled.status === "rejected" ? errorShape(settled.reason) : { status: settled.status });
      expect(settled.status).toBe("fulfilled"); expect(io.paths).toHaveLength(3);
      expect((await snapshot(f)).journal).toHaveLength(0);
    } finally {
      abort.abort(); release.release(); if (holder) await holder.outcome; if (work) await work.outcome; await opened.close();
    }
  }, 30000);

  it("retains pending ownership until actual late credential unwrap settles", async () => {
    const f = await fixture(), io = wire(f), began = gate(), release = gate(), abort = new AbortController();
    vi.stubGlobal("fetch", io.fetchImpl); let returned: Uint8Array | undefined;
    // Only scheduling is controlled: use the genuine provider's decrypt result, never approving metadata or SQL.
    const provider: MasterKeyProvider = { ...f.provider, async decryptDataKey(value) {
      returned = await f.provider.decryptDataKey(value); f.markers.push("unwrap-result-held");
      began.release(); await release.promise; f.markers.push("unwrap-result-released"); return returned;
    } };
    const work = watch(configured(f, abort.signal, provider));
    try {
      await entered(began, work); abort.abort(); f.markers.push("owner-aborted"); await heldRuntime("late-unwrap-owned", work.settled);
      expect(io.paths).toHaveLength(0); release.release();
      rejected("late-unwrap-refusal", await work.outcome);
      f.markers.push("configured-owner-settled");
      expect(returned).toHaveLength(32); expect(returned!.every(value => value === 0)).toBe(true);
      receipt("abandoned-credential-continuation", { markers: f.markers, mutableDekZeroed: returned!.every(value => value === 0),
        signedHttpCalls: io.paths.length, configuredOutcome: "REJECTED" });
      expect(io.paths).toHaveLength(0); expect((await snapshot(f)).journal).toHaveLength(0);
      expect(await objects(f)).toHaveLength(0);
    } finally { abort.abort(); release.release(); await work.outcome; }
  }, 30000);

  it("retains pending ownership through late fetch and body cancellation", async () => {
    const f = await fixture(), began = gate(), releaseFetch = gate(), cancelling = gate(), releaseCancel = gate();
    const abort = new AbortController();
    const io = wire(f, async () => {
      began.release(); await releaseFetch.promise;
      return new Response(new ReadableStream({ cancel() { cancelling.release(); return releaseCancel.promise; } }));
    }); vi.stubGlobal("fetch", io.fetchImpl);
    const work = watch(configured(f, abort.signal));
    try {
      await entered(began, work); abort.abort(); await heldRuntime("late-fetch-owned", work.settled);
      releaseFetch.release(); await entered(cancelling, work); await heldRuntime("late-body-cancellation-owned", work.settled);
      releaseCancel.release(); rejected("late-fetch-body-refusal", await work.outcome);
      expect(io.paths).toEqual(["/v1/account/accounts"]);
      expect((await snapshot(f)).journal).toHaveLength(0); expect(await objects(f)).toHaveLength(0);
    } finally { abort.abort(); releaseFetch.release(); releaseCancel.release(); await work.outcome; }
  }, 30000);

  it("reports failed body cancellation without claiming successful settlement", async () => {
    const f = await fixture(), reading = gate(), abort = new AbortController(); let cancellations = 0;
    const io = wire(f, async () => new Response(new ReadableStream({ pull() { reading.release(); },
      cancel() { cancellations++; return Promise.reject(new Error("SYNTHETIC_BODY_CANCELLATION_FAILED")); } })));
    vi.stubGlobal("fetch", io.fetchImpl); const work = watch(configured(f, abort.signal));
    try {
      await entered(reading, work); abort.abort();
      const reason = rejected("failed-body-cancellation", await work.outcome);
      expect(reason).toMatchObject({ reason: "TRANSPORT_SETTLEMENT_FAILED" }); expect(cancellations).toBe(1);
      expect(io.paths).toEqual(["/v1/account/accounts"]);
      expect((await snapshot(f)).journal).toHaveLength(0); expect(await objects(f)).toHaveLength(0);
      receipt("failed-cancellation-retained", { cancellations, authority: "NONE", settlement: "FAILED", poolsStillMustClose: true });
    } finally { abort.abort(); await work.outcome; }
  }, 30000);
});
