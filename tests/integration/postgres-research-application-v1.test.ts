import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import postgres from "postgres";
import { beforeAll, beforeEach, afterEach, afterAll, describe, expect, it, vi } from "vitest";
import { seedWp13User } from "./wp13-intelligence-test-helpers";
import { assertRecordedAnalysisTestDatabase } from "../helpers/recorded-paper-public-transport";
import { seedApplicationNative } from "../helpers/research-application-v1-process";
import { runSavedApplication } from "@/lib/trader/paper/research-application-v1/run-saved-application";
import { HeldResearchAccounting, prepareHeldResearchReplay } from "@/lib/trader/paper/research-understanding-v1/held-replay";
import type { SavedApplicationRequest } from "@/lib/trader/paper/research-application-v1/repository-postgres";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema.postgres";
import { readApplicationRows, applicationScope, admitApplicationWriteRow } from "@/lib/trader/paper/research-application-v1/bounded-read-postgres";
import { APPLICATION_LIMITS as limits, applicationDigest } from "@/lib/trader/paper/research-application-v1/contract";
import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";
import { createPostgresRuntimeControlLeaseRepositoryV2 } from "@/lib/trader/runtime-authority/v2/runtime-authority-repository-postgres-v2";

const url = process.env.DATABASE_URL_POSTGRES?.trim();
const enabled = process.env.WAIA_PG_INTEGRATION === "1" && !!url;
const assignment = "trader_research_application_assignments_v1", application = "trader_research_applications_v1",
  availability = "trader_research_application_availability_v1", consumption = "trader_research_application_consumptions_v1";
