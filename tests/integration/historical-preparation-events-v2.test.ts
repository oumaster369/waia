import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPreparationAttemptJournalV2, readPreparationAttemptV2 } from "@/lib/trader/historical-simulation-v2/preparation-attempt-events-v2";
import { requireHistoricalSimulationRunnerLoginV2 } from "@/lib/trader/historical-simulation-v2/historical-runner-role-v2";

const inputUrl = process.env.WAIA_TEST_DEE958_PG_ADMIN_URL;
const organizationId = "3c50b4e9-1138-43a5-a29f-e65088124cfc";
const otherOrg = "11111111-1111-4111-8111-111111111111";
const releaseSha = "a".repeat(40), digest = "b".repeat(64);
const scope = { organizationId, runId: "preparation-test", releaseSha,
  requestId: randomUUID(), requestContentDigestHex: digest };
const otherRequest = randomUUID();
const suffix = randomUUID().slice(0, 8);
const database = `waia_test_dee958_${suffix}`, ownerRole = `waia958_admin_${suffix}`;
let admin: postgres.Sql, owner: postgres.Sql, runner: postgres.Sql;
let browser: postgres.Sql;

describe.skipIf(!inputUrl)("DEE-958 actual PostgreSQL17 restricted-owner migration and runner RLS", () => {
  beforeAll(async () => {
    const url = new URL(inputUrl!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw Error("LOCAL_DATABASE_ONLY");
    admin = postgres(url.toString(), { max: 1 });
    expect((await admin`SHOW server_version_num`)[0]!.server_version_num).toMatch(/^17/);
    await admin.unsafe(`CREATE ROLE ${ownerRole} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    await admin.unsafe(`CREATE DATABASE ${database}`);
    url.pathname = `/${database}`;
    owner = postgres(url.toString(), { max: 1 });
    runner = postgres(url.toString(), { max: 1 });
    browser = postgres(url.toString(), { max: 1 });
    await owner.unsafe(`GRANT USAGE,CREATE ON SCHEMA public TO ${ownerRole}; SET ROLE ${ownerRole}`);
    const [role] = await owner`SELECT rolsuper,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=current_user`;
    expect(role).toMatchObject({ rolsuper: false, rolcreaterole: false, rolbypassrls: false });
    // Minimal authoritative predecessor contracts, not scientific/runtime fixtures.
    await owner.unsafe(`CREATE TABLE organizations(id uuid PRIMARY KEY);
      CREATE TABLE trader_historical_ratification_request_v2(
        id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
        run_id text NOT NULL, release_sha text NOT NULL, content_digest_hex text NOT NULL,
        UNIQUE(id,organization_id,run_id,content_digest_hex));
      CREATE TABLE trader_historical_technical_proposal_v2(
        id uuid PRIMARY KEY, request_id uuid NOT NULL, organization_id uuid NOT NULL,
        run_id text NOT NULL, release_sha text NOT NULL, request_content_digest_hex text NOT NULL);
      CREATE FUNCTION waia_historical_ratification_split_v2_block_mutation() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'IMMUTABLE'; END $$;
      CREATE TABLE computation_probe(n integer);
      GRANT SELECT ON trader_historical_ratification_request_v2,
        trader_historical_technical_proposal_v2 TO waia_historical_runner;
      ALTER TABLE trader_historical_ratification_request_v2 ENABLE ROW LEVEL SECURITY;
      CREATE POLICY request_runner_read ON trader_historical_ratification_request_v2
        FOR SELECT TO waia_historical_runner USING(organization_id='${organizationId}'::uuid);`);
    await owner`INSERT INTO organizations VALUES (${organizationId}),(${otherOrg})`;
    await owner`INSERT INTO trader_historical_ratification_request_v2 VALUES
      (${scope.requestId},${organizationId},${scope.runId},${releaseSha},${digest}),
      (${otherRequest},${otherOrg},${scope.runId},${releaseSha},${digest})`;
    const migration = await readFile("db/migrations_postgres/0204_historical_preparation_events_v2.sql", "utf8");
    for (const statement of migration.split("--> statement-breakpoint")) await owner.unsafe(statement);
    await runner.unsafe("SET ROLE waia_historical_runner");
    expect((await runner`SELECT current_user AS role`)[0]!.role).toBe("waia_historical_runner");
    process.stdout.write(`DEE958_LOCAL_DATABASE=${database}\n`);
  }, 30_000);
  afterAll(async () => { await Promise.all([admin, owner, runner, browser].filter(Boolean).map(pool => pool.end())); });

  it("uses the real constrained LOGIN and two pools, retaining failure after compute disconnect", async () => {
    const login = "waia_historical_runner_login";
    // Public synthetic LOCAL fixture only; never a production credential. An
    // existing role is not altered or rotated by this test.
    const password = "waia_dee958_local_test_login_only_20260907";
    if (!(await admin`SELECT 1 FROM pg_roles WHERE rolname=${login}`).length) {
      const provisioner = await import(new URL("../../scripts/ops/provision-historical-runner-login.mjs", import.meta.url).href);
      await provisioner.provisionHistoricalRunnerLoginV2({
        WAIA_POSTGRES_ADMIN_SESSION_URL: inputUrl,
        WAIA_HISTORICAL_RUNNER_DB_PASSWORD: password,
      });
    }
    const url = new URL(inputUrl!); url.pathname = `/${database}`;
    url.username = login; url.password = password;
    const compute = postgres(url.toString(), { max: 1, connect_timeout: 3 });
    const events = postgres(url.toString(), { max: 1, connect_timeout: 3,
      connection: { statement_timeout: 10_000, lock_timeout: 3_000 } });
    const excess = postgres(url.toString(), { max: 1, connect_timeout: 3 });
    try {
      await requireHistoricalSimulationRunnerLoginV2(compute);
      const [{ pid }] = await compute<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      await compute.unsafe("BEGIN");
      const journal = await createPreparationAttemptJournalV2(events, scope);
      const [{ count }] = await admin`SELECT count(*)::int AS count FROM pg_stat_activity
        WHERE usename=${login} AND datname=${database}`;
      expect(count).toBe(2);
      await expect(excess`SELECT 1`).rejects.toMatchObject({ code: "53300" });
      journal.progress({ schemaVersion: "waia.trader.technical_preparation_progress.v2",
        organizationId, runId: scope.runId, releaseSha, authorityGranted: false,
        phase: "SURFACE_LOAD", surfaceKey: "BTCUSDT:30", completed: 1, total: 4 });
      await admin`SELECT pg_terminate_backend(${pid!})`;
      await compute.end({ timeout: 0 });
      await journal.fail(Object.assign(new Error("local compute disconnected"), { code: "CONNECTION_CLOSED" }));
      expect(await readPreparationAttemptV2(owner, scope)).toMatchObject({
        attemptId: journal.attemptId, phase: "FAILED", errorCode: "CONNECTION_LOST", authorityGranted: false });
      expect(await owner`SELECT * FROM trader_historical_technical_proposal_v2`).toHaveLength(0);
    } finally { await Promise.all([compute, events, excess].map(pool => pool.end({ timeout: 1 }))); }
  }, 20_000);

  async function event(attempt: string, sequence: number, phase: string, error: string | null = null) {
    return runner`INSERT INTO trader_historical_preparation_event_v2
      (organization_id,run_id,release_sha,request_id,request_content_digest_hex,
       attempt_id,event_sequence,phase,error_code)
      VALUES (${organizationId},${scope.runId},${releaseSha},${scope.requestId},${digest},
        ${attempt},${sequence},${phase},${error}) RETURNING id`;
  }
  it("commits STARTED and FAILED independently of compute rollback", async () => {
    const attempt = randomUUID();
    await owner.unsafe("BEGIN"); await owner`INSERT INTO computation_probe VALUES (1)`;
    await event(attempt, 0, "STARTED");
    await owner.unsafe("ROLLBACK");
    expect(await owner`SELECT * FROM computation_probe`).toHaveLength(0);
    await event(attempt, 1, "FAILED", "CONNECTION_LOST");
    expect(await readPreparationAttemptV2(owner, scope)).toMatchObject({
      attemptId: attempt, phase: "FAILED", errorCode: "CONNECTION_LOST", authorityGranted: false });
    expect(await owner`SELECT * FROM trader_historical_technical_proposal_v2`).toHaveLength(0);
  });
  it("keeps newer STARTED as unconfirmed and refuses a stale failure", async () => {
    const old = randomUUID(), current = randomUUID();
    await event(old, 0, "STARTED"); await event(current, 0, "STARTED");
    await expect(event(old, 1, "FAILED", "PREPARATION_FAILED")).rejects.toMatchObject({ code: "23514" });
    expect(await readPreparationAttemptV2(owner, scope)).toMatchObject({ attemptId: current, phase: "STARTED" });
    await expect(event(current, 2, "FAILED", "PREPARATION_FAILED")).rejects.toMatchObject({ code: "23514" });
    await event(current, 1, "FAILED", "PREPARATION_FAILED");
    await expect(event(current, 2, "FAILED", "PREPARATION_FAILED")).rejects.toMatchObject({ code: "23514" });
  });
  it("rejects cross-org inserts, release substitution, and wrong-scope reads", async () => {
    await expect(runner`INSERT INTO trader_historical_preparation_event_v2
      (organization_id,run_id,release_sha,request_id,request_content_digest_hex,attempt_id,event_sequence,phase)
      VALUES (${otherOrg},${scope.runId},${releaseSha},${otherRequest},${digest},${randomUUID()},0,'STARTED')`)
      .rejects.toThrow();
    await expect(runner`INSERT INTO trader_historical_preparation_event_v2
      (organization_id,run_id,release_sha,request_id,request_content_digest_hex,attempt_id,event_sequence,phase)
      VALUES (${organizationId},${scope.runId},${"c".repeat(40)},${scope.requestId},${digest},${randomUUID()},0,'STARTED')`)
      .rejects.toMatchObject({ code: "23514" });
    expect(await readPreparationAttemptV2(runner, { ...scope, organizationId: otherOrg, requestId: otherRequest })).toBeNull();
    expect(await readPreparationAttemptV2(runner, { ...scope, runId: "other" })).toBeNull();
  });
  it("denies runner mutation, forged DB ordering/timestamps, and browser access", async () => {
    for (const privilege of ["UPDATE", "DELETE", "TRUNCATE"]) {
      const [row] = await runner`SELECT has_table_privilege(current_user,
        'trader_historical_preparation_event_v2',${privilege}) AS granted`;
      expect(row!.granted).toBe(false);
    }
    await expect(runner.unsafe("DELETE FROM trader_historical_preparation_event_v2")).rejects.toMatchObject({ code: "42501" });
    await expect(runner.unsafe("UPDATE trader_historical_preparation_event_v2 SET phase='FAILED'")).rejects.toMatchObject({ code: "42501" });
    await expect(runner.unsafe("TRUNCATE trader_historical_preparation_event_v2")).rejects.toMatchObject({ code: "42501" });
    await expect(runner`INSERT INTO trader_historical_preparation_event_v2
      (id,organization_id,run_id,release_sha,request_id,request_content_digest_hex,attempt_id,event_sequence,phase)
      OVERRIDING SYSTEM VALUE VALUES (999999,${organizationId},${scope.runId},${releaseSha},${scope.requestId},
        ${digest},${randomUUID()},0,'STARTED')`).rejects.toMatchObject({ code: "42501" });
    await expect(runner`INSERT INTO trader_historical_preparation_event_v2
      (observed_at,organization_id,run_id,release_sha,request_id,request_content_digest_hex,attempt_id,event_sequence,phase)
      VALUES ('2099-01-01',${organizationId},${scope.runId},${releaseSha},${scope.requestId},
        ${digest},${randomUUID()},0,'STARTED')`).rejects.toMatchObject({ code: "42501" });
    for (const role of ["anon", "authenticated"]) {
      await browser.unsafe(`RESET ROLE; SET ROLE ${role}`);
      await expect(browser.unsafe("SELECT * FROM trader_historical_preparation_event_v2")).rejects.toMatchObject({ code: "42501" });
    }
  });
  it("bounds a diagnostic lock wait independently from compute", async () => {
    const key = `historical-preparation-events:${scope.requestId}`;
    await owner`SELECT pg_advisory_lock(hashtextextended(${key},0))`;
    try {
      await runner.unsafe("SET statement_timeout='200ms'");
      await expect(event(randomUUID(), 0, "STARTED")).rejects.toMatchObject({ code: "57014" });
    } finally {
      await runner.unsafe("RESET statement_timeout");
      await owner`SELECT pg_advisory_unlock(hashtextextended(${key},0))`;
    }
  });
  it("cannot turn a diagnostic terminal into a proposal", async () => {
    const attempt = randomUUID(); await event(attempt, 0, "STARTED");
    await expect(runner`INSERT INTO trader_historical_preparation_event_v2
      (organization_id,run_id,release_sha,request_id,request_content_digest_hex,attempt_id,event_sequence,phase,proposal_id)
      VALUES (${organizationId},${scope.runId},${releaseSha},${scope.requestId},${digest},${attempt},1,
        'PROPOSAL_AVAILABLE',${randomUUID()})`).rejects.toMatchObject({ code: "23514" });
  });
});
