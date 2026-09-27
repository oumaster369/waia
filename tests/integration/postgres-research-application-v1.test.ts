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
import { canonicalizeSemanticJsonString } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { createPostgresRuntimeControlLeaseRepositoryV2 } from "@/lib/trader/runtime-authority/v2/runtime-authority-repository-postgres-v2";
import { claimRuntimeControlLeaseAtDatabaseTimeV2 } from "@/lib/trader/runtime-authority/v2/runtime-control-lease-database-clock-postgres-v2";
import { createSavedResearchOwner } from "@/lib/trader/paper/research-understanding-v1/repository-postgres";
import { ResearchReadBudget } from "@/lib/trader/paper/research-understanding-v1/bounded-source-postgres";

const url = process.env.DATABASE_URL_POSTGRES?.trim();
const enabled = process.env.WAIA_PG_INTEGRATION === "1" && !!url;
const assignment = "trader_research_application_assignments_v1", application = "trader_research_applications_v1",
  availability = "trader_research_application_availability_v1", consumption = "trader_research_application_consumptions_v1";
const owned = [assignment, application, availability, consumption];
const researchCompletion = "trader_research_understanding_completions_v1", researchReceipt = "trader_information_sufficiency_receipt_v2";
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
    for (const table of [...tables, researchCompletion, researchReceipt, "trader_runtime_control_lease_heads_v2"]) {
      await client.unsafe(`drop trigger if exists ${fault} on ${table}`);
      await client.unsafe(`drop trigger if exists zz_${fault} on ${table}`);
    }
    await client.unsafe(`drop function if exists ${fault}()`);
  }
  async function faultAt(table: string, timing: "BEFORE" | "AFTER", body = "RAISE EXCEPTION 'DEE1132_INJECTED';", auditOperation?: string, triggerLast = false) {
    expect([...tables, researchCompletion, researchReceipt, "trader_runtime_control_lease_heads_v2"]).toContain(table);
    const extra = table === "audit_logs" ? ` AND NEW.action='trader.research_application.${auditOperation ?? "apply"}'` : "";
    await client.unsafe(`create function ${fault}() returns trigger language plpgsql as $$ begin
      if NEW.organization_id='${organizationId}'::uuid${extra} then ${body} end if; return NEW; end $$`);
    await client.unsafe(`create trigger ${triggerLast ? "zz_" : ""}${fault} ${timing} insert on ${table} for each row execute function ${fault}()`);
  }
  async function argsFor(f: Fixture, operation: SavedApplicationRequest["operation"] = "apply", consumerSequence?: number) {
    const file = path.join(directory, "application.json");
    await writeFile(file, JSON.stringify({ configuration: f.application.configuration, research: f.application.research }));
    return ["--saved-research-application", `--application-file=${file}`, `--operation=${operation}`,
      `--previous-sequence=${f.application.previousSourceSequence}`, `--current-sequence=${f.application.currentSourceSequence}`,
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
    expect(event.event, event.message).toBe("result"); expect(event.fetches).toBe(0); expect(event.forbidden).toEqual([]);
    const applied = complete(event.result); expect(applied.disposition).toBe("OBSERVED_FOR");
    expect(applied.application.meaning.direction).toBe("FOR"); expect(applied.application.relation).toMatchObject({ verified: false, confidenceState: "NOT_ASSESSED" });
    const featureSnapshot = applied.application.witnesses[0]?.payload.features;
    expect(featureSnapshot).toHaveProperty("featureSetId"); expect(featureSnapshot).toHaveProperty("features");
    // The real saved snapshot exposes the locale/code-point ordering mismatch.
    expect(canonicalJsonString(applied.application)).not.toBe(canonicalizeSemanticJsonString(applied.application));
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
    for (const table of owned) {
      const rows = await client.unsafe<{ body_json: string; content_digest: string; raw_digest: string }[]>(
        `select body_json, content_digest, encode(sha256(convert_to(body_json,'UTF8')),'hex') as raw_digest from ${table} where organization_id=$1::uuid`, [organizationId]);
      expect(rows).toHaveLength(1);
      const row = rows[0]!, body: unknown = JSON.parse(row.body_json);
      expect(row.body_json).toBe(canonicalizeSemanticJsonString(body));
      expect(createHash("sha256").update(row.body_json, "utf8").digest("hex")).toBe(row.content_digest);
      expect(row.raw_digest).toBe(row.content_digest); expect(applicationDigest(body)).toBe(row.content_digest);
    }
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
    for (const [table, sessionId] of [["trader_recorded_analysis_packets_v1", f.application.configuration.sourceSessionId],
      ["trader_research_understanding_completions_v1", f.application.configuration.researchSessionId]] as const) {
      const reads = trace.filter(r => r.query.includes(`"${table}"`) && !r.query.includes("octet_length"));
      const bodySequences: number[] = [], predecessorSequences: number[] = [];
      expect(reads.length).toBeGreaterThan(0);
      for (const read of reads) {
        const shape = read.query.match(new RegExp(`^select ([\\s\\S]+?)\\s+from "${table}" where ([\\s\\S]+?) limit (?:\\$(\\d+)|(\\d+))\\s*$`, "i"));
        expect(shape, read.query).not.toBeNull(); if (!shape) throw new Error("UNRECOGNIZED_SAVED_READ");
        const binding = (column: string) => {
          const match = shape[2]!.match(new RegExp(`"${table}"\\."${column}" = \\$(\\d+)`));
          expect(match, read.query).not.toBeNull(); if (!match) throw new Error("MISSING_SAVED_SCOPE_BINDING");
          return { index: Number(match[1]), value: read.params[Number(match[1]) - 1] };
        };
        expect(binding("organization_id").value).toBe(organizationId);
        expect(binding("session_id").value).toBe(sessionId);
        const sequence = binding("sequence"); expect(Number.isSafeInteger(sequence.value)).toBe(true);
        const projection = [...shape[1]!.matchAll(/as "([^"]+)"/g)].map(m => m[1]);
        const limit = shape[3] ? read.params[Number(shape[3]) - 1] : Number(shape[4]);
        expect(limit).toBe(2);
        if (shape[1]!.includes('"body_json"')) {
          expect(projection).toContain("bodyJson"); expect(shape[3]).toBeDefined();
          expect(Number(shape[3])).not.toBe(sequence.index);
          expect([0, 1, 3]).toContain(sequence.value); bodySequences.push(sequence.value as number);
        } else {
          expect(table).toBe("trader_research_understanding_completions_v1");
          if (sequence.value === 2) {
            expect(projection).toEqual(["organizationId", "sessionId", "sequence", "contentDigest", "assignmentDigest", "sourceSessionId", "sourceSequence", "packetDigest"]);
            predecessorSequences.push(2);
          } else expect([0, 1, 3]).toContain(sequence.value);
        }
      }
      expect([...new Set(bodySequences)].sort()).toEqual([0, 1, 3]);
      if (table === "trader_research_understanding_completions_v1") expect(predecessorSequences.length).toBeGreaterThan(0);
    }
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
    const f = await fixture(); f.application.configuration.maxAgeMs = 0;
    const applied = complete(await run(f.application)); expect(applied.disposition).toBe("OBSERVED_FOR");
    expect(applied.application.relation).not.toBeNull(); await f.appendThrough(3);
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


  // DEE-1133 uses the same registered native file. The preceding45 cases remain intact.
  async function savedCompletion(sourceSequence: number) {
    return client`select sequence,source_sequence,content_digest,body_json,receipt_id,runtime_instance_id,lease_epoch,lease_content_digest
      from trader_research_understanding_completions_v1 where organization_id=${organizationId}::uuid and source_sequence=${sourceSequence}`;
  }
  async function compositeFixture(options: Parameters<typeof fixture>[0] = {}, offset = 2, predecessor = true) {
    const f = await fixture(options), applied = complete(await run(f.application));
    const b = f.application.previousSourceSequence + offset;
    if (offset > 2 && predecessor) await f.appendThrough(b - 1);
    await f.appendSourceThrough(b);
    expect(await savedCompletion(b)).toEqual([]);
    const input: SavedApplicationRequest = { ...f.application, operation: "complete-consumer", consumerSourceSequence: b,
      research: { ...f.application.research, range: { ...f.application.research.range, leaseDurationMs: 10000 } } };
    return { f, applied, b, input };
  }
  function assertSelectedSavedBodies(queries: typeof trace, f: Fixture, b: number) {
    const selected = [f.application.previousSourceSequence, f.application.currentSourceSequence, b];
    for (const [table, sessionId] of [["trader_recorded_analysis_packets_v1", f.application.configuration.sourceSessionId],
      [researchCompletion, f.application.configuration.researchSessionId]] as const) {
      const bodies: number[] = [], metadata: number[] = [];
      for (const read of queries.filter(q => q.query.startsWith("select ") && q.query.includes(`from "${table}"`) && !q.query.includes("octet_length"))) {
        const scope = read.query.match(new RegExp(`from "${table}" where ([\\s\\S]+?) limit (?:\\$(\\d+)|(\\d+))\\s*$`, "i"));
        expect(scope, read.query).not.toBeNull(); if (!scope) throw new Error("UNRECOGNIZED_COMPOSITE_SAVED_READ");
        const parameter = (column: string) => {
          const match = scope[1]!.match(new RegExp(`"${table}"\\."${column}" = \\$(\\d+)`));
          if (!match) throw new Error(`COMPOSITE_SCOPE_MISSING:${column}`); return Number(match[1]);
        };
        expect(read.params[parameter("organization_id") - 1]).toBe(organizationId);
        expect(read.params[parameter("session_id") - 1]).toBe(sessionId);
        const sequence = Number(read.params[parameter("sequence") - 1]);
        expect(scope[2] ? read.params[Number(scope[2]) - 1] : Number(scope[3])).toBe(2);
        if (scope[2]) expect(Number(scope[2])).not.toBe(parameter("sequence"));
        if (read.query.includes('"body_json"')) bodies.push(table === researchCompletion ? sequence + f.application.research.assignment.firstSourceSequence : sequence);
        else {
          expect(table).toBe(researchCompletion);
          const projection = [...read.query.matchAll(/as "([^"]+)"/g)].map(m => m[1]);
          if (projection.length === 1 && projection[0] === "receiptId") expect(selected).toContain(sequence + f.application.research.assignment.firstSourceSequence);
          else {
            metadata.push(sequence + f.application.research.assignment.firstSourceSequence);
            expect(projection).toEqual(["organizationId", "sessionId", "sequence", "contentDigest", "assignmentDigest", "sourceSessionId", "sourceSequence", "packetDigest"]);
          }
        }
      }
      expect([...new Set(bodies)].sort()).toEqual(selected);
      if (b > f.application.currentSourceSequence + 1 && table === researchCompletion) expect(metadata).toContain(b - 1);
    }
  }
  it("DEE1133 actual CLI completes source-only B and consumes under one holder with unchanged public replay shape", async () => {
    const { f, applied, b, input } = await compositeFixture();
    f.application.research.range = input.research.range;
    const before = await counts();
    const epoch = Number((await client`select lease_epoch from trader_runtime_control_lease_heads_v2 where organization_id=${organizationId}::uuid`)[0]!.lease_epoch);
    const event = await worker(await argsFor(f, "complete-consumer", b)).result;
    expect(event.event, event.message).toBe("result"); expect(event.fetches).toBe(0); expect(event.forbidden).toEqual([]);
    const result = complete(event.result); expect(result.outcome).toBe("COMMITTED");
    expect(result.application).toEqual(applied.application); expect(result.availability).toEqual(applied.availability);
    expect(result.consumption?.selection?.selectedRelations).toHaveLength(1);
    const [completion] = await savedCompletion(b); expect(completion).toBeDefined();
    const [consumed] = await client`select runtime_instance_id,lease_epoch,lease_content_digest,audit_id from trader_research_application_consumptions_v1 where organization_id=${organizationId}::uuid`;
    for (const key of ["runtime_instance_id", "lease_epoch", "lease_content_digest"]) expect(completion![key]).toBe(consumed![key]);
    expect(Number(completion!.lease_epoch)).toBe(epoch + 1);
    const [receipt] = await client`select receipt_json from trader_information_sufficiency_receipt_v2 where organization_id=${organizationId}::uuid and id=${completion!.receipt_id}`;
    const body = JSON.parse(String(completion!.body_json)); expect(receipt!.receipt_json).toEqual(body.output.receipt);
    expect(body).not.toHaveProperty("contentDigest");
    expect(createHash("sha256").update(String(completion!.body_json), "utf8").digest("hex")).toBe(String(completion!.content_digest));
    expect(body.output.artifact.claims).toHaveLength(12);
    expect(body.assignmentDigest).toBe(f.application.configuration.researchAssignmentDigest);
    expect(body.output.analysisPitAnchor).toBe(f.packets[b]!.analysisPitAnchor);
    const old = await createSavedResearchOwner(client, f.researchContext, { ...f.application.research,
      range: { ...input.research.range, startSequence: b, count: 1 } }).complete(b, { organizationId,
      runtimeInstanceId: String(completion!.runtime_instance_id), leaseEpoch: Number(completion!.lease_epoch), leaseContentDigest: String(completion!.lease_content_digest) });
    expect(Object.keys(old).sort()).toEqual(["completion", "outcome"]);
    expect(old).toEqual({ outcome: "REPLAYED", completion: { ...body, contentDigest: String(completion!.content_digest) } });
    expect(result.consumption?.consumer.evaluationDigest).toBe(body.output.contentDigest);
    const [audit] = await client`select metadata_json from audit_logs where id=${consumed!.audit_id}::uuid`;
    expect(audit!.metadata_json.holder).toEqual({ runtimeInstanceId: completion!.runtime_instance_id,
      leaseEpoch: Number(completion!.lease_epoch), leaseContentDigest: completion!.lease_content_digest });
    const after = await counts(); expect(after.slice(0, 4)).toEqual([1, 1, 1, 1]); expect(after[7]).toBe(before[7]! + 1);
    expect(complete(await run(input)).consumption).toEqual(result.consumption); expect(await counts()).toEqual(after);
    console.info(JSON.stringify({ proof: "DEE1133_NATIVE_ONE_B_SAME_HOLDER", sourceSequence: b, leaseEpoch: epoch + 1,
      researchReceiptAtomicWithCompletion: true, oldPublicReturnKeys: Object.keys(old).sort(), claims: body.output.artifact.claims.length }));
  }, 45000);
  it("DEE1133 actual32-history P0/A1/B3 shares one ledger and transfers predecessor2 metadata only", async () => {
    const { f, b, input } = await compositeFixture({ hypothesisVersions: 32, priorOrdinal: "p".repeat(60000) }, 3);
    const budgets: HeldResearchAccounting[] = [], originalBudget = HeldResearchAccounting.prototype.budget;
    const admitted: Array<{ table: string; identity: string; bytes: number; projection: string | undefined }> = [];
    const originalAdmit = ResearchReadBudget.prototype.admit;
    vi.spyOn(ResearchReadBudget.prototype, "admit").mockImplementation(function (this: ResearchReadBudget, table, identity, bytes, maximum, projection) {
      if (table === researchCompletion || table === researchReceipt) admitted.push({ table, identity, bytes, projection });
      return originalAdmit.call(this, table, identity, bytes, maximum, projection);
    });
    vi.spyOn(HeldResearchAccounting.prototype, "budget").mockImplementation(function (this: HeldResearchAccounting, maximum: number) {
      if (!budgets.includes(this)) budgets.push(this); return originalBudget.call(this, maximum);
    });
    const dispatched = vi.spyOn(HeldResearchAccounting.prototype, "beforeStatement"), finalized = vi.spyOn(HeldResearchAccounting.prototype, "beforeFinalizationStatement");
    trace.length = 0; const result = complete(await run(input)); const queries = [...trace];
    expect(budgets).toHaveLength(1); expect(queries.length).toBe(dispatched.mock.calls.length + finalized.mock.calls.length);
    expect(budgets[0]!.statements).toBe(queries.length); expect(budgets[0]!.statements).toBeLessThanOrEqual(512);
    expect(budgets[0]!.inputs.total).toBeLessThanOrEqual(67108864);
    expect(queries.filter(q => /^begin /i.test(q.query)).map(q => q.query.toLowerCase())).toEqual([
      "begin isolation level repeatable read read only", "begin isolation level read committed",
      "begin isolation level repeatable read read only", "begin isolation level read committed", "begin isolation level repeatable read"]);
    expect(queries.filter(q => /^commit$/i.test(q.query))).toHaveLength(5); assertSelectedSavedBodies(queries, f, b);
    const candidateQueries = queries.filter(q => q.query.includes("octet_length(jsonb_build_object"));
    expect(candidateQueries.length).toBeGreaterThanOrEqual(3); // completion, receipt and consumption
    const completionWrite = queries.findIndex(q => q.query.startsWith(`insert into "${researchCompletion}"`));
    const receiptWrite = queries.findIndex(q => q.query.startsWith(`insert into "${researchReceipt}"`));
    expect(receiptWrite).toBeGreaterThan(0); expect(completionWrite).toBeGreaterThan(receiptWrite);
    expect(queries.slice(0, receiptWrite).filter(q => q.query.includes("octet_length(jsonb_build_object")).length).toBe(2);
    expect(queries.slice(0, receiptWrite).some(q => q.query.includes("date_trunc('milliseconds', transaction_timestamp())"))).toBe(true);
    expect((await savedCompletion(b))).toHaveLength(1); expect(result.consumption?.consumer.sourceSequence).toBe(3);
    const completionBytes = Number((await client`select octet_length(to_jsonb(q)::text)::int bytes from (select
      organization_id as "organizationId", session_id as "sessionId", sequence, content_digest as "contentDigest", body_json as "bodyJson",
      assignment_digest as "assignmentDigest", source_session_id as "sourceSessionId", source_sequence as "sourceSequence",
      packet_digest as "packetDigest", receipt_id as "receiptId", previous_completion_digest as "previousCompletionDigest",
      runtime_instance_id as "runtimeInstanceId", lease_epoch as "leaseEpoch", lease_content_digest as "leaseContentDigest"
      from trader_research_understanding_completions_v1 where organization_id=${organizationId}::uuid and source_sequence=${b}) q`)[0]!.bytes);
    const receiptBytes = Number((await client`select octet_length(to_jsonb(q)::text)::int bytes from (select
      id, organization_id as "organizationId", account_id as "accountId", profile_id as "profileId", profile_content_digest as "profileContentDigest",
      purpose,status,pit_anchor as "pitAnchor",receipt_json as "receiptJson",content_digest as "contentDigest",schema_version as "schemaVersion",
      authority,created_at as "createdAt" from trader_information_sufficiency_receipt_v2
      where organization_id=${organizationId}::uuid and id=${result.consumption!.consumer.receiptId}) q`)[0]!.bytes);
    const completionAdmissions = admitted.filter(row => row.table === researchCompletion && row.projection === "completion" &&
      JSON.parse(row.identity)[2] === b - f.application.research.assignment.firstSourceSequence);
    const receiptAdmissions = admitted.filter(row => row.table === researchReceipt && row.projection === "receipt" &&
      JSON.parse(row.identity)[0] === result.consumption!.consumer.receiptId);
    expect(completionAdmissions.length).toBeGreaterThan(1); expect(receiptAdmissions.length).toBeGreaterThan(1);
    expect(completionAdmissions.every(row => row.bytes === completionBytes)).toBe(true);
    expect(receiptAdmissions.every(row => row.bytes === receiptBytes)).toBe(true);
    console.info(JSON.stringify({ proof: "DEE1133_NATIVE_SELECTED_HISTORY32_COMPOSITE", registrationBytes: await f.hypothesisProjectionBytes(),
      statements: budgets[0]!.statements, uniqueBytes: budgets[0]!.inputs.total, transactions: 5,
      selectedBodies: [0, 1, 3], predecessorMetadataOnly: 2, candidateMetadataBeforeReceipt: true, completionBytes, receiptBytes }));
  }, 60000);
  it("DEE1133 nonzero source offset keeps relative predecessor and explicit P2/A3/B5 bodies", async () => {
    const { f, b, input } = await compositeFixture({ firstSourceSequence: 2 }, 3);
    trace.length = 0; const result = complete(await run(input)); const queries = [...trace];
    assertSelectedSavedBodies(queries, f, b); expect(result.consumption?.consumer.sourceSequence).toBe(5);
    const [row] = await savedCompletion(b); expect(Number(row!.sequence)).toBe(3);
    expect(JSON.parse(String(row!.body_json)).previousCompletionDigest).toBe((await savedCompletion(4))[0]!.content_digest);
  }, 45000);
  it("DEE1133 missing relative predecessor refuses B3 without backfill or new sidecars", async () => {
    const { b, input } = await compositeFixture({}, 3, false); const before = await counts();
    expect((await run(input)).status).toBe("EXACT_ROW_SET_MISSING_OR_AMBIGUOUS");
    expect(await savedCompletion(2)).toEqual([]); expect(await savedCompletion(b)).toEqual([]); expect(await counts()).toEqual(before);
  }, 40000);
  it("DEE1133 source-only B preceding S refuses before Understanding persistence", async () => {
    const f = await fixture(); await f.appendSourceThrough(2); complete(await run(f.application)); await f.expiry();
    const before = await counts();
    expect((await run({ ...f.application, operation: "complete-consumer", consumerSourceSequence: 2 })).status).toBe("APPLICATION_NOT_YET_AVAILABLE");
    expect(await savedCompletion(2)).toEqual([]); expect(await counts()).toEqual(before);
  }, 40000);
  it("DEE1133 actual missing4h B remains unresolved and cannot acquire a selected relation", async () => {
    const f = await fixture(); complete(await run(f.application)); await f.appendSourceThrough(2, { missing4h: true });
    const result = complete(await run({ ...f.application, operation: "complete-consumer", consumerSourceSequence: 2 }));
    expect(result.disposition).toBe("UNASSESSED_ANTECEDENT"); expect(result.consumption?.selection?.selectedRelations).toEqual([]);
    const body = JSON.parse(String((await savedCompletion(2))[0]!.body_json));
    expect(body.output.disposition).toBe("COMPLETED_UNRESOLVED"); expect(body.output.receipt.status).toBe("UNAVAILABLE");
    expect(body.output.artifact.claims).toHaveLength(12);
  }, 40000);
  it.each([researchReceipt, researchCompletion])("DEE1133 failure at%s rolls back receipt/completion and retries only after real expiry", async table => {
    const { f, b, input } = await compositeFixture(); input.research.range.leaseDurationMs = 1500;
    const before = await counts(); const receipts = await client`select id,content_digest from trader_information_sufficiency_receipt_v2 where organization_id=${organizationId}::uuid order by id`;
    await faultAt(table, "AFTER"); await expect(run(input)).rejects.toThrow();
    expect(await savedCompletion(b)).toEqual([]); expect(await counts()).toEqual(before);
    expect(await client`select id,content_digest from trader_information_sufficiency_receipt_v2 where organization_id=${organizationId}::uuid order by id`).toEqual(receipts);
    await clearFault(); expect((await run(input)).status).toBe("APPLICATION_LEASE_BUSY");
    await f.expiry(); complete(await run(input)); expect(await savedCompletion(b)).toHaveLength(1);
  }, 45000);
  it("DEE1133 consumption failure retains exactly B and resumes without resampling or rewriting its old holder", async () => {
    const { f, applied, b, input } = await compositeFixture(); input.research.range.leaseDurationMs = 1500;
    await faultAt(consumption, "AFTER"); await expect(run(input)).rejects.toThrow();
    const retained = await savedCompletion(b); expect(retained).toHaveLength(1); const before = await counts();
    expect(before.slice(0, 4)).toEqual([1, 1, 1, 0]);
    await clearFault(); expect((await run(input)).status).toBe("APPLICATION_LEASE_BUSY"); expect(await savedCompletion(b)).toEqual(retained);
    await f.expiry(); const result = complete(await run(input)); expect(result.availability).toEqual(applied.availability);
    expect(await savedCompletion(b)).toEqual(retained); const after = await counts();
    expect(complete(await run(input)).consumption).toEqual(result.consumption); expect(await counts()).toEqual(after);
    const [used] = await client`select lease_epoch from trader_research_application_consumptions_v1 where organization_id=${organizationId}::uuid`;
    expect(Number(used!.lease_epoch)).toBe(Number(retained[0]!.lease_epoch) + 1);
  }, 45000);
  it.each([researchCompletion, consumption])("DEE1133 expired holder at%s preserves only the prior committed prefix", async table => {
    const { f, b, input } = await compositeFixture(); input.research.range.leaseDurationMs = 1500;
    await faultAt(table, "AFTER", "PERFORM pg_sleep(2.0);");
    const value = await run(input).catch(() => null); expect(value?.status).not.toBe("COMPLETE");
    expect(await savedCompletion(b)).toHaveLength(table === researchCompletion ? 0 : 1);
    expect((await counts()).slice(0, 4)).toEqual([1, 1, 1, 0]);
    await clearFault(); await f.expiry(); complete(await run(input)); expect(await savedCompletion(b)).toHaveLength(1);
  }, 50000);
  it("DEE1133 replacement after actual RR commit invalidates the prepared holder before B writes", async () => {
    const { f, b, input } = await compositeFixture(); input.research.range.leaseDurationMs = 1500;
    const other = postgres(url!, { max: 1 }), originalBegin = client.begin.bind(client); let reads = 0, replaced = false;
    const begin = vi.spyOn(client, "begin");
    begin.mockImplementation(((options: string, callback: (held: postgres.TransactionSql) => Promise<unknown>) => originalBegin(options, async held => callback(held)).then(async result => {
      if (options === "isolation level repeatable read read only" && ++reads === 2) {
        await f.expiry(); const replacement = await claimRuntimeControlLeaseAtDatabaseTimeV2(drizzle(other, { schema }),
          { organizationId, runtimeInstanceId: "DEE1133-replacement-after-RR", durationMs: 10000 });
        expect(replacement).not.toBeNull(); replaced = true;
      }
      return result;
    })) as typeof client.begin);
    try { expect((await run(input)).status).toBe("LEASE_LOST"); expect(replaced).toBe(true); expect(await savedCompletion(b)).toEqual([]); }
    finally { begin.mockRestore(); await other.end({ timeout: 3 }); }
    expect((await counts()).slice(0, 4)).toEqual([1, 1, 1, 0]);
  }, 45000);
  it("DEE1133 two real connections cannot duplicate the B completion or consumption", async () => {
    const { b, input } = await compositeFixture(); const other = postgres(url!, { max: 1 });
    try {
      const results = await Promise.all([client, other].map(pool => runSavedApplication(pool, { organizationId }, input)));
      expect(results.some(v => v.status === "COMPLETE")).toBe(true);
      expect(results.every(v => ["COMPLETE", "APPLICATION_LEASE_BUSY"].includes(v.status))).toBe(true);
      expect(await savedCompletion(b)).toHaveLength(1); const after = await counts();
      expect(after.slice(0, 4)).toEqual([1, 1, 1, 1]); expect(after[7]).toBe(3);
    } finally { await other.end({ timeout: 3 }); }
  }, 45000);
  it("DEE1133 completed consumption replays READ ONLY while an unrelated holder remains live", async () => {
    const { f, b, input } = await compositeFixture(); input.research.range.leaseDurationMs = 1500;
    const result = complete(await run(input)); await f.expiry();
    expect(await claimRuntimeControlLeaseAtDatabaseTimeV2(f.db, { organizationId, runtimeInstanceId: "DEE1133-unrelated-live", durationMs: 10000 })).not.toBeNull();
    const head = await client`select * from trader_runtime_control_lease_heads_v2 where organization_id=${organizationId}::uuid`;
    const before = await counts(), retained = await savedCompletion(b), queries: string[] = [];
    const readonly = postgres(url!, { max: 1, connection: { default_transaction_read_only: true }, debug: (_c, q) => queries.push(q) });
    try { expect(complete(await runSavedApplication(readonly, { organizationId }, input)).consumption).toEqual(result.consumption); }
    finally { await readonly.end({ timeout: 3 }); }
    expect(queries.filter(q => /^begin /i.test(q))).toEqual(["begin isolation level repeatable read read only"]);
    expect(queries.join("\n")).not.toMatch(/insert into|pg_advisory_xact_lock|for update/);
    expect(await savedCompletion(b)).toEqual(retained); expect(await counts()).toEqual(before);
    expect(await client`select * from trader_runtime_control_lease_heads_v2 where organization_id=${organizationId}::uuid`).toEqual(head);
  }, 45000);
  it.each(["completion-before-commit", "consumption-before-commit", "consumption-after-commit"] as const)("DEE1133 process death at%s retains the actual prefix and resumes", async phase => {
    const { f, b, input } = await compositeFixture(); f.application.research.range = input.research.range;
    const table = phase === "completion-before-commit" ? researchCompletion : consumption;
    if (phase !== "consumption-after-commit") await faultAt(table, "AFTER", "PERFORM pg_sleep(3.0);");
    const child = worker(await argsFor(f, "complete-consumer", b), phase === "consumption-after-commit");
    const pending = child.result.catch(() => null); let backend: number | null = null;
    if (phase === "consumption-after-commit") { const event = await pending; expect(event?.event, event?.message).toBe("result"); complete(event!.result); }
    else {
      const deadline = performance.now() + 15000;
      while (performance.now() < deadline) {
        const rows = await client`select pid from pg_stat_activity where datname=current_database() and wait_event='PgSleep'
          and query like ${`%insert into "${table}"%`} and pid<>pg_backend_pid()`;
        if (rows.length) { backend = Number(rows[0]!.pid); break; } await new Promise(resolve => setTimeout(resolve, 25));
      }
      expect(backend).not.toBeNull();
    }
    await stop(child.child); await pending;
    if (backend !== null) {
      const deadline = performance.now() + 10000;
      while (performance.now() < deadline && (await client`select pid from pg_stat_activity where pid=${backend}`).length)
        await new Promise(resolve => setTimeout(resolve, 25));
      expect(await client`select pid from pg_stat_activity where pid=${backend}`).toEqual([]);
    }
    const retained = await savedCompletion(b); expect(retained).toHaveLength(phase === "completion-before-commit" ? 0 : 1);
    expect((await counts()).slice(0, 4)).toEqual([1, 1, 1, phase === "consumption-after-commit" ? 1 : 0]);
    await clearFault();
    if (phase !== "consumption-after-commit") { expect((await run(input)).status).toBe("APPLICATION_LEASE_BUSY"); await f.expiry(); }
    const result = complete(await run(input)); if (retained.length) expect(await savedCompletion(b)).toEqual(retained);
    const after = await counts(); expect(complete(await run(input)).consumption).toEqual(result.consumption); expect(await counts()).toEqual(after);
    console.info(JSON.stringify({ proof: "DEE1133_NATIVE_CRASH_PREFIX", phase, retainedCompletion: retained.length,
      retainedConsumption: phase === "consumption-after-commit" ? 1 : 0, backendClosure: backend === null ? "result-after-CLI-cleanup" : "native-pid-absent" }));
  }, 60000);
  it("DEE1133 late actual completion COMMIT acknowledgment refuses success without erasing B", async () => {
    const { b, input } = await compositeFixture(); let now = 0, calls = 0;
    const originalBegin = client.begin.bind(client), begin = vi.spyOn(client, "begin");
    vi.spyOn(performance, "now").mockImplementation(() => now);
    begin.mockImplementation(((options: string, callback: (held: postgres.TransactionSql) => Promise<unknown>) => originalBegin(options, async held => callback(held)).then(value => {
      if (++calls === 4) now = 120001; return value;
    })) as typeof client.begin);
    try { expect((await run(input)).status).toBe("INVOCATION_DEADLINE_EXCEEDED"); }
    finally { vi.restoreAllMocks(); }
    expect(await savedCompletion(b)).toHaveLength(1); expect((await counts()).slice(0, 4)).toEqual([1, 1, 1, 0]);
    console.info(JSON.stringify({ proof: "DEE1133_NATIVE_LATE_COMPLETION_ACK", committedB: true, consumption: false, elapsedControlMs: now }));
  }, 40000);
  it("DEE1133 real held dispatch consumes the shared512 slots and rejects the next business query with rollback reserved", async () => {
    const { b, input } = await compositeFixture(); const observed: { accounting?: HeldResearchAccounting } = {}; let calls = 0, injected = 0;
    const originalBudget = HeldResearchAccounting.prototype.budget;
    vi.spyOn(HeldResearchAccounting.prototype, "budget").mockImplementation(function (this: HeldResearchAccounting, maximum: number) {
      if (observed.accounting && observed.accounting !== this) throw new Error("COMPOSITE_ACCOUNTING_RESET"); observed.accounting = this; return originalBudget.call(this, maximum);
    });
    const originalBegin = client.begin.bind(client), begin = vi.spyOn(client, "begin");
    begin.mockImplementation(((options: string, callback: (held: postgres.TransactionSql) => Promise<unknown>) => originalBegin(options, async held => {
      if (++calls === 4) {
        expect(observed.accounting).toBeDefined(); const bound = prepareHeldResearchReplay(client, observed.accounting!).bindHeld(held);
        while (observed.accounting!.statements < 511) { await bound.executor.execute(sql`select 1 as dee1133_bounded_dispatch_probe`); injected++; }
      }
      return callback(held);
    })) as typeof client.begin);
    trace.length = 0;
    try {
      expect((await run(input)).status).toBe("STATEMENT_LIMIT_EXCEEDED");
      expect(observed.accounting!.statements).toBe(512); expect(trace).toHaveLength(512); expect(trace.at(-1)!.query.toLowerCase()).toBe("rollback");
      expect(injected).toBeGreaterThan(0); expect(trace.filter(q => q.query.includes("dee1133_bounded_dispatch_probe"))).toHaveLength(injected);
    } finally { vi.restoreAllMocks(); }
    expect(await savedCompletion(b)).toEqual([]); expect((await counts()).slice(0, 4)).toEqual([1, 1, 1, 0]);
    console.info(JSON.stringify({ proof: "DEE1133_NATIVE_SHARED_513_REFUSAL", statements: observed.accounting!.statements, injectedActualSelects: injected, reservedRollback: true }));
  }, 40000);

  it.each(["application", "availability"] as const)("DEE1133 missing%s cannot create a dependency or complete B", async missing => {
    const f = await fixture();
    if (missing === "availability") {
      await faultAt(availability, "AFTER"); await expect(run(f.application)).rejects.toThrow(); await clearFault();
    }
    await f.appendSourceThrough(2); const before = await counts();
    const value = await run({ ...f.application, operation: "complete-consumer", consumerSourceSequence: 2 });
    expect(value.status).toBe(missing === "application" ? "APPLICATION_DEPENDENCY_MISSING" : "APPLICATION_AVAILABILITY_MISSING");
    expect(await savedCompletion(2)).toEqual([]); expect(await counts()).toEqual(before);
  }, 40000);
  it.each(["version", "lifecycle"] as const)("DEE1133 actual%s change before B refuses completion without requalifying registration", async kind => {
    const f = await fixture(); complete(await run(f.application));
    if (kind === "version") {
      const definition = JSON.parse(f.hypothesis.definitionJson); definition.prior = { ordinal: "explicit-next", band: "wide" };
      await f.hypothesisService.appendHypothesisVersion(f.context, { hypothesisKey: f.hypothesis.hypothesisKey,
        hypothesisKind: "market_claim", name: f.hypothesis.name, definition, authoredBy: userId });
    } else await f.hypothesisService.transitionHypothesisLifecycle(f.context, { hypothesisKey: f.hypothesis.hypothesisKey,
      toState: "VALIDATING", rationale: "synthetic composite refusal", recordedBy: userId, actorType: "user", actorId: userId });
    await f.appendSourceThrough(2); const before = await counts();
    const value = await run({ ...f.application, operation: "complete-consumer", consumerSourceSequence: 2 });
    expect(value.status).toBe(kind === "version" ? "APPLICATION_VERSION_NOT_SELECTED" : "APPLICATION_LIFECYCLE_NOT_PROPOSED");
    expect(await savedCompletion(2)).toEqual([]); expect(await counts()).toEqual(before);
  }, 40000);
  it("DEE1133 retains USER research/application identity through fixed B preparation and actual completion", async () => {
    const f = await fixture({ userAssignment: true }); complete(await runSavedApplication(client, f.context, f.application));
    await f.appendSourceThrough(2); const input: SavedApplicationRequest = { ...f.application, operation: "complete-consumer", consumerSourceSequence: 2 };
    const before = await counts(); expect((await run(input)).status).not.toBe("COMPLETE");
    expect(await savedCompletion(2)).toEqual([]); expect(await counts()).toEqual(before); await f.expiry();
    const result = complete(await runSavedApplication(client, f.context, input));
    expect(result.consumption?.actor).toEqual({ kind: "USER", id: userId }); expect(await savedCompletion(2)).toHaveLength(1);
  }, 45000);

  it.each(["composite", "public"] as const)("DEE1133 suppressed completion insert cannot commit an orphan receipt through the%s owner", async owner => {
    const { f, b, input } = await compositeFixture(); input.research.range.leaseDurationMs = 1500;
    const before = await counts(), receipts = await client`select id,content_digest from trader_information_sufficiency_receipt_v2 where organization_id=${organizationId}::uuid order by id`;
    expect(await client`select id from trader_information_sufficiency_receipt_v2 where organization_id=${organizationId}::uuid
      and pit_anchor=${f.packets[b]!.analysisPitAnchor}::timestamptz`).toEqual([]);
    const priorStages = async () => ({
      app: await client`select row_to_json(t) body from trader_research_applications_v1 t where organization_id=${organizationId}::uuid`,
      available: await client`select row_to_json(t) body from trader_research_application_availability_v1 t where organization_id=${organizationId}::uuid`,
      research: await client`select row_to_json(t) body from trader_research_understanding_completions_v1 t
        where organization_id=${organizationId}::uuid and source_sequence<=${f.application.currentSourceSequence} order by sequence`,
    });
    const prior = await priorStages();
    await faultAt(researchCompletion, "BEFORE", "RETURN NULL;");
    try {
      if (owner === "composite") expect((await run(input)).status).toBe("RESEARCH_FENCED_INSERT_REQUIRED");
      else {
        const holder = await claimRuntimeControlLeaseAtDatabaseTimeV2(f.db, { organizationId, runtimeInstanceId: "DEE1133-public-noop", durationMs: 1500 });
        expect(holder).not.toBeNull();
        await expect(createSavedResearchOwner(client, f.researchContext, { ...f.application.research,
          range: { ...input.research.range, startSequence: b, count: 1 } }).complete(b, holder!)).rejects.toThrow("RESEARCH_FENCED_INSERT_REQUIRED");
      }
      expect(await savedCompletion(b)).toEqual([]); expect(await counts()).toEqual(before);
      expect(await client`select id,content_digest from trader_information_sufficiency_receipt_v2 where organization_id=${organizationId}::uuid order by id`).toEqual(receipts);
      expect(await priorStages()).toEqual(prior);
    } finally { await clearFault(); }
    await f.expiry(); complete(await run(input)); const recovered = await savedCompletion(b); expect(recovered).toHaveLength(1);
    expect(receipts.map(row => row.id)).not.toContain(recovered[0]!.receipt_id);
    console.info(JSON.stringify({ proof: "DEE1133_NATIVE_SUPPRESSED_COMPLETION_REFUSAL", owner, orphanReceiptCommitted: false, recoveredCompletion: true }));
  }, 45000);
});