const owned = [assignment, application, availability, consumption];
const canonical = ["trader_mi_canonical_measurement_definition_v1", "trader_mi_canonical_measurement_value_v1", "trader_mi_canonical_measurement_value_input_v1"];
const tables = [...owned, ...canonical, "audit_logs"];
const fault = "dee1132_application_fault";
const children = new Set<ChildProcess>();
type Fixture = Awaited<ReturnType<typeof seedApplicationNative>>;
type Result = Awaited<ReturnType<typeof runSavedApplication>>;
type Event = { event: string; result: Result; forbidden: string[]; fetches: number; message?: string };
function worker(args: string[], holdAfterResult = false) {
  const child = spawn(process.execPath, ["--import", "tsx", "--conditions=react-server", "tests/helpers/research-application-v1-process.ts"], {
    cwd: process.cwd(), env: { PATH: process.env.PATH, CI: process.env.CI, NODE_ENV: "test", WAIA_PG_INTEGRATION: "1", WAIA_TRADER_CLI: "1",
      WAIA_POSTGRES_CLI: "1", WAIA_DB_BACKEND: "postgres", WAIA_POSTGRES_PER_REQUEST_CLIENT: "true", DATABASE_URL_POSTGRES: url,
      WAIA_APPLICATION_TEST_PAYLOAD: JSON.stringify({ args, holdAfterResult }) }, stdio: ["ignore", "pipe", "pipe"] });
  children.add(child); let buffer = "", errors = "";
  const result = new Promise<Event>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`APPLICATION_CHILD_TIMEOUT:${errors}`)), 125000);
    child.stdout!.on("data", chunk => { buffer += String(chunk); const lines = buffer.split("\n"); buffer = lines.pop()!;
      for (const line of lines) { let event: Event; try { event = JSON.parse(line); } catch { continue; }
        if (["result", "error"].includes(event.event)) { clearTimeout(timer); resolve(event); } } });
    child.stderr!.on("data", chunk => { errors += String(chunk); });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("exit", (code, signal) => { clearTimeout(timer); if (code || signal) reject(new Error(`APPLICATION_CHILD_EXIT:${code}:${signal}:${errors}`)); });
  });
  return { child, result };
}
async function stop(child: ChildProcess) {
  if (child.exitCode === null && child.signalCode === null) { const exited = once(child, "exit"); child.kill("SIGKILL"); await exited; }
  children.delete(child);
}
function complete(result: Result) {
  expect(result.status).toBe("COMPLETE"); if (!("application" in result)) throw new Error(`APPLICATION_NOT_COMPLETE:${result.status}`); return result;
}
describe.skipIf(!enabled)("Postgres saved research application actual producer/consumer", () => {
  let client: postgres.Sql, organizationId: string, userId: string, directory: string;
  const trace: Array<{ query: string; params: unknown[] }> = [];
  const fixture = (options: Parameters<typeof seedApplicationNative>[3] = {}) => seedApplicationNative(client, organizationId, userId, options);
  const run = (request: SavedApplicationRequest) => runSavedApplication(client, { organizationId }, request);
  async function counts() { return Promise.all(tables.map(async table => Number((await client.unsafe(
    `select count(*)::int n from ${table} where organization_id=$1::uuid${table === "audit_logs" ? " and action like 'trader.research_application.%'" : ""}`, [organizationId]))[0]!.n))); }
  async function clearFault() {
    for (const table of [...tables, "trader_runtime_control_lease_heads_v2"]) {
      await client.unsafe(`drop trigger if exists ${fault} on ${table}`);
      await client.unsafe(`drop trigger if exists zz_${fault} on ${table}`);
    }
    await client.unsafe(`drop function if exists ${fault}()`);
  }
  async function faultAt(table: string, timing: "BEFORE" | "AFTER", body = "RAISE EXCEPTION 'DEE1132_INJECTED';", auditOperation?: string, triggerLast = false) {
    expect([...tables, "trader_runtime_control_lease_heads_v2"]).toContain(table);
    const extra = table === "audit_logs" ? ` AND NEW.action='trader.research_application.${auditOperation ?? "apply"}'` : "";
    await client.unsafe(`create function ${fault}() returns trigger language plpgsql as $$ begin
      if NEW.organization_id='${organizationId}'::uuid${extra} then ${body} end if; return NEW; end $$`);
    await client.unsafe(`create trigger ${triggerLast ? "zz_" : ""}${fault} ${timing} insert on ${table} for each row execute function ${fault}()`);
  }
  async function argsFor(f: Fixture, operation: SavedApplicationRequest["operation"] = "apply", consumerSequence?: number) {
    const file = path.join(directory, "application.json");
    await writeFile(file, JSON.stringify({ configuration: f.application.configuration, research: f.application.research }));
    return ["--saved-research-application", `--application-file=${file}`, `--operation=${operation}`, "--previous-sequence=0", "--current-sequence=1",
      ...(consumerSequence === undefined ? [] : [`--consumer-sequence=${consumerSequence}`])];
  }
  beforeAll(async () => {
    assertRecordedAnalysisTestDatabase(url);
    client = postgres(url!, { max: 4, debug: (_connection, query, params) => trace.push({ query, params: [...params] }) });
    // This test never manufactures/repairs a predecessor or journal. Root/CI must apply the complete chain.
    const rows = await client`select count(*)::int n from drizzle.__drizzle_migrations where created_at in (1780000000221,1780000000222,1780000000223)`;
    expect(rows[0]!.n).toBe(3);
  });
  beforeEach(async () => { userId = randomUUID(); organizationId = await seedWp13User(url!, userId, "DEE1132 isolated application");
    directory = await mkdtemp(path.join(tmpdir(), "dee1132-native-")); trace.length = 0; });
  afterEach(async () => { vi.restoreAllMocks(); await Promise.all([...children].map(stop)); await clearFault(); await rm(directory, { recursive: true, force: true }); });
  afterAll(async () => { await client?.end({ timeout: 3 }); });

  it("actual early CLI applies FOR, persists raw canonical JSON, then consumes genuinely later nonadjacent B and replays after process death", async () => {
    const f = await fixture(); const before = await counts();
    const first = worker(await argsFor(f), true); const event = await first.result;
    expect(event.event).toBe("result"); expect(event.fetches).toBe(0); expect(event.forbidden).toEqual([]);
    const applied = complete(event.result); expect(applied.disposition).toBe("OBSERVED_FOR");
    expect(applied.application.meaning.direction).toBe("FOR"); expect(applied.application.relation).toMatchObject({ verified: false, confidenceState: "NOT_ASSESSED" });
    expect(applied.availability.availableAt > applied.application.current.analysisPitAnchor).toBe(true);
    await stop(first.child);
    // Raw server JSON types are checked before Drizzle mapping could hide wire double serialization.
    expect(await client`select distinct jsonb_typeof(definition_json) kind from trader_mi_canonical_measurement_definition_v1 where organization_id=${organizationId}::uuid`).toEqual([{ kind: "object" }]);
    expect(await client`select distinct jsonb_typeof(input_lineage_json) kind from trader_mi_canonical_measurement_value_v1 where organization_id=${organizationId}::uuid`).toEqual([{ kind: "array" }]);
    const afterApply = await counts(); expect(afterApply.slice(0, 4)).toEqual([1, 1, 1, 0]); expect(afterApply[7]).toBe(before[7]! + 2);
    const restarted = complete((await worker(await argsFor(f)).result).result);
    expect(restarted.outcome).toBe("REPLAYED"); expect(restarted.application).toEqual(applied.application); expect(restarted.availability).toEqual(applied.availability); expect(await counts()).toEqual(afterApply);
    await f.appendThrough(3); expect(f.packets[3]!.analysisPitAnchor > applied.availability.availableAt).toBe(true);
    const consumed = complete((await worker(await argsFor(f, "consume", 3)).result).result);
    expect(consumed.consumption?.fold?.researchJudgments[0]?.ordinalJudgment).toBe("WEAKENED");
    expect(consumed.consumption?.selection?.selectedRelations).toHaveLength(1);
    expect(consumed.consumption?.sequence).toBe(0); expect(consumed.consumption?.consumer.sourceSequence).toBe(3);
    expect(consumed.consumption?.fold).not.toHaveProperty("hypotheses");
    const after = await counts(); expect(after.slice(0, 4)).toEqual([1, 1, 1, 1]);
    const replay = complete((await worker(await argsFor(f, "replay", 3)).result).result);
    expect(replay.consumption).toEqual(consumed.consumption); expect(replay.consumptionDigest).toBe(consumed.consumptionDigest); expect(await counts()).toEqual(after);
  }, 90000);
  it("actual opposing4h input produces AGAINST/CONTESTED research output without a confidence judgment", async () => {
    const f = await fixture({ against: true }); const value = complete(await run(f.application)); expect(value.disposition).toBe("OBSERVED_AGAINST");
    await f.appendThrough(3); const consumed = complete(await run({ ...f.application, operation: "consume", consumerSourceSequence: 3 }));
    expect(consumed.consumption?.fold?.researchJudgments[0]?.ordinalJudgment).toBe("CONTESTED");
    expect(consumed.application.evidence?.confidenceState).toBe("NOT_ASSESSED");
  }, 45000);
  it("actual missing4h remains a durable unassessed result with no padded relation", async () => {
    const f = await fixture({ missing4h: true }); const value = complete(await run(f.application));
    expect(value.disposition).toBe("UNASSESSED_INPUT"); expect(value.application.evidence).toBeNull(); expect(value.application.relation).toBeNull();
    await f.appendThrough(3); const consumed = complete(await run({ ...f.application, operation: "consume", consumerSourceSequence: 3 }));
    expect(consumed.disposition).toBe("UNASSESSED_APPLICATION"); expect(consumed.consumption?.fold).toBeNull(); expect(consumed.consumption?.selection).toBeNull();
  }, 45000);
  it.each([...canonical, application, "audit_logs"])("AFTER%s failure atomically rolls back canonical/audit/application then a valid retry is unique", async table => {
    const f = await fixture(); const before = await counts(); await faultAt(table, "AFTER");
    await expect(run(f.application)).rejects.toThrow(); expect(await counts()).toEqual(before);
    await clearFault(); await f.expiry(); complete(await run(f.application));
    const after = await counts(); expect(after.slice(0, 4)).toEqual([1, 1, 1, 0]); complete(await run(f.application)); expect(await counts()).toEqual(after);
  }, 30000);
  it.each([availability, "audit_logs"])("availability%s failure preserves prior committed application and resumes only the certificate", async table => {
    const f = await fixture(); await faultAt(table, "AFTER", "RAISE EXCEPTION 'DEE1132_INJECTED';", "availability");
    await expect(run(f.application)).rejects.toThrow(); const retained = await counts(); expect(retained.slice(0, 4)).toEqual([1, 1, 0, 0]); expect(retained[7]).toBe(1);
    const app = await client`select * from trader_research_applications_v1 where organization_id=${organizationId}::uuid`;
    await clearFault(); await f.expiry(); complete(await run(f.application));
    expect(await client`select * from trader_research_applications_v1 where organization_id=${organizationId}::uuid`).toEqual(app);
    expect((await counts()).slice(0, 4)).toEqual([1, 1, 1, 0]);
  }, 30000);
  it.each([consumption, "audit_logs"])("consume%s failure preserves application/certificate and retry does not duplicate audit", async table => {
    const f = await fixture(); complete(await run(f.application)); await f.appendThrough(3); const before = await counts();
    await faultAt(table, "AFTER", "RAISE EXCEPTION 'DEE1132_INJECTED';", "consume");
    const input: SavedApplicationRequest = { ...f.application, operation: "consume", consumerSourceSequence: 3 };
    await expect(run(input)).rejects.toThrow(); expect(await counts()).toEqual(before);
    await clearFault(); await f.expiry(); complete(await run(input)); const after = await counts(); complete(await run(input)); expect(await counts()).toEqual(after);
  }, 40000);
  it.each([application, availability, consumption])("a no-op%s insert cannot fence this stage's canonical/audit writes", async table => {
    const f = await fixture(); if (table === consumption) { complete(await run(f.application)); await f.appendThrough(3); }
    const before = await counts(); await faultAt(table, "BEFORE", "RETURN NULL;");
    const input: SavedApplicationRequest = { ...f.application, ...(table === consumption ? { operation: "consume", consumerSourceSequence: 3 } as const : {}) };
    expect((await run(input)).status).toBe("APPLICATION_FENCED_INSERT_REQUIRED");
    const after = await counts();
    if (table === availability) { expect(after.slice(0, 4)).toEqual([1, 1, 0, 0]); expect(after[7]).toBe(1); }
    else expect(after).toEqual(before);
    await clearFault(); await f.expiry(); complete(await run(input));
    const recovered = await counts(); complete(await run(input)); expect(await counts()).toEqual(recovered);
  }, 40000);
  it.each([application, availability, consumption])("expired holder at%s refuses late completion and never commits an unfenced new stage", async table => {
    const f = await fixture(); if (table === consumption) { complete(await run(f.application)); await f.appendThrough(3); }
    const before = await counts(); await faultAt(table, "AFTER", "PERFORM pg_sleep(2.0);");
    const input: SavedApplicationRequest = { ...f.application, ...(table === consumption ? { operation: "consume", consumerSourceSequence: 3 } as const : {}) };
    const result = await run(input).catch(() => null); expect(result?.status).not.toBe("COMPLETE");
    const after = await counts();
    if (table === availability) { expect(after.slice(0, 4)).toEqual([1, 1, 0, 0]); expect(after[7]).toBe(1); }
    else expect(after).toEqual(before);
    await clearFault(); await f.expiry(); complete(await run(input));
    const recovered = await counts(); complete(await run(input)); expect(await counts()).toEqual(recovered);
  }, 40000);
  it("still refuses expired completion when a fixture changes deferred constraint timing", async () => {
    const f = await fixture(); const before = await counts();
    // The last AFTER trigger flushes the earlier queued fence before delaying.
    // This tests the owner's post-write check, not an unconditional commit fence.
    await faultAt(application, "AFTER", "SET CONSTRAINTS ALL IMMEDIATE; PERFORM pg_sleep(2.0);", undefined, true);
    const value = await run(f.application); expect(value.status).toBe("LEASE_LOST"); expect(await counts()).toEqual(before);
  }, 30000);
  it("two native connections cannot fork the same natural key or duplicate canonical/audit effects", async () => {
    const f = await fixture(); const second = postgres(url!, { max: 1 });
    try {
      const values = await Promise.all([client, second].map(pool => runSavedApplication(pool, { organizationId }, f.application)));
      expect(values.some(v => v.status === "COMPLETE")).toBe(true);
      expect(values.every(v => ["COMPLETE", "APPLICATION_LEASE_BUSY"].includes(v.status))).toBe(true);
      expect((await counts()).slice(0, 4)).toEqual([1, 1, 1, 0]); expect((await counts())[7]).toBe(2);
    } finally { await second.end({ timeout: 3 }); }
  }, 30000);
  it("serializes a real shared-assignment consumption prefix across two different applications", async () => {
    const f = await fixture(); complete(await run(f.application)); await f.appendThrough(2);
    const second: SavedApplicationRequest = { ...f.application, previousSourceSequence: 1, currentSourceSequence: 2 };
    complete(await run(second)); await f.appendThrough(3);
    const firstConsumption = complete(await run({ ...f.application, operation: "consume", consumerSourceSequence: 3 }));
    await f.expiry();
    const secondConsumption = complete(await run({ ...second, operation: "consume", consumerSourceSequence: 3 }));
    expect(firstConsumption.consumption?.sequence).toBe(0); expect(secondConsumption.consumption?.sequence).toBe(1);
    expect(secondConsumption.consumption?.previousConsumptionDigest).toBe(firstConsumption.consumptionDigest);
    const before = await counts();
    expect(complete(await run({ ...second, operation: "replay", consumerSourceSequence: 3 })).consumption).toEqual(secondConsumption.consumption);
    expect(await counts()).toEqual(before); expect(before.slice(0, 4)).toEqual([1, 2, 2, 2]);
  }, 60000);
  it("pins the actual command's claim to RC/5s/30s even with hostile session defaults", async () => {
    const f = await fixture();
    await faultAt("trader_runtime_control_lease_heads_v2", "BEFORE", `IF current_setting('transaction_isolation') <> 'read committed'
      OR current_setting('lock_timeout') <> '5s' OR current_setting('statement_timeout') <> '30s'
      THEN RAISE EXCEPTION 'WRONG_APPLICATION_CLAIM_POSTURE'; END IF;`);
    const hostile = postgres(url!, { max: 1, connection: { default_transaction_isolation: "repeatable read", lock_timeout: 0, statement_timeout: 0 } });
    try { complete(await runSavedApplication(hostile, { organizationId }, f.application)); }
    finally { await hostile.end({ timeout: 3 }); }
  }, 30000);
  it("refuses a changed current source descriptor without repairing saved source truth", async () => {
    const f = await fixture(); const before = await counts();
    const saved = await client`select content_digest,body_json from trader_recorded_analysis_packets_v1 where organization_id=${organizationId}::uuid order by sequence`;
    await client`update trader_mi_source set symbol='ETH/USDT' where organization_id=${organizationId}::uuid`;
    const changed = await client`select id,symbol from trader_mi_source where organization_id=${organizationId}::uuid order by id`;
    expect((await run(f.application)).status).not.toBe("COMPLETE"); expect(await counts()).toEqual(before);
    expect(await client`select content_digest,body_json from trader_recorded_analysis_packets_v1 where organization_id=${organizationId}::uuid order by sequence`).toEqual(saved);
    expect(await client`select id,symbol from trader_mi_source where organization_id=${organizationId}::uuid order by id`).toEqual(changed);
  }, 30000);
  it("rejects B created before availability and permits its genuine later successor", async () => {
    const f = await fixture(); await f.appendThrough(2); complete(await run(f.application)); await f.expiry(); const before = await counts();
    expect((await run({ ...f.application, operation: "consume", consumerSourceSequence: 2 })).status).toBe("APPLICATION_NOT_YET_AVAILABLE"); expect(await counts()).toEqual(before);
    await f.appendThrough(3); complete(await run({ ...f.application, operation: "consume", consumerSourceSequence: 3 }));
  }, 45000);
  it("retains original saved USER assignment identity and checks current application USER membership", async () => {
    const f = await fixture({ userAssignment: true }); const before = await counts();
    expect((await run(f.application)).status).not.toBe("COMPLETE"); expect(await counts()).toEqual(before); await f.expiry();
    complete(await runSavedApplication(client, f.context, f.application)); const after = await counts();
    await expect(runSavedApplication(client, { organizationId, userId: randomUUID() }, { ...f.application, operation: "replay" })).rejects.toThrow(); expect(await counts()).toEqual(after);
  }, 30000);
  it("uses RR read-only restart, RC before first claim lock, and bounded bodies for only P/A/B", async () => {
    const f = await fixture(); trace.length = 0;
    const statements = vi.spyOn(HeldResearchAccounting.prototype, "beforeStatement");
    const finalization = vi.spyOn(HeldResearchAccounting.prototype, "beforeFinalizationStatement");
    complete(await run(f.application));
    expect(trace.length).toBe(statements.mock.calls.length + finalization.mock.calls.length);
    statements.mockRestore(); finalization.mockRestore();
    const start = trace.findIndex(r => /begin isolation level read committed/i.test(r.query));
    expect(start).toBeGreaterThan(-1); const firstLock = trace.findIndex((r, i) => i > start && r.query.includes("pg_advisory_xact_lock"));
    expect(trace.slice(start, firstLock).some(r => r.query.includes("lock_timeout"))).toBe(true);
    expect(trace.slice(start, firstLock).some(r => r.query.includes("statement_timeout"))).toBe(true);
    expect(trace.filter(r => !r.query.toLowerCase().startsWith("select pg_sleep")).length).toBeLessThanOrEqual(512);
    await f.appendThrough(3); trace.length = 0; complete(await run({ ...f.application, operation: "consume", consumerSourceSequence: 3 }));
    const bodies = trace.filter(r => r.query.includes('"trader_recorded_analysis_packets_v1"') && !r.query.includes("octet_length"));
    expect(bodies.length).toBeGreaterThan(0); expect(bodies.every(r => !r.params.includes(2))).toBe(true);
    const before = await counts(); const readonly = postgres(url!, { max: 1, connection: { default_transaction_read_only: true } });
    try { complete(await runSavedApplication(readonly, { organizationId }, { ...f.application, operation: "replay", consumerSourceSequence: 3 })); }
    finally { await readonly.end({ timeout: 3 }); } expect(await counts()).toEqual(before);
  }, 45000);
  it.each(["version", "lifecycle"])("actual registered %s change after A refuses new use while preserving the saved record", async kind => {
    const f = await fixture(); const before = await counts();
    if (kind === "version") {
      const definition = JSON.parse(f.hypothesis.definitionJson); definition.prior = { ordinal: "explicit-next", band: "wide" };
      await f.hypothesisService.appendHypothesisVersion(f.context, { hypothesisKey: f.hypothesis.hypothesisKey,
        hypothesisKind: "market_claim", name: f.hypothesis.name, definition, authoredBy: userId });
    } else await f.hypothesisService.transitionHypothesisLifecycle(f.context, { hypothesisKey: f.hypothesis.hypothesisKey,
      toState: "VALIDATING", rationale: "synthetic restricted lifecycle", recordedBy: userId, actorType: "user", actorId: userId });
    expect((await run(f.application)).status).toBe(kind === "version" ? "APPLICATION_VERSION_NOT_SELECTED" : "APPLICATION_LIFECYCLE_NOT_PROPOSED");
    expect(await counts()).toEqual(before);
  }, 30000);
  it("configuration/manifest and cross-org selectors cannot reuse an existing application", async () => {
    const f = await fixture(); complete(await run(f.application)); const before = await counts();
    await expect(run({ ...f.application, configuration: { ...f.application.configuration, applicationComputationManifestDigest: "f".repeat(64) } as SavedApplicationRequest["configuration"] })).rejects.toThrow("APPLICATION_CONFIGURATION_INVALID");
    await expect(runSavedApplication(client, { organizationId: randomUUID() }, { ...f.application, operation: "replay" })).rejects.toThrow();
    expect(await counts()).toEqual(before);
  }, 30000);
  it("an explicitly zero max-age rejects later relation selection without raising or defaulting its budget", async () => {
    const f = await fixture(); f.application.configuration.maxAgeMs = 0; complete(await run(f.application)); await f.appendThrough(3);
    const result = complete(await run({ ...f.application, operation: "consume", consumerSourceSequence: 3 }));
    expect(result.consumption?.selection?.selectedRelations).toEqual([]);
    expect(result.consumption?.selection?.rejectedRelations).toHaveLength(1);
  }, 40000);
  it.each([application, availability, consumption])("process death while %s is in progress recovers exactly the absent or committed immutable stage", async table => {
    const f = await fixture(); if (table === consumption) { complete(await run(f.application)); await f.appendThrough(3); }
    await faultAt(table, "AFTER", "PERFORM pg_sleep(3.0);");
    const args = await argsFor(f, table === consumption ? "consume" : "apply", table === consumption ? 3 : undefined);
    const child = worker(args); const pending = child.result.catch(() => null);
    const deadline = performance.now() + 15000; let backend: number | null = null;
    while (performance.now() < deadline) {
      const rows = await client`select pid from pg_stat_activity where datname=current_database() and wait_event='PgSleep'
        and query like ${`%insert into "${table}"%`} and pid<>pg_backend_pid()`;
      if (rows.length) { backend = Number(rows[0]!.pid); break; }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    expect(backend).not.toBeNull(); await stop(child.child); await pending;
    const settle = performance.now() + 10000;
    while (performance.now() < settle && (await client`select pid from pg_stat_activity where pid=${backend!}`).length)
      await new Promise(resolve => setTimeout(resolve, 25));
    expect(await client`select pid from pg_stat_activity where pid=${backend!}`).toEqual([]);
    await clearFault(); await f.expiry();
    const input: SavedApplicationRequest = { ...f.application, ...(table === consumption ? { operation: "consume", consumerSourceSequence: 3 } as const : {}) };
    complete(await run(input)); const after = await counts(); complete(await run(input)); expect(await counts()).toEqual(after);
    expect(after.slice(0, 4)).toEqual([1, 1, 1, table === consumption ? 1 : 0]); expect(after[7]).toBe(table === consumption ? 3 : 2);
  }, 50000);
  it("actual absent-head owner claim is durable, then unsupported source work refuses without an application", async () => {
    const f = await fixture(); const foreignUser = randomUUID();
    const newOrg = await seedWp13User(url!, foreignUser, "DEE1132 absent claim");
    const request = structuredClone(f.application); request.configuration.organizationId = newOrg;
    request.research.assignment.organizationId = newOrg;
    if ("definition" in request.research.profile) {
      const definition = request.research.profile.definition;
      if (definition === null || typeof definition !== "object" || Array.isArray(definition)) throw new Error("FIXTURE_PROFILE_OBJECT_REQUIRED");
      request.research.profile.definition = { ...definition, organizationId: newOrg };
    }
    expect(await client`select * from trader_runtime_control_lease_heads_v2 where organization_id=${newOrg}::uuid`).toEqual([]);
    expect((await runSavedApplication(client, { organizationId: newOrg }, request)).status).not.toBe("COMPLETE");
    expect(await client`select lease_epoch from trader_runtime_control_lease_heads_v2 where organization_id=${newOrg}::uuid`).toEqual([{ lease_epoch: 1 }]);
    expect(await client`select lease_epoch,prior_content_digest from trader_runtime_control_lease_epoch_history_v2 where organization_id=${newOrg}::uuid`)
      .toEqual([{ lease_epoch: 1, prior_content_digest: null }]);
    expect(await client`select count(*)::int n from trader_research_applications_v1 where organization_id=${newOrg}::uuid`).toEqual([{ n: 0 }]);
  }, 30000);
  it("actual23505 after lease history insertion rolls the owner claim back before busy and a valid retry", async () => {
    const f = await fixture(); const before = await counts();
    const head = await client`select * from trader_runtime_control_lease_heads_v2 where organization_id=${organizationId}::uuid`;
    const history = await client`select * from trader_runtime_control_lease_epoch_history_v2 where organization_id=${organizationId}::uuid order by lease_epoch`;
    await faultAt("trader_runtime_control_lease_heads_v2", "BEFORE", "RAISE EXCEPTION 'DEE1132_CLAIM_UNIQUE' USING ERRCODE='23505';");
    expect((await run(f.application)).status).toBe("APPLICATION_LEASE_BUSY"); expect(await counts()).toEqual(before);
    expect(await client`select * from trader_runtime_control_lease_heads_v2 where organization_id=${organizationId}::uuid`).toEqual(head);
    expect(await client`select * from trader_runtime_control_lease_epoch_history_v2 where organization_id=${organizationId}::uuid order by lease_epoch`).toEqual(history);
    await clearFault(); complete(await run(f.application)); const after = await counts(); complete(await run(f.application)); expect(await counts()).toEqual(after);
  }, 30000);
  it("old public claim still recovers a real nested savepoint without aborting its outer transaction", async () => {
    const f = await fixture();
    const head = (await client`select * from trader_runtime_control_lease_heads_v2 where organization_id=${organizationId}::uuid`)[0]!;
    const history = await client`select count(*)::int n from trader_runtime_control_lease_epoch_history_v2 where organization_id=${organizationId}::uuid`;
    await faultAt("trader_runtime_control_lease_heads_v2", "BEFORE", "RAISE EXCEPTION 'DEE1132_OLD_UNIQUE' USING ERRCODE='23505';");
    const db = drizzle(client, { schema });
    await db.transaction(async tx => {
      const [clock] = await tx.execute<{ now: string; until: string }>(sql`select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') now,
        to_char((clock_timestamp()+interval '10 seconds') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') until`);
      const claim = { organizationId, runtimeInstanceId: "old-nested", leaseEpoch: Number(head.lease_epoch) + 1,
        expectedPreviousDigest: String(head.content_digest), adjudicatedAtUtc: clock!.now, validUntilUtc: clock!.until };
      expect(await createPostgresRuntimeControlLeaseRepositoryV2(tx).claimExclusive({ ...claim,
        leaseContentDigest: applicationDigest({ schemaVersion: "waia.trader.database_clock_control_lease.v2", ...claim }) })).toBe("CONFLICT");
      // This query succeeding proves the actual outer transaction is not left aborted.
      expect(await tx.execute(sql`select 'outer-post-savepoint' as marker`)).toEqual([{ marker: "outer-post-savepoint" }]);
    });
    expect(await client`select count(*)::int n from trader_runtime_control_lease_epoch_history_v2 where organization_id=${organizationId}::uuid`).toEqual(history);
    expect((await client`select * from trader_runtime_control_lease_heads_v2 where organization_id=${organizationId}::uuid`)[0]).toEqual(head);
    await clearFault(); complete(await run(f.application));
  }, 30000);
  it.each([32, 33])("real%d-version registry uses metadata admission before that ordered history body", async maximum => {
    const f = await fixture({ hypothesisVersions: maximum, ...(maximum === 32 ? { priorOrdinal: "p".repeat(60000) } : {}) });
    const before = await counts(); trace.length = 0;
    const budgets: HeldResearchAccounting[] = []; const originalBudget = HeldResearchAccounting.prototype.budget;
    vi.spyOn(HeldResearchAccounting.prototype, "budget").mockImplementation(function (this: HeldResearchAccounting, cap: number) {
      if (!budgets.includes(this)) budgets.push(this); return originalBudget.call(this, cap);
    });
    const value = await run(f.application); const queries = [...trace];
    const versionQueries = queries.filter(q => q.query.includes('from "trader_mi_hypothesis"') && q.query.includes('order by "trader_mi_hypothesis"."version_seq"'));
    expect(versionQueries.length).toBeGreaterThan(0); expect(versionQueries[0]!.query).toContain("octet_length");
    expect(versionQueries[0]!.query).toMatch(/limit \$[0-9]+/); expect(versionQueries[0]!.params).toContain(33);
    if (maximum === 33) {
      expect(value.status).toBe("APPLICATION_ROW_SET_REFUSED"); expect(versionQueries).toHaveLength(1);
      expect(queries.some(q => q.query.startsWith(`insert into "${application}"`))).toBe(false); expect(await counts()).toEqual(before);
    } else {
      complete(value); complete(await run({ ...f.application, operation: "replay" }));
      expect(await f.hypothesisProjectionBytes()).toBeGreaterThan(60000);
      for (const budget of budgets) { expect(budget.statements).toBeLessThanOrEqual(512); expect(budget.inputs.total).toBeLessThanOrEqual(67108864); }
      console.info(JSON.stringify({ proof: "DEE1132_NATIVE_SELECTED_HISTORY32_NEAR_CAP", registrationBytes: await f.hypothesisProjectionBytes(),
        invocations: budgets.map(b => ({ statements: b.statements, uniqueBytes: b.inputs.total })) }));
    }
  }, 45000);
  it.each([65536, 65537])("actual registered projection at%dbytes preserves owner/restart or refuses before its body", async target => {
    const f = await fixture({ targetHypothesisBytes: target }); expect(await f.hypothesisProjectionBytes()).toBe(target);
    const before = await counts(); trace.length = 0; const value = await run(f.application); const queries = [...trace];
    const selected = queries.filter(q => q.query.includes('from "trader_mi_hypothesis"') && q.params.includes(f.hypothesis.id));
    expect(selected.length).toBeGreaterThan(0); expect(selected[0]!.query).toContain("octet_length");
    if (target === 65537) {
      expect(value.status).toBe("STORED_ROW_LIMIT_EXCEEDED"); expect(selected).toHaveLength(1); expect(await counts()).toEqual(before);
    } else {
      const applied = complete(value); const restarted = await worker(await argsFor(f, "replay")).result;
      expect(restarted.event).toBe("result"); expect(complete(restarted.result).application).toEqual(applied.application);
      expect(queries.length).toBeLessThanOrEqual(limits.queries);
      const accounting = new HeldResearchAccounting(), prepared = prepareHeldResearchReplay(client, accounting);
      await client.begin("isolation level repeatable read read only", async held => {
        const budget = accounting.budget(limits.additionalAggregate), db = prepared.bindHeld(held).executor;
        const rows = await readApplicationRows(db, "application", applicationScope("application", organizationId, applied.applicationId), budget);
        expect(rows).toHaveLength(1); expect(budget.total).toBeLessThanOrEqual(limits.application);
        expect(budget.total).toBeGreaterThan(Buffer.byteLength(String(rows[0]!.bodyJson)));
      });
    }
  }, 45000);
  it("exact physical candidate size is charged before any write at65536 and refuses65537", async () => {
    const accounting = new HeldResearchAccounting(), prepared = prepareHeldResearchReplay(client, accounting);
    await client.begin("isolation level repeatable read read only", async held => {
      const db = prepared.bindHeld(held).executor;
      const row = { organizationId, assignmentDigest: "a".repeat(64), contentDigest: "b".repeat(64), bodyJson: "x",
        runtimeInstanceId: "synthetic-candidate-only", leaseEpoch: 1, leaseContentDigest: "c".repeat(64), researchSessionId: "r", researchAssignmentDigest: "d".repeat(64) };
      const initial = accounting.budget(limits.additionalAggregate); await admitApplicationWriteRow(db, "assignment", row, initial);
      row.bodyJson = "x".repeat(1 + limits.assignment - initial.total);
      // New ledger avoids treating deliberately different synthetic candidate sizes as one row identity.
      const at = new HeldResearchAccounting().budget(limits.additionalAggregate);
      await admitApplicationWriteRow(db, "assignment", row, at); expect(at.total).toBe(65536);
      row.bodyJson += "x";
      await expect(admitApplicationWriteRow(db, "assignment", row, new HeldResearchAccounting().budget(limits.additionalAggregate))).rejects.toThrow("STORED_ROW_LIMIT_EXCEEDED");
    });
    // These candidate-only raw strings are not valid application bodies and are never inserted.
    expect((await counts()).slice(0, 4)).toEqual([0, 0, 0, 0]);
  });
  it("native witness payload/text/hash checks reach fresh valid keys with real owner-produced canonical and audit writes", async () => {
    const f = await fixture(); f.application.research.range.leaseDurationMs = 60000;
    const before = await counts(); await faultAt(application, "BEFORE", "RETURN NULL;"); trace.length = 0;
    expect((await run(f.application)).status).toBe("APPLICATION_FENCED_INSERT_REQUIRED");
    const emitted = trace.filter(q => /^insert into "/.test(q.query) && tables.some(t => q.query.startsWith(`insert into "${t}"`))).map(q => structuredClone(q));
    expect(emitted.at(-1)!.query).toContain(`insert into "${application}"`); expect(await counts()).toEqual(before); await clearFault();
    const paramIndex = (query: string, name: string) => {
      const match = /\(([^)]+)\) values \(([^)]+)\)/.exec(query); if (!match) throw new Error("FIXTURE_SINGLE_INSERT_REQUIRED");
      const columns = match[1]!.split(",").map(v => v.trim().replaceAll('"', '')), values = match[2]!.split(",").map(v => v.trim());
      const parameter = values[columns.indexOf(name)]; if (!parameter?.match(/^\$[1-9][0-9]*$/)) throw new Error(`FIXTURE_PARAMETER_MISSING:${name}`);
      return Number(parameter.slice(1)) - 1;
    };
    const appInsert = emitted.at(-1)!, originalBody = JSON.parse(String(appInsert.params[paramIndex(appInsert.query, "body_json")]));
    expect(originalBody.witnesses.every((w: { payload: unknown; payloadCanonical: string; value: { outputContentDigest: string } }) =>
      applicationDigest(w.payload) === w.value.outputContentDigest && createHash("sha256").update(w.payloadCanonical).digest("hex") === w.value.outputContentDigest)).toBe(true);
    for (const mode of ["payload", "text", "invalid-json", "missing", "oversize", "shape", "unchanged"] as const) {
      const body = structuredClone(originalBody), witness = body.witnesses[0];
      if (mode === "payload") witness.payload.features.features.close = "different";
      if (mode === "text") witness.payloadCanonical = ` ${witness.payloadCanonical}`;
      if (mode === "invalid-json") witness.payloadCanonical = "{";
      if (mode === "missing") delete witness.payloadCanonical;
      if (mode === "oversize") witness.payloadCanonical = "x".repeat(262145);
      if (mode === "shape") witness.payload.features.features.close = { arbitrary: [] };
      const text = canonicalJsonString(body), digest = createHash("sha256").update(text).digest("hex");
      const writes = structuredClone(emitted);
      for (const q of writes) {
        if (q.query.startsWith(`insert into "${application}"`)) {
          q.params[paramIndex(q.query, "body_json")] = text; q.params[paramIndex(q.query, "content_digest")] = digest;
        }
        if (q.query.startsWith('insert into "audit_logs"')) {
          const index = paramIndex(q.query, "metadata_json"), metadata = JSON.parse(String(q.params[index]));
          metadata.bodyDigest = digest; q.params[index] = JSON.stringify(metadata);
        }
      }
      const expected = mode === "unchanged" ? /FIXTURE_VALID_INSERT_ROLLBACK/ : mode === "payload" || mode === "text" ? /APPLICATION_WITNESS_PAYLOAD_CONFLICT/
        : mode === "invalid-json" ? /invalid input syntax for type json/ : mode === "shape" ? /APPLICATION_WITNESS_SHAPE_INVALID/ : /APPLICATION_WITNESS_REPRESENTATION_(?:INVALID|LIMIT)/;
      await expect(client.begin(async tx => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${organizationId},637))`;
        for (const q of writes) await tx.unsafe(q.query, q.params as Parameters<postgres.TransactionSql["unsafe"]>[1]);
        await tx`set constraints all immediate`;
        expect(await tx`select count(*)::int n from trader_research_applications_v1 where organization_id=${organizationId}::uuid`).toEqual([{ n: 1 }]);
        throw new Error("FIXTURE_VALID_INSERT_ROLLBACK");
      })).rejects.toThrow(expected);
      expect(await counts()).toEqual(before);
    }
  }, 45000);
  it("retains the real0221 local predecessor and source-offset invariants used by arbitrary later B", async () => {
    const f = await fixture();
    const row = (await client`select row_to_json(t) body from trader_research_understanding_completions_v1 t
      where organization_id=${organizationId}::uuid and sequence=1`)[0]!.body;
    for (const field of ["previous_completion_digest", "sequence"]) {
      const altered = structuredClone(row); const body = JSON.parse(altered.body_json);
      if (field === "sequence") { altered.sequence = 99; body.sequence = 99; }
      else { altered.previous_completion_digest = "f".repeat(64); body.previousCompletionDigest = altered.previous_completion_digest; }
      altered.body_json = JSON.stringify(body); altered.content_digest = createHash("sha256").update(altered.body_json).digest("hex");
      await expect(client`insert into trader_research_understanding_completions_v1
        select * from jsonb_populate_record(null::trader_research_understanding_completions_v1,${JSON.stringify(altered)}::jsonb)`)
        .rejects.toThrow(field === "sequence" ? "RESEARCH_COMPLETION_LINK_CONFLICT" : "RESEARCH_PREDECESSOR_CONFLICT");
    }
    expect(await client`select count(*)::int n from trader_research_understanding_completions_v1 where organization_id=${organizationId}::uuid`).toEqual([{ n: 2 }]);
    complete(await run(f.application));
  }, 30000);
  it("refuses resealed sidecar/projection conflict and preserves protected trust chronology", async () => {
    const f = await fixture(); complete(await run(f.application)); const before = await counts();
    const app = (await client`select row_to_json(t) body from trader_research_applications_v1 t where organization_id=${organizationId}::uuid`)[0]!.body;
    const altered = structuredClone(app); const body = JSON.parse(altered.body_json);
    body.current.packetDigest = "f".repeat(64); altered.body_json = JSON.stringify(body);
    altered.content_digest = createHash("sha256").update(altered.body_json).digest("hex");
    await expect(client`insert into trader_research_applications_v1
      select * from jsonb_populate_record(null::trader_research_applications_v1,${JSON.stringify(altered)}::jsonb)`)
      .rejects.toThrow("APPLICATION_COMPLETION_LINK_CONFLICT");
    const prior = await client`select id,content_digest,available_at from trader_mi_source_trust where organization_id=${organizationId}::uuid order by id`;
    await expect(client`update trader_mi_source_trust set available_at=available_at+interval '1 millisecond' where organization_id=${organizationId}::uuid`).rejects.toThrow(/append-only/);
    expect(await client`select id,content_digest,available_at from trader_mi_source_trust where organization_id=${organizationId}::uuid order by id`).toEqual(prior);
    expect(await counts()).toEqual(before);
  }, 30000);
  it("new sidecars remain append-only and browser-invisible with privileges rolled back", async () => {
    const f = await fixture(); complete(await run(f.application)); await f.appendThrough(3);
    complete(await run({ ...f.application, operation: "consume", consumerSourceSequence: 3 }));
    for (const table of owned) {
      await expect(client.unsafe(`update ${table} set content_digest=content_digest where organization_id=$1::uuid`, [organizationId])).rejects.toThrow();
      await expect(client.unsafe(`delete from ${table} where organization_id=$1::uuid`, [organizationId])).rejects.toThrow();
      const saved = (await client.unsafe(`select row_to_json(t) body from ${table} t where organization_id=$1::uuid limit 1`, [organizationId]))[0]!.body;
      for (const role of ["anon", "authenticated"]) await expect(client.begin(async tx => {
        await tx.unsafe(`grant select,insert on ${table} to ${role}`); await tx.unsafe(`set local role ${role}`);
        expect(await tx.unsafe(`select * from ${table} where organization_id=$1::uuid`, [organizationId])).toEqual([]);
        await tx.unsafe(`insert into ${table} select * from jsonb_populate_record(null::${table}, $1::jsonb)`, [JSON.stringify(saved)]);
        throw new Error("BROWSER_INSERT_UNEXPECTEDLY_ALLOWED");
      })).rejects.toThrow(/row-level security|permission denied/);
    }
  }, 40000);
});
