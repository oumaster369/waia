#!/usr/bin/env node
/**
 * Prepare one owned, disposable PostgreSQL 17 fixture for the projection child-service proof.
 * This script has no production URL/env fallback and refuses any journal other than entries
 * 0000..0231. Successful resources are intentionally retained for an explicit root-agent handoff.
 */
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID, X509Certificate } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import databaseTls from "../../lib/trader/account-observation/database-node-tls.ts";
import postgresReader from "../../lib/trader/account-observation/postgres-reader.ts";
import migrationBudget from "../ops/postgres-migrate-with-session-lock-budget.ts";
import observationRoleProbe from "../../lib/trader/account-observation/host-role-probe.ts";
import {
  ACCOUNT_OBSERVATION_LOGIN_PLAN,
  provisionAccountObservationLoginsV1,
} from "../ops/provision-account-observation-logins.mjs";

const { createAccountObservationDatabaseTlsOptions } = databaseTls;
const { createPostgresObservationReader } = postgresReader;
const { migratePostgresConnectionWithSessionLockBudget } = migrationBudget;
const { observationPoolLimits, probeObservationPool } = observationRoleProbe;

const FIXED_ORIGIN = "https://observation-reader.waia.life";
const DATABASE_NAME = "waia_projection_test";
const IMAGE = "postgres:17-alpine";
const READER_LOGIN = "waia_account_observation_reader_login";
const READER_PARENT = "waia_account_observation_reader";
const NETWORK_ALIAS = "waia-projection-test-db";
const FIXTURE_SCHEMA = "waia.projection_native_fixture.v1";
const root = process.cwd();
const fixtureRoot = process.argv[2] ? resolve(process.argv[2]) : "";
const fixtureDir = fixtureRoot ? resolve(fixtureRoot, "runtime") : "";
const attemptsDir = fixtureRoot ? resolve(fixtureRoot, "attempts") : "";
let networkName;
let containerName;
let createdNetwork = false;
let createdContainer = false;
let createdRuntimeDir = false;
let handedOff = false;
let stage = "arguments";
let stageDetail = null;
let stageDiagnostics;
let adminSql;
let runtimeSql;

function refuse(code) {
  const error = new Error(`PROJECTION_NATIVE_FIXTURE_REFUSED:${code}`);
  error.code = code;
  throw error;
}
function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000, ...options }).trim();
}
function path(name) { return resolve(fixtureDir, name); }
function writePrivate(name, value) {
  writeFileSync(path(name), value, { mode: 0o600, flag: "wx" });
  chmodSync(path(name), 0o600);
}
function writePublic(name, value) {
  writeFileSync(path(name), value, { mode: 0o444, flag: "wx" });
  chmodSync(path(name), 0o444);
}
function assertLocalDockerContext() {
  const overrideNames = ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"];
  const overrides = overrideNames.filter((name) => process.env[name]?.trim());
  if (overrides.length) refuse("DOCKER_ENDPOINT_OVERRIDE");
  const name = run("docker", ["context", "show"]);
  const endpointInfo = JSON.parse(run("docker", ["context", "inspect", "--format", "{{json .Endpoints.docker}}", name]));
  const endpoint = endpointInfo?.Host;
  if (typeof endpoint !== "string" || !endpoint.startsWith("unix:///")) refuse("LOCAL_DOCKER_SOCKET_REQUIRED");
  const socketPath = endpoint.slice("unix://".length);
  if (socketPath.includes("?") || socketPath.includes("#") || socketPath.split("/").includes("..")) {
    refuse("LOCAL_DOCKER_SOCKET_REQUIRED");
  }
  try {
    if (!statSync(socketPath).isSocket()) refuse("LOCAL_DOCKER_SOCKET_REQUIRED");
  } catch { refuse("LOCAL_DOCKER_SOCKET_REQUIRED"); }
  return Object.freeze({ name, endpoint, socketPath });
}
function makeObservation(binding, timestamp, observationId) {
  const component = Object.freeze({ status: "COMPLETE", values: Object.freeze([]), sourceAsOfMs: null,
    readStartedAtMs: timestamp, readCompletedAtMs: timestamp, error: null });
  return Object.freeze({ schemaVersion: "account-observation/v1", observationId, binding,
    collectionStartedAtMs: timestamp, collectionCompletedAtMs: timestamp, status: "COMPLETE",
    balances: component, openOrders: component, holdings: Object.freeze([]),
    trades: Object.freeze([Object.freeze({ symbol: "BTCUSDT", component })]) });
}
function makeBinding(organizationId, credentialId, exchangeAccountId, configurationRevision) {
  return Object.freeze({ organizationId, credentialId, exchangeAccountId,
    credentialRevision: "1", configurationRevision });
}
async function seedSyntheticTenant(sql, binding, marker) {
  const userId = randomUUID();
  const observationId = randomUUID();
  const timestamp = Date.now();
  const payload = makeObservation(binding, timestamp, observationId);
  stageDetail = `${marker}:auth-user`;
  await sql`INSERT INTO auth.users (id) VALUES (${userId})`;
  stageDetail = `${marker}:public-user`;
  await sql`INSERT INTO public.users (id, identity_label, email)
    VALUES (${userId}, ${`Projection fixture ${marker}`}, ${`projection-${marker}-${userId}@invalid.local`})`;
  stageDetail = `${marker}:organization`;
  await sql`INSERT INTO public.organizations (id, owner_user_id, kind, name)
    VALUES (${binding.organizationId}, ${userId}, 'personal', ${`Projection fixture ${marker}`})`;
  stageDetail = `${marker}:exchange-credential`;
  await sql`INSERT INTO public.exchange_credentials (id, organization_id, venue, exchange_account_id, encrypted_payload)
    VALUES (${binding.credentialId}, ${binding.organizationId}, 'htx', ${binding.exchangeAccountId}, 'synthetic-no-key')`;
  stageDetail = `${marker}:collection-state`;
  await sql`INSERT INTO public.trader_account_collection_state
    (organization_id, credential_id, exchange_account_id, configuration_revision, symbols)
    VALUES (${binding.organizationId}, ${binding.credentialId}, ${binding.exchangeAccountId},
      ${binding.configurationRevision}, '["BTCUSDT"]')`;
  stageDetail = `${marker}:observation`;
  await sql`INSERT INTO public.trader_account_observations
    (organization_id, credential_id, exchange_account_id, observation_id, credential_revision,
      configuration_revision, lease_token, payload)
    VALUES (${binding.organizationId}, ${binding.credentialId}, ${binding.exchangeAccountId}, ${observationId},
      1, ${binding.configurationRevision}, ${randomUUID()}, ${JSON.stringify(payload)}::jsonb)`;
  stageDetail = `${marker}:last-observation-pointer`;
  await sql`UPDATE public.trader_account_collection_state SET last_observation_id = ${observationId}
    WHERE organization_id = ${binding.organizationId} AND credential_id = ${binding.credentialId}
      AND exchange_account_id = ${binding.exchangeAccountId}`;
  return Object.freeze({ binding, observationId, timestamp });
}
async function waitReady(id) {
  let lastReadiness = "not-checked";
  let lastHealthStatus = "unavailable";
  for (let attempt = 0; attempt < 60; attempt++) {
    let readiness = "not-checked";
    let healthStatus = "unavailable";
    try {
      run("docker", ["exec", id, "pg_isready", "-U", "waia_local_admin", "-d", DATABASE_NAME]);
      readiness = "pg-is-ready";
    } catch (error) { readiness = safeCode(error); }
    try {
      const status = run("docker", ["inspect", "--format", "{{.State.Health.Status}}", id]);
      healthStatus = status || "empty";
      if (readiness === "pg-is-ready" && healthStatus === "healthy") return;
    } catch (error) { healthStatus = safeCode(error); }
    lastReadiness = readiness;
    lastHealthStatus = healthStatus;
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  stageDiagnostics = await readReadinessDiagnostics(id, lastReadiness, lastHealthStatus);
  refuse("POSTGRES_START_TIMEOUT");
}
function safeCode(error) {
  if (typeof error?.code === "string" && /^[A-Z0-9_]{1,64}$/.test(error.code)) return error.code;
  if (Number.isInteger(error?.status)) return `EXIT_${error.status}`;
  return error?.name === "Error" ? "COMMAND_FAILED" : "COMMAND_ERROR";
}
function sanitizeLogTail(output) {
  const lines = String(output).split(/\r?\n/).filter((line) =>
    /database system|\b(fatal|error|panic)\b|initdb|could not|failed|ready to accept|permission denied|no space|address already in use|does not exist/i.test(line));
  return lines.slice(-12).map((line) => {
    if (/password|secret|postgres:\/\/|reader-url|container\.env|POSTGRES_PASSWORD|hmac-key|admin-url/i.test(line)) return "[redacted diagnostic line]";
    return line.replace(/\b(?:waia_local_admin|postgres)\b/g, "[role]").slice(0, 400);
  });
}
async function readReadinessDiagnostics(id, readiness, healthStatus) {
  let state;
  try {
    const value = JSON.parse(run("docker", ["inspect", "--format", "{{json .State}}", id]));
    state = { status: value.Status, running: value.Running, exitCode: value.ExitCode,
      oomKilled: value.OOMKilled, error: value.Error ? "present" : "" };
    if (value.Health) state.health = { status: value.Health.Status, failingStreak: value.Health.FailingStreak,
      recent: Array.from(value.Health.Log ?? []).slice(-3).map((entry) => ({
        exitCode: entry.ExitCode,
        output: sanitizeLogTail(entry.Output),
      })) };
  } catch (error) { state = { inspectError: safeCode(error) }; }
  let logs = [];
  try { logs = sanitizeLogTail(run("docker", ["logs", "--tail", "40", id])); }
  catch (error) { logs = [`docker-logs-${safeCode(error)}`]; }
  return { readiness, healthStatus, state, logs };
}
function saveFailureReceipt(error, cleanup) {
  if (!attemptsDir || !existsSync(attemptsDir)) return;
  let attempt = 1;
  for (const entry of readdirSync(attemptsDir)) {
    const match = /^attempt-(\d+)\.json$/.exec(entry);
    if (match) attempt = Math.max(attempt, Number(match[1]) + 1);
  }
  const errorCode = typeof error?.code === "string" && /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : "UNCLASSIFIED";
  const stackFrames = typeof error?.stack === "string"
    ? error.stack.split(/\r?\n/).slice(1, 7).map((line) => line.trim().replaceAll(root, "<repo>").slice(0, 240))
    : [];
  const cleaned = cleanup.containerAbsent && cleanup.networkAbsent;
  const receipt = { schemaVersion: "waia.projection_native_fixture_attempt.v1",
    attempt, status: cleaned ? "FAILED_CLEANED" : "FAILED_CLEANUP_INCOMPLETE",
    stage, stageDetail, errorCode, stackFrames, diagnostics: stageDiagnostics,
    owned: { containerName: containerName ?? null, networkName: networkName ?? null,
      containerAbsent: cleanup.containerAbsent, networkAbsent: cleanup.networkAbsent },
    ownedResourcesCleaned: cleaned, secretsRecorded: false };
  const file = resolve(attemptsDir, `attempt-${attempt}.json`);
  writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  chmodSync(file, 0o600);
}
function cleanupOwnedResources() {
  if (createdContainer && containerName) {
    try { run("docker", ["rm", "--force", "--volumes", containerName]); } catch { /* absence verified below */ }
  }
  if (createdNetwork && networkName) {
    try { run("docker", ["network", "rm", networkName]); } catch { /* absence verified below */ }
  }
  let containerAbsent = !containerName;
  let networkAbsent = !networkName;
  if (containerName) {
    try {
      containerAbsent = run("docker", ["container", "ls", "--all", "--filter", `name=^/${containerName}$`, "--format", "{{.Names}}"])
        .split(/\r?\n/).filter(Boolean).length === 0;
    } catch { containerAbsent = false; }
  }
  if (networkName) {
    try {
      networkAbsent = run("docker", ["network", "ls", "--filter", `name=^${networkName}$`, "--format", "{{.Name}}"])
        .split(/\r?\n/).filter(Boolean).length === 0;
    } catch { networkAbsent = false; }
  }
  return { containerAbsent, networkAbsent };
}
async function prepareTls(id) {
  const caConfig = `[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=ca\n[dn]\nCN=WAIA disposable projection fixture TLS CA\n[ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n`;
  const serverConfig = `[req]\nprompt=no\ndistinguished_name=dn\n[dn]\nCN=${NETWORK_ALIAS}\n[server]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:${NETWORK_ALIAS},DNS:localhost,IP:127.0.0.1\n`;
  writePrivate("ca.cnf", caConfig);
  writePrivate("server.cnf", serverConfig);
  run("openssl", ["req", "-new", "-x509", "-nodes", "-newkey", "rsa:2048", "-days", "2", "-config", path("ca.cnf"),
    "-keyout", path("ca.key"), "-out", path("ca.crt")]);
  run("openssl", ["req", "-new", "-nodes", "-newkey", "rsa:2048", "-config", path("server.cnf"),
    "-keyout", path("server.key"), "-out", path("server.csr")]);
  run("openssl", ["x509", "-req", "-in", path("server.csr"), "-CA", path("ca.crt"), "-CAkey", path("ca.key"),
    "-CAserial", path("ca.srl"), "-CAcreateserial", "-days", "2", "-extfile", path("server.cnf"),
    "-extensions", "server", "-out", path("server.crt")]);
  const ca = readFileSync(path("ca.crt"), "utf8");
  const parsedCa = new X509Certificate(ca);
  if (!parsedCa.ca || parsedCa.subject !== parsedCa.issuer || !parsedCa.verify(parsedCa.publicKey)) refuse("CA_CERTIFICATE");
  chmodSync(path("ca.crt"), 0o444);
  run("docker", ["exec", id, "mkdir", "-p", "/tmp/waia-projection-native-tls"]);
  for (const name of ["server.crt", "server.key"]) run("docker", ["cp", path(name), `${id}:/tmp/waia-projection-native-tls/${name}`]);
  run("docker", ["exec", "-u", "root", id, "chown", "-R", "postgres:postgres", "/tmp/waia-projection-native-tls"]);
  run("docker", ["exec", "-u", "root", id, "chmod", "0644", "/tmp/waia-projection-native-tls/server.crt"]);
  run("docker", ["exec", "-u", "root", id, "chmod", "0600", "/tmp/waia-projection-native-tls/server.key"]);
  for (const statement of [
    "ALTER SYSTEM SET ssl_cert_file = '/tmp/waia-projection-native-tls/server.crt'",
    "ALTER SYSTEM SET ssl_key_file = '/tmp/waia-projection-native-tls/server.key'",
    "ALTER SYSTEM SET ssl = 'on'",
  ]) run("docker", ["exec", id, "psql", "-U", "waia_local_admin", "-d", DATABASE_NAME,
    "-v", "ON_ERROR_STOP=1", "-c", statement]);
  run("docker", ["restart", id]);
  await waitReady(id);
  return ca;
}
async function main() {
  if (!fixtureRoot || fixtureRoot === resolve("/")) refuse("FIXTURE_PATH_REQUIRED");
  if (!existsSync(resolve(root, "db/migrations_postgres/meta/_journal.json"))) refuse("PROJECT_ROOT_REQUIRED");
  if (existsSync(fixtureDir)) refuse("FIXTURE_PATH_ALREADY_EXISTS");
  stage = "verify-local-docker-context";
  const dockerContext = assertLocalDockerContext();
  mkdirSync(fixtureRoot, { recursive: true, mode: 0o700 });
  mkdirSync(attemptsDir, { recursive: true, mode: 0o700 });
  mkdirSync(fixtureDir, { recursive: true, mode: 0o700 });
  chmodSync(fixtureDir, 0o700);
  createdRuntimeDir = true;

  stage = "canonical-journal";
  const journalPath = resolve(root, "db/migrations_postgres/meta/_journal.json");
  const journalBytes = readFileSync(journalPath);
  const journal = JSON.parse(journalBytes.toString("utf8"));
  const entries = journal.entries;
  if (journal.version !== "7" || journal.dialect !== "postgresql" || entries.length !== 232 || entries[0]?.idx !== 0 ||
      entries[230]?.tag !== "0230_trader_observation_consent_revision_grants_v1" || entries[230]?.when !== 1780000000230 ||
      entries[231]?.idx !== 231 || entries[231]?.tag !== "0231_trader_observation_purpose_projection_v1" || entries[231]?.when !== 1780000000231 ||
      entries.some((entry, index) => entry.idx !== index || !/^(?:\d{4}|0)_/.test(entry.tag))) {
    refuse("CANONICAL_232_ENTRY_JOURNAL_REQUIRED");
  }

  stage = "inspect-local-image";
  const imageInfo = JSON.parse(run("docker", ["image", "inspect", IMAGE]))[0];
  if (!imageInfo?.Id || imageInfo.Config?.ExposedPorts?.["5432/tcp"] === undefined) refuse("LOCAL_PG17_IMAGE_REQUIRED");
  const randomTag = randomUUID().replaceAll("-", "").slice(0, 16);
  networkName = `waia-projection-native-net-${randomTag}`;
  containerName = `waia-projection-native-pg17-${randomTag}`;
  const pgPassword = randomBytes(36).toString("base64url");
  writePrivate("container.env", `POSTGRES_USER=waia_local_admin\nPOSTGRES_PASSWORD=${pgPassword}\nPOSTGRES_DB=${DATABASE_NAME}\n`);

  stage = "create-owned-network";
  run("docker", ["network", "create", "--driver", "bridge",
    "--label", "waia.fixture.owner=codex-projection-native",
    "--label", `waia.fixture.token=${randomTag}`, networkName]);
  createdNetwork = true;
  stage = "start-owned-postgres";
  run("docker", ["run", "--detach", "--pull=never", "--name", containerName,
    "--label", "waia.fixture.owner=codex-projection-native", "--label", `waia.fixture.token=${randomTag}`,
    "--memory", "768m", "--cpus", "0.5", "--network", networkName, "--network-alias", NETWORK_ALIAS,
    "--publish", "127.0.0.1::5432", "--env-file", path("container.env"),
    "--health-cmd", `pg_isready -U waia_local_admin -d ${DATABASE_NAME}`,
    "--health-interval", "1s", "--health-timeout", "2s", "--health-retries", "60", IMAGE]);
  createdContainer = true;
  stage = "wait-postgres-ready";
  await waitReady(containerName);
  const containerInspect = JSON.parse(run("docker", ["inspect", containerName]))[0];
  let hostPort = Number(containerInspect.NetworkSettings.Ports["5432/tcp"]?.[0]?.HostPort);
  const containerId = containerInspect.Id;
  stage = "verify-owned-local-port-binding";
  stageDiagnostics = {
    imageConfigured: containerInspect.Config.Image === IMAGE,
    portMappings: containerInspect.NetworkSettings.Ports["5432/tcp"] ?? null,
    hostPortParsed: Number.isInteger(hostPort),
  };
  if (!Number.isInteger(hostPort) || hostPort < 1024) refuse("LOCAL_BINDING_REQUIRED");
  if (containerInspect.Config.Image !== IMAGE) refuse("LOCAL_IMAGE_IDENTITY");

  stage = "configure-synthetic-tls";
  const ca = await prepareTls(containerName);
  const postTlsInspect = JSON.parse(run("docker", ["inspect", containerName]))[0];
  const postTlsPort = Number(postTlsInspect.NetworkSettings.Ports["5432/tcp"]?.[0]?.HostPort);
  stage = "verify-post-tls-local-port-binding";
  stageDiagnostics = {
    beforeTlsHostPort: hostPort,
    afterTlsHostPort: Number.isInteger(postTlsPort) ? postTlsPort : null,
    containerStatus: postTlsInspect.State.Status,
    healthStatus: postTlsInspect.State.Health?.Status ?? null,
    portMappings: postTlsInspect.NetworkSettings.Ports["5432/tcp"] ?? null,
  };
  if (!Number.isInteger(postTlsPort) || postTlsPort < 1024) refuse("POST_TLS_LOCAL_BINDING_REQUIRED");
  hostPort = postTlsPort;
  const tls = createAccountObservationDatabaseTlsOptions(ca);
  const adminPassword = pgPassword;
  const adminUrl = `postgres://waia_local_admin:${encodeURIComponent(adminPassword)}@127.0.0.1:${hostPort}/${DATABASE_NAME}`;
  const readerPassword = randomBytes(36).toString("base64url");
  const readerUrl = `postgres://${READER_LOGIN}:${encodeURIComponent(readerPassword)}@${NETWORK_ALIAS}:5432/${DATABASE_NAME}`;
  writePrivate("admin-url", `${adminUrl}\n`);
  writePrivate("reader-url", `${readerUrl}\n`);

  stage = "connect-and-bootstrap-migration-owner";
  adminSql = postgres(adminUrl, { max: 1, connect_timeout: 3, prepare: false, ssl: tls, onnotice: () => {} });
  const version = Number((await adminSql`SHOW server_version_num`)[0]?.server_version_num);
  if (version < 170000 || version >= 180000) refuse("POSTGRES_17_REQUIRED");
  await adminSql.unsafe(`CREATE ROLE dee960_local_owner NOLOGIN NOSUPERUSER NOBYPASSRLS CREATEROLE`);
  await adminSql.unsafe(`GRANT CREATE ON DATABASE "${DATABASE_NAME}" TO dee960_local_owner`);
  await adminSql.unsafe("GRANT USAGE, CREATE ON SCHEMA public TO dee960_local_owner WITH GRANT OPTION");
  await adminSql.begin(async (tx) => {
    await tx.unsafe("SET LOCAL ROLE dee960_local_owner");
    await tx.unsafe(readFileSync(resolve(root, "scripts/postgres-validation/prelude-auth-stub.sql"), "utf8"));
    await tx.unsafe("CREATE SCHEMA drizzle; CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint)");
  });
  await adminSql.unsafe("GRANT waia_historical_runner TO dee960_local_owner WITH ADMIN OPTION");
  stage = "apply-current-canonical-journal";
  await adminSql.unsafe("SET ROLE dee960_local_owner");
  try {
    await migratePostgresConnectionWithSessionLockBudget(adminSql, resolve(root, "db/migrations_postgres"));
  } finally {
    await adminSql.unsafe("RESET ROLE");
  }
  const applied = await adminSql`SELECT count(*)::integer AS count, min(created_at)::text AS first_at,
    max(created_at)::text AS last_at FROM drizzle.__drizzle_migrations`;
  const appliedRows = await adminSql`SELECT hash, created_at::text AS created_at
    FROM drizzle.__drizzle_migrations ORDER BY created_at, id`;
  const expectedMigrationRows = entries.map((entry) => ({
    hash: createHash("sha256").update(readFileSync(resolve(root, "db/migrations_postgres", `${entry.tag}.sql`))).digest("hex"),
    created_at: String(entry.when),
  }));
  if (applied.length !== 1 || applied[0].count !== entries.length ||
      applied[0].first_at !== String(entries[0].when) || applied[0].last_at !== String(entries[230].when) ||
      appliedRows.length !== expectedMigrationRows.length || appliedRows.some((row, index) =>
        row.hash !== expectedMigrationRows[index].hash || row.created_at !== expectedMigrationRows[index].created_at)) {
    refuse("MIGRATION_JOURNAL_NOT_APPLIED");
  }

  stage = "provision-reader-login";
  const readerEntry = ACCOUNT_OBSERVATION_LOGIN_PLAN.find((entry) => entry.purpose === "reader");
  if (!readerEntry || readerEntry.loginRole !== READER_LOGIN || readerEntry.parentRole !== READER_PARENT) refuse("READER_PLAN_MISMATCH");
  const provisioned = await provisionAccountObservationLoginsV1({
    WAIA_POSTGRES_ADMIN_SESSION_URL: adminUrl,
    [readerEntry.passwordEnv]: readerPassword,
  }, {
    plan: [readerEntry],
    openDatabase: (url) => postgres(url, { max: 1, connect_timeout: 3, prepare: false, ssl: tls, onnotice: () => {} }),
  });
  if (provisioned.status !== "OK" || provisioned.logins.length !== 1 || provisioned.logins[0].connectionLimit !== 2) {
    refuse("RESTRICTED_READER_PROVISIONING");
  }
  await adminSql.unsafe(`GRANT CONNECT ON DATABASE "${DATABASE_NAME}" TO "${READER_LOGIN}"`);

  stage = "seed-two-synthetic-tenants";
  const primary = makeBinding(randomUUID(), randomUUID(), "synthetic-projection-account-a", "projection-fixture-a");
  const secondary = makeBinding(randomUUID(), randomUUID(), "synthetic-projection-account-b", "projection-fixture-b");
  const primarySeed = await seedSyntheticTenant(adminSql, primary, "tenant-a");
  const secondarySeed = await seedSyntheticTenant(adminSql, secondary, "tenant-b");

  // The verification connection uses the same private fixture CA with an IP-SAN hostname.
  const localReaderUrl = new URL(readerUrl);
  localReaderUrl.hostname = "127.0.0.1";
  localReaderUrl.port = String(hostPort);
  runtimeSql = postgres(localReaderUrl.toString(), { ...observationPoolLimits, max: 1, ssl: tls, onnotice: () => {} });
  await probeObservationPool(runtimeSql, "reader");
  const [sessionTls] = await runtimeSql`SELECT ssl, version FROM pg_stat_ssl WHERE pid = pg_backend_pid()`;
  if (sessionTls?.ssl !== true || !/^TLSv1\.[23]$/.test(sessionTls.version)) refuse("READER_TLS_NOT_VERIFIED");
  const reader = createPostgresObservationReader(runtimeSql);
  const resolved = await reader.resolveActiveBinding({ organizationId: primary.organizationId,
    credentialId: primary.credentialId, exchangeAccountId: primary.exchangeAccountId });
  const snapshot = resolved ? await reader.readLatest(resolved) : null;
  if (!resolved || !snapshot || snapshot.observationId !== primarySeed.observationId) refuse("READER_FIXTURE_READBACK");
  const otherTenant = await reader.readLatest({ ...secondary, credentialRevision: "1" });
  if (otherTenant?.observationId !== secondarySeed.observationId) refuse("SECOND_TENANT_READBACK");
  const noCrossTenant = await reader.readLatest({ ...resolved, organizationId: secondary.organizationId });
  if (noCrossTenant !== null) refuse("TENANT_SCOPE_FENCE");

  stage = "verify-strict-reader-tls-and-scope";
  const hmacKey = randomBytes(32);
  writePrivate("hmac-key", hmacKey.toString("hex"));
  writePublic("test-ca.crt", ca);
  const config = {
    version: 1,
    deployment: "isolated-test",
    tuple: { audience: FIXED_ORIGIN, releaseSha: "a".repeat(40), epochId: randomUUID(), keyId: "local-fixture" },
    databaseHost: NETWORK_ALIAS,
    databasePort: 5432,
    databaseName: DATABASE_NAME,
  };
  writePrivate("config.json", `${JSON.stringify(config, null, 2)}\n`);
  const bindingMetadata = {
    schemaVersion: "waia.projection_native_fixture_bindings.v1",
    primary: { binding: primary, observationId: primarySeed.observationId },
    secondary: { binding: secondary, observationId: secondarySeed.observationId },
  };
  writePublic("bindings.json", `${JSON.stringify(bindingMetadata, null, 2)}\n`);
  for (const name of ["ca.key", "ca.srl", "ca.cnf", "server.key", "server.csr", "server.cnf", "server.crt", "container.env"]) {
    rmSync(path(name), { force: true });
  }
  rmSync(path("ca.crt"), { force: true });

  const networkInspect = JSON.parse(run("docker", ["network", "inspect", networkName]))[0];
  stage = "write-receipt-and-handoff";
  const receipt = {
    schemaVersion: FIXTURE_SCHEMA,
    status: "PREPARED",
    createdAtUtc: new Date().toISOString(),
    owner: "codex-projection-native",
    container: { name: containerName, id: containerId, image: IMAGE, imageId: imageInfo.Id,
      database: DATABASE_NAME, postgresMajor: 17, bindAddress: "127.0.0.1", hostPort,
      alias: NETWORK_ALIAS },
    network: { name: networkName, id: networkInspect.Id, internal: networkInspect.Internal,
      purpose: "owned-local-test-only", externalCallsMade: false },
    dockerContext,
    journal: { migrationCount: entries.length, hashCount: applied[0].count,
      sha256: createHash("sha256").update(journalBytes).digest("hex"),
      fullIdentityVerified: true,
      first: entries[0].tag, last: entries[230].tag },
    reader: { login: READER_LOGIN, parent: READER_PARENT, connectionLimit: 2,
      poolMax: 1, tls: "verified", seedCount: 2 },
    seeds: { primary: primarySeed, secondary: secondarySeed },
    tls: { caPath: path("test-ca.crt"), caFingerprint256: parsedFingerprint(ca),
      serverCertificateSans: [NETWORK_ALIAS, "localhost", "127.0.0.1"] },
    runtimeConfig: { path: path("config.json"), readerUrlPath: path("reader-url"),
      hmacKeyPath: path("hmac-key"), caPath: path("test-ca.crt"),
      containerMountPath: "/run/secrets/waia-projection" },
    bindingsPath: path("bindings.json"),
    adminUrlPath: path("admin-url"),
    files: ["admin-url", "reader-url", "hmac-key", "config.json"].map((name) => ({ path: path(name), mode: "0600" }))
      .concat([{ path: path("test-ca.crt"), mode: "0444" }, { path: path("bindings.json"), mode: "0444" }]),
    cleanup: { containerName, networkName },
  };
  writePrivate("receipt.json", `${JSON.stringify(receipt, null, 2)}\n`);
  await runtimeSql.end({ timeout: 5 }); runtimeSql = undefined;
  await adminSql.end({ timeout: 5 }); adminSql = undefined;
  handedOff = true;
  process.stdout.write(`${JSON.stringify({ status: "PREPARED", receiptPath: path("receipt.json"), containerName, hostPort })}\n`);
}
function parsedFingerprint(ca) { return new X509Certificate(ca).fingerprint256; }

main().catch(async (error) => {
  try { await runtimeSql?.end({ timeout: 2 }); } catch { /* cleanup continues */ }
  try { await adminSql?.end({ timeout: 2 }); } catch { /* cleanup continues */ }
  const cleanup = handedOff ? { containerAbsent: false, networkAbsent: false } : cleanupOwnedResources();
  if (!handedOff) {
    if (createdRuntimeDir) rmSync(fixtureDir, { recursive: true, force: true });
  }
  try { saveFailureReceipt(error, cleanup); } catch { /* original failure remains authoritative */ }
  const errorCode = typeof error?.code === "string" && /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : "UNCLASSIFIED";
  const cleanupStatus = cleanup.containerAbsent && cleanup.networkAbsent ? "CLEANED" : "CLEANUP_INCOMPLETE";
  process.stderr.write(`PROJECTION_NATIVE_FIXTURE_PREPARATION_FAILED:${stage}:${errorCode}; ${cleanupStatus}\n`);
  process.exitCode = 1;
});
