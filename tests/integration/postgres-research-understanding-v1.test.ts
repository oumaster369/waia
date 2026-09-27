import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { beforeAll, beforeEach, afterEach, afterAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema.postgres";
import { seedWp13User } from "./wp13-intelligence-test-helpers";
import { assertRecordedAnalysisTestDatabase } from "../helpers/recorded-paper-public-transport";
import { seedResearchNativeFixture } from "../helpers/research-understanding-fixture";
import { createSavedResearchOwner } from "@/lib/trader/paper/research-understanding-v1/repository-postgres";
import { runSavedResearchLoop } from "@/lib/trader/paper/research-understanding-v1/run-saved-research-loop";
import { claimBoundedResearchRuntimeControlLeaseV2, lockRuntimeOrganizationV2, readRuntimeDatabaseClockV2 } from "@/lib/trader/runtime-authority/v2/runtime-control-lease-database-clock-postgres-v2";
import { decodeBody, encodeBody } from "@/lib/trader/paper/durable-noncapital/recorded-source-read-validation-v1";
import { copy, seal } from "@/lib/trader/paper/durable-noncapital/recorded-analysis-v1";
import { readBoundedResearchInputs, ResearchReadBudget } from "@/lib/trader/paper/research-understanding-v1/bounded-source-postgres";
import { LIMITS, RESEARCH_CONTRACT } from "@/lib/trader/paper/research-understanding-v1/contract";
import { assertSelectedResearchTrust } from "@/lib/trader/paper/research-understanding-v1/admission";
import { evaluateSavedResearchUnderstanding } from "@/lib/trader/paper/research-understanding-v1/evaluate";
import { persistInformationSufficiencyReceiptWithinTransactionV2Postgres } from "@/lib/trader/intelligence/information-sufficiency/information-sufficiency-repository-postgres";
import { createPostgresRuntimeControlLeaseRepositoryV2 } from "@/lib/trader/runtime-authority/v2/runtime-authority-repository-postgres-v2";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { computeSourceTrustDigest } from "@/lib/trader/mi/serialize-source-trust";

const url = process.env.DATABASE_URL_POSTGRES?.trim();
const enabled = process.env.WAIA_PG_INTEGRATION === "1" && !!url;
const children = new Set<ChildProcess>();
const assignmentTable = "trader_research_understanding_assignments_v1";
const completionTable = "trader_research_understanding_completions_v1";
const profileTable = "trader_required_information_profile_v2";
const receiptTable = "trader_information_sufficiency_receipt_v2";
const tables = [assignmentTable, completionTable, profileTable, receiptTable];
const fault = "dee1126_fault";
type Fixture = Awaited<ReturnType<typeof seedResearchNativeFixture>>;
type ResultEvent = { event: string; message?: string; fetches: number; forbidden: string[]; result: Awaited<ReturnType<typeof runSavedResearchLoop>> };
function worker(args: string[], holdAfterResult = false) {
  const child = spawn(process.execPath, ["--import", "tsx", "--conditions=react-server", "tests/helpers/research-understanding-process.ts"], {
    cwd: process.cwd(), env: { PATH: process.env.PATH, CI: process.env.CI, NODE_ENV: "test", WAIA_PG_INTEGRATION: "1", WAIA_TRADER_CLI: "1",
      WAIA_POSTGRES_CLI: "1", WAIA_DB_BACKEND: "postgres", WAIA_POSTGRES_PER_REQUEST_CLIENT: "true", DATABASE_URL_POSTGRES: url,
      WAIA_RESEARCH_TEST_PAYLOAD: JSON.stringify({ args, holdAfterResult }) }, stdio: ["ignore", "pipe", "pipe"] });
  children.add(child); let buffer = ""; let errors = "";
  const result = new Promise<ResultEvent>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`RESEARCH_CHILD_TIMEOUT:${errors}`)), 25000);
    child.stdout!.on("data", chunk => {
      buffer += String(chunk); const lines = buffer.split("\n"); buffer = lines.pop()!;
      for (const line of lines) { let data: ResultEvent; try { data = JSON.parse(line); } catch { continue; }
        if (["result", "error"].includes(data.event)) { clearTimeout(timer); resolve(data); }
      }
    });
    child.stderr!.on("data", chunk => { errors += String(chunk); });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("exit", (code, signal) => { clearTimeout(timer); if (code || signal) reject(new Error(`RESEARCH_CHILD_EXIT:${code}:${signal}:${errors}`)); });
  });
  return { child, result };
}
async function rejectedCause(pending: Promise<unknown>): Promise<string> {
  try { await pending; throw new Error("EXPECTED_REJECTION_MISSING"); }
  catch (error) {
    const messages: string[] = []; let current: unknown = error;
    for (let i = 0; i < 8 && current instanceof Error; i++) { messages.push(current.message); current = current.cause; }
    return messages.join("\n");
  }
}
async function stop(child: ChildProcess) {
  if (child.exitCode === null && child.signalCode === null) { const exit = once(child, "exit"); child.kill("SIGKILL"); await exit; }
  children.delete(child);
}
describe.skipIf(!enabled)("Postgres owned saved research Understanding", () => {
  let client: postgres.Sql; let db: ReturnType<typeof drizzle<typeof schema>>; let organizationId: string; let userId: string; let directory: string;
  async function seed(options: { count?: number; missing4h?: boolean; flat4h?: boolean } = {}) {
    return seedResearchNativeFixture(client, organizationId, userId, { count: 1, ...options });
  }
  async function claim(durationMs = 15000) {
    const value = await claimBoundedResearchRuntimeControlLeaseV2(db, { organizationId, runtimeInstanceId: randomUUID(), durationMs });
    expect(value).not.toBeNull(); return value!;
  }
  async function expiry() { await client`SELECT pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM valid_until_utc-clock_timestamp()))+0.02)
    FROM trader_runtime_control_lease_heads_v2 WHERE organization_id=${organizationId}::uuid`; }
  async function counts() { return Promise.all(tables.map(async table => Number((await client.unsafe(
    `SELECT count(*)::int AS n FROM ${table} WHERE organization_id=$1::uuid`, [organizationId]))[0]!.n))); }
  async function clearFault() {
    for (const table of [...tables, "trader_runtime_control_lease_heads_v2"]) await client.unsafe(`DROP TRIGGER IF EXISTS ${fault} ON ${table}`);
    await client.unsafe(`DROP FUNCTION IF EXISTS ${fault}()`);
  }
  async function faultAt(table: string, timing: "BEFORE" | "AFTER", body = "RAISE EXCEPTION 'DEE1126_INJECTED';") {
    expect([...tables, "trader_runtime_control_lease_heads_v2"]).toContain(table);
    await client.unsafe(`CREATE FUNCTION ${fault}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.organization_id='${organizationId}'::uuid THEN ${body} END IF; RETURN NEW; END $$`);
    await client.unsafe(`CREATE TRIGGER ${fault} ${timing} INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION ${fault}()`);
  }
  async function argsFor(f: Fixture, count = f.request.range.count) {
    await writeFile(path.join(directory, "assignment.json"), JSON.stringify(f.config));
    await writeFile(path.join(directory, "profile.json"), JSON.stringify(f.profileDefinition));
    return ["--saved-research-understanding", `--assignment-file=${directory}/assignment.json`, `--profile-file=${directory}/profile.json`,
      "--start-sequence=0", `--count=${count}`, "--lease-duration-ms=10000"];
  }
  async function currentAssignment(f: Fixture) {
    const rows = await db.select().from(schema.traderResearchUnderstandingAssignmentsV1);
    const row = rows.find(r => r.organizationId === organizationId && r.sessionId === f.config.researchSessionId)!;
    return decodeBody<import("@/lib/trader/paper/research-understanding-v1/contract").ResearchAssignment>(row);
  }
  beforeAll(() => { assertRecordedAnalysisTestDatabase(url); client = postgres(url!, { max: 4 }); db = drizzle(client, { schema }); });
  beforeEach(async () => { userId = randomUUID(); organizationId = await seedWp13User(url!, userId, "DEE1126 isolated saved research");
    directory = await mkdtemp(path.join(tmpdir(), "dee1126-native-")); });
  afterEach(async () => { await Promise.all([...children].map(stop)); await clearFault(); await rm(directory, { recursive: true, force: true }); });
  afterAll(async () => { await client?.end({ timeout: 3 }); });

  it("actual CLI completes two saved packets with positive WHAT/all12 and exact no-transport restart", async () => {
    const f = await seed({ count: 2 }); const args = await argsFor(f);
    const truthBefore = await client`SELECT id, content_digest, available_at FROM trader_mi_source_trust WHERE organization_id=${organizationId}::uuid ORDER BY id`;
    const first = worker(args, true); const event = await first.result;
    expect(event.event).toBe("result"); expect(event.result.status).toBe("COMPLETE"); expect(event.fetches).toBe(0); expect(event.forbidden).toEqual([]);
    expect(event.result.completed.map(x => x.disposition)).toEqual(["COMPLETED_SUPPORTED", "COMPLETED_SUPPORTED"]);
    expect(event.result.completed.map(x => x.outcome)).toEqual(["COMMITTED", "COMMITTED"]);
    // Actual process death after the committed result; restart must not choose a new source, PIT or lease.
    await stop(first.child); const leaseBefore = await client`SELECT * FROM trader_runtime_control_lease_heads_v2 WHERE organization_id=${organizationId}::uuid`;
    const again = await worker(args).result; expect(again.result.status).toBe("COMPLETE"); expect(again.fetches).toBe(0); expect(again.forbidden).toEqual([]);
    expect(again.result.completed.map(x => x.outcome)).toEqual(["REPLAYED", "REPLAYED"]);
    expect(again.result.completed.map(x => x.completionDigest)).toEqual(event.result.completed.map(x => x.completionDigest));
    expect(await client`SELECT * FROM trader_runtime_control_lease_heads_v2 WHERE organization_id=${organizationId}::uuid`).toEqual(leaseBefore);
    const owner = createSavedResearchOwner(client, { organizationId }, f.request);
    for (const sequence of [0, 1]) {
      const c = (await owner.replay(sequence))!.completion; expect(c.output.artifact.claims).toHaveLength(12);
      expect(c.output.artifact.claims.filter(x => x.claimState === "SUPPORTED").map(x => x.marketQuestionId)).toEqual(["Q_WHAT_HAPPENING"]);
      expect(c.output.lanes.every(x => x.evidenceId !== null)).toBe(true); expect(c.packetDigest).toBe(f.packets[sequence]!.contentDigest);
      expect(c.output.analysisPitAnchor).toBe(f.packets[sequence]!.analysisPitAnchor);
    }
    expect(await counts()).toEqual([1, 2, 1, 2]);
    expect(await client`SELECT id, content_digest, available_at FROM trader_mi_source_trust WHERE organization_id=${organizationId}::uuid ORDER BY id`).toEqual(truthBefore);
  }, 40000);
  it("missing4h is an owned honest unresolved completion without padded evidence", async () => {
    const f = await seed({ missing4h: true }); expect((await runSavedResearchLoop(client, { organizationId }, f.request)).status).toBe("COMPLETE");
    const c = (await createSavedResearchOwner(client, { organizationId }, f.request).replay(0))!.completion;
    expect(c.output.disposition).toBe("COMPLETED_UNRESOLVED"); expect(c.output.lanes[1]).toMatchObject({ status: "UNKNOWN", evidenceId: null });
    expect(c.output.artifact.claims).toHaveLength(12); expect(await counts()).toEqual([1, 1, 1, 1]);
  });
  it("native PARTIAL/UNCLEAR preserves supported evidence but records unresolved computation", async () => {
    const f = await seed({ flat4h: true }); expect((await runSavedResearchLoop(client, { organizationId }, f.request)).status).toBe("COMPLETE");
    const c = (await createSavedResearchOwner(client, { organizationId }, f.request).replay(0))!.completion;
    expect(c.output.receipt.status).toBe("SUFFICIENT"); expect(c.output.disposition).toBe("COMPLETED_UNRESOLVED");
    expect(c.output.artifact.claims.find(x => x.marketQuestionId === "Q_WHAT_HAPPENING")!.claimState).toBe("SUPPORTED");
    expect(c.output.questionEvaluations.find(x => x.questionId === "Q_WHAT_HAPPENING")).toMatchObject({ status: "PARTIAL", answerSummary: "UNCLEAR" });
  });
  it.each([profileTable, assignmentTable, receiptTable, completionTable])("%s AFTER fault rolls back its whole atomic command and valid retry is unique", async table => {
    const f = await seed(); const holder = await claim(); const owner = createSavedResearchOwner(client, { organizationId }, f.request);
    await faultAt(table, "AFTER"); await expect(owner.complete(0, holder)).rejects.toThrow();
    expect(await counts()).toEqual(table === profileTable || table === assignmentTable ? [0, 0, 0, 0] : [1, 0, 1, 0]);
    await clearFault(); expect((await owner.complete(0, holder)).outcome).toBe("COMMITTED");
    expect((await owner.complete(0, holder)).outcome).toBe("REPLAYED"); expect(await counts()).toEqual([1, 1, 1, 1]);
  });
  it.each([assignmentTable, completionTable])("%s deferred holder fence rejects expiry inside an AFTER INSERT trigger", async table => {
    const f = await seed(); const holder = await claim(800); const owner = createSavedResearchOwner(client, { organizationId }, f.request);
    await faultAt(table, "AFTER", "PERFORM pg_sleep(1.0);");
    await expect(owner.complete(0, holder)).rejects.toThrow(); expect((await counts())[1]).toBe(0); expect((await counts())[3]).toBe(0);
    await clearFault(); await expiry(); const next = await claim(); expect((await owner.complete(0, next)).outcome).toBe("COMMITTED");
  }, 15000);
  it("stale/foreign holders refuse before assignment/profile effects", async () => {
    const f = await seed(); const holder = await claim(100); await expiry(); const next = await claim();
    const owner = createSavedResearchOwner(client, { organizationId }, f.request);
    await expect(owner.complete(0, holder)).rejects.toThrow("RUNTIME_CONTROL_LEASE_STALE_HOLDER");
    await expect(owner.complete(0, { ...next, organizationId: randomUUID() })).rejects.toThrow("HOLDER_SCOPE_CONFLICT");
    expect(await counts()).toEqual([0, 0, 0, 0]);
  });
  it("competing held commands on different native connections commit one exact effect", async () => {
    const f = await seed(); const holder = await claim(); const other = postgres(url!, { max: 1 });
    try {
      const outcomes = await Promise.all([client, other].map(pool => createSavedResearchOwner(pool, { organizationId }, f.request).complete(0, holder)));
      expect(outcomes.map(r => r.outcome).sort()).toEqual(["COMMITTED", "REPLAYED"]);
      expect(outcomes[0]!.completion).toEqual(outcomes[1]!.completion); expect(await counts()).toEqual([1, 1, 1, 1]);
    } finally { await other.end({ timeout: 3 }); }
  });
  it("does not fork an ordered completion prefix", async () => {
    const f = await seed({ count: 2 }); const holder = await claim(); const owner = createSavedResearchOwner(client, { organizationId }, f.request);
    await expect(owner.complete(1, holder)).rejects.toThrow("EXACT_ROW_SET_MISSING_OR_AMBIGUOUS");
    expect(await counts()).toEqual([1, 0, 1, 0]); await owner.complete(0, holder); const c = (await owner.complete(1, holder)).completion;
    expect(c.previousCompletionDigest).toBe((await owner.replay(0))!.completion.contentDigest);
  });
  it("completed replay works in an actually READ ONLY session and adds no holder or state", async () => {
    const f = await seed(); await runSavedResearchLoop(client, { organizationId }, f.request); const before = await counts();
    const readOnly = postgres(url!, { max: 1, connection: { default_transaction_read_only: true } });
    try { expect((await createSavedResearchOwner(readOnly, { organizationId }, f.request).replay(0))!.outcome).toBe("REPLAYED"); }
    finally { await readOnly.end({ timeout: 3 }); }
    expect(await counts()).toEqual(before);
  });
  it("guards-on stored self-consistent output cannot replace the fixed replay computation", async () => {
    const f = await seed({ count: 2 }); const holder = await claim();
    const owner = createSavedResearchOwner(client, { organizationId }, f.request);
    // The actual command retains a valid assignment/profile but refuses a skipped prefix.
    await expect(owner.complete(1, holder)).rejects.toThrow("EXACT_ROW_SET_MISSING_OR_AMBIGUOUS");
    const assignment = await currentAssignment(f);
    const saved = await db.transaction(tx => readBoundedResearchInputs(tx, assignment, f.profile, 0, new ResearchReadBudget(LIMITS.inputAggregate)),
      { isolationLevel: "repeatable read", accessMode: "read only" });
    const computed = evaluateSavedResearchUnderstanding(saved.packet, assignment, f.profile, saved.revisions);
    const body = copy(computed); delete (body as Partial<typeof body>).contentDigest;
    const output = seal({ ...body, features: { ...body.features, id: "self-consistent-but-not-the-owned-computation" } });
    const completion = seal({ schemaVersion: RESEARCH_CONTRACT, organizationId, researchSessionId: assignment.researchSessionId,
      sequence: 0, sourceSessionId: assignment.sourceSessionId, sourceSequence: 0, assignmentDigest: assignment.contentDigest,
      packetDigest: saved.packet.contentDigest, previousCompletionDigest: null, output });
    // This deliberately trusted direct writer keeps every database guard enabled. A self-seal
    // and valid stored receipt must not substitute for the public reader's actual computation.
    await db.transaction(async tx => {
      await lockRuntimeOrganizationV2(tx, organizationId);
      await persistInformationSufficiencyReceiptWithinTransactionV2Postgres(tx, { organizationId }, output.receipt);
      await tx.insert(schema.traderResearchUnderstandingCompletionsV1).values({ organizationId,
        sessionId: completion.researchSessionId, sequence: 0, contentDigest: completion.contentDigest, bodyJson: encodeBody(completion),
        assignmentDigest: completion.assignmentDigest, sourceSessionId: completion.sourceSessionId, sourceSequence: 0,
        packetDigest: completion.packetDigest, receiptId: output.receipt.id, previousCompletionDigest: null,
        runtimeInstanceId: holder.runtimeInstanceId, leaseEpoch: holder.leaseEpoch, leaseContentDigest: holder.leaseContentDigest });
    }, { isolationLevel: "read committed" });
    expect(await counts()).toEqual([1, 1, 1, 1]);
    await expect(owner.replay(0)).rejects.toThrow("REPLAY_OUTPUT_CONFLICT");
    expect(await counts()).toEqual([1, 1, 1, 1]);
  });
  it("actual USER membership is checked before reads/writes and captured input cannot change scope", async () => {
    const f = await seed(); const holder = await claim();
    await expect(createSavedResearchOwner(client, { organizationId, userId: randomUUID() }, f.request).complete(0, holder)).rejects.toThrow();
    expect(await counts()).toEqual([0, 0, 0, 0]);
    const request = copy(f.request); const context = { organizationId, userId }; const owner = createSavedResearchOwner(client, context, request);
    context.organizationId = randomUUID(); request.assignment.accountId = "mutated-after-capture";
    const result = await owner.complete(0, holder); expect(result.completion.organizationId).toBe(organizationId);
    const assignment = await currentAssignment(f); expect(assignment.actor).toEqual({ kind: "USER", id: userId });
    await expect(createSavedResearchOwner(client, { organizationId }, f.request).replay(0)).rejects.toThrow("ASSIGNMENT_CONFIG_CONFLICT");
  });
  it("same-session changed profile/config and foreign tenant selectors cannot reuse support", async () => {
    const f = await seed(); await runSavedResearchLoop(client, { organizationId }, f.request);
    const altered = copy(f.request); altered.assignment.releaseSha = "c".repeat(40);
    await expect(createSavedResearchOwner(client, { organizationId }, altered).replay(0)).rejects.toThrow("ASSIGNMENT_CONFIG_CONFLICT");
    expect(() => createSavedResearchOwner(client, { organizationId: randomUUID() }, f.request)).toThrow("COMMAND_SCOPE_CONFLICT");
    await client.begin(async tx => { expect(() => createSavedResearchOwner(tx as unknown as postgres.Sql, { organizationId }, f.request)).toThrow("POOL_REQUIRED"); });
  });
  it("selected revision chronology is independently checked against the saved prefix despite unchanged native digest", async () => {
    const f = await seed(); await runSavedResearchLoop(client, { organizationId }, f.request); const assignment = await currentAssignment(f);
    const saved = await db.transaction(tx => readBoundedResearchInputs(tx, assignment, f.profile, 0, new ResearchReadBudget(LIMITS.inputAggregate)), { isolationLevel: "repeatable read", accessMode: "read only" });
    const selected = saved.revisions[0]!; const changed = { ...selected, availableAt: new Date(Date.parse(selected.availableAt!) + 1).toISOString() };
    expect(computeSourceTrustDigest({ ...changed, eventTime: new Date(changed.eventTime), ingestTime: new Date(changed.ingestTime) })).toBe(selected.contentDigest);
    const trust = saved.packet.sources.find(s => (s.trust as { selectedTrustRevisionId?: string })?.selectedTrustRevisionId === selected.id)!.trust;
    expect(() => assertSelectedResearchTrust(trust as Parameters<typeof assertSelectedResearchTrust>[0], changed)).toThrow("SOURCE_REVISION_CHRONOLOGY_CONFLICT");
    // The actual database also refuses changing that immutable selected row; no guard is disabled.
    await expect(client`UPDATE trader_mi_source_trust SET available_at=available_at+interval '1 millisecond' WHERE id=${selected.id}::uuid`).rejects.toThrow(/append-only/);
    expect(await counts()).toEqual([1, 1, 1, 1]);
  });
  it.each([assignmentTable, completionTable])("%s is immutable and invisible to granted browser roles", async table => {
    const f = await seed(); await runSavedResearchLoop(client, { organizationId }, f.request);
    await expect(client.unsafe(`UPDATE ${table} SET body_json=body_json WHERE organization_id=$1::uuid`, [organizationId])).rejects.toThrow();
    await expect(client.unsafe(`DELETE FROM ${table} WHERE organization_id=$1::uuid`, [organizationId])).rejects.toThrow();
    const savedRow = (await client.unsafe(`SELECT row_to_json(t) AS body FROM ${table} t WHERE organization_id=$1::uuid LIMIT 1`, [organizationId]))[0]!.body;
    for (const role of ["anon", "authenticated"]) {
      await expect(client.begin(async tx => {
        await tx.unsafe(`GRANT SELECT, INSERT ON ${table} TO ${role}`); await tx.unsafe(`SET LOCAL ROLE ${role}`);
        expect(await tx.unsafe(`SELECT * FROM ${table} WHERE organization_id=$1::uuid`, [organizationId])).toHaveLength(0);
        await tx.unsafe(`INSERT INTO ${table} SELECT * FROM jsonb_populate_record(NULL::${table}, $1::jsonb)`, [JSON.stringify(savedRow)]);
        throw new Error("BROWSER_INSERT_UNEXPECTEDLY_ALLOWED");
      })).rejects.toThrow(/row-level security|permission denied/);
    }
  });
  it("bounded claim pins READ COMMITTED/5s/30s despite hostile session defaults", async () => {
    const trace: string[] = [];
    const hostile = postgres(url!, { max: 1, debug: (_connection, query) => { trace.push(query); }, connection: { default_transaction_isolation: "repeatable read", lock_timeout: 0, statement_timeout: 0 } });
    await faultAt("trader_runtime_control_lease_heads_v2", "BEFORE", `IF current_setting('transaction_isolation') <> 'read committed' OR current_setting('lock_timeout') <> '5s' OR current_setting('statement_timeout') <> '30s' THEN RAISE EXCEPTION 'WRONG_TRANSACTION_POSTURE'; END IF;`);
    try { expect(await claimBoundedResearchRuntimeControlLeaseV2(drizzle(hostile, { schema }), { organizationId, runtimeInstanceId: "hostile-default", durationMs: 1000 })).not.toBeNull(); }
    finally { await hostile.end({ timeout: 3 }); }
    const firstLock = trace.findIndex(q => q.includes("pg_advisory_xact_lock"));
    expect(firstLock).toBeGreaterThan(0);
    expect(trace.slice(0, firstLock).join("\n")).toMatch(/(?:begin|set transaction)[^\n]*isolation level read committed/i);
    expect(trace.slice(0, firstLock).some(q => q.includes("lock_timeout") && q.includes("5s"))).toBe(true);
    expect(trace.slice(0, firstLock).some(q => q.includes("statement_timeout") && q.includes("30s"))).toBe(true);
  });
  it("a blocked claim with RR session default observes the holder committed after its first lock wait", async () => {
    const blocker = postgres(url!, { max: 1 }); const claimant = postgres(url!, { max: 1, connection: { default_transaction_isolation: "repeatable read" } });
    let release!: () => void; let held!: () => void; const ready = new Promise<void>(r => { held = r; }); const barrier = new Promise<void>(r => { release = r; });
    const holding = drizzle(blocker, { schema }).transaction(async tx => {
      await lockRuntimeOrganizationV2(tx, organizationId); held(); await barrier;
      const time = await readRuntimeDatabaseClockV2(tx); const body = { organizationId, runtimeInstanceId: "committed-while-waiting", leaseEpoch: 1,
        expectedPreviousDigest: null, adjudicatedAtUtc: time, validUntilUtc: new Date(Date.parse(time)+10000).toISOString() };
      const leaseContentDigest = computeSemanticSha256Hex({ schemaVersion: "waia.trader.database_clock_control_lease.v2", ...body });
      expect(await createPostgresRuntimeControlLeaseRepositoryV2(tx).claimExclusive({ ...body, leaseContentDigest })).toBe("CLAIMED");
    });
    await ready;
    const pending = claimBoundedResearchRuntimeControlLeaseV2(drizzle(claimant, { schema }), { organizationId, runtimeInstanceId: "blocked-loser", durationMs: 1000 });
    try {
      const deadline = performance.now()+3000; let blocked = false;
      while (performance.now()<deadline) {
        blocked = Number((await client`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory'`)[0]!.n)>0;
        if (blocked) break; await new Promise(r => setTimeout(r, 10));
      }
      expect(blocked).toBe(true); release(); await holding; expect(await pending).toBeNull();
      const rows = await client`SELECT runtime_instance_id FROM trader_runtime_control_lease_heads_v2 WHERE organization_id=${organizationId}::uuid`;
      expect(rows[0]!.runtime_instance_id).toBe("committed-while-waiting");
      expect(await client`SELECT * FROM trader_runtime_control_lease_epoch_history_v2 WHERE organization_id=${organizationId}::uuid`).toHaveLength(1);
    } finally { release(); await holding; await Promise.all([blocker.end({ timeout: 3 }), claimant.end({ timeout: 3 })]); }
  });
  it("bounded claim statement timeout rolls back history/head even with an active statement", async () => {
    await faultAt("trader_runtime_control_lease_heads_v2", "BEFORE", "PERFORM pg_sleep(31);");
    expect(await rejectedCause(claim(60000))).toMatch(/statement timeout|canceling statement/);
    expect(await client`SELECT * FROM trader_runtime_control_lease_heads_v2 WHERE organization_id=${organizationId}::uuid`).toHaveLength(0);
    expect(await client`SELECT * FROM trader_runtime_control_lease_epoch_history_v2 WHERE organization_id=${organizationId}::uuid`).toHaveLength(0);
    expect(await counts()).toEqual([0, 0, 0, 0]);
  }, 40000);
  it("the first637 lock is bounded and timeout leaves no lease/assignment effect", async () => {
    const blocker = postgres(url!, { max: 1 }); let release!: () => void; let held!: () => void;
    const ready = new Promise<void>(r => { held = r; }); const barrier = new Promise<void>(r => { release = r; });
    const holding = blocker.begin(async tx => { await tx`SELECT pg_advisory_xact_lock(hashtextextended(${organizationId},637))`; held(); await barrier; });
    await ready;
    try { expect(await rejectedCause(claim())).toMatch(/lock timeout|canceling statement/); }
    finally { release(); await holding; await blocker.end({ timeout: 3 }); }
    expect(await client`SELECT * FROM trader_runtime_control_lease_heads_v2 WHERE organization_id=${organizationId}::uuid`).toHaveLength(0);
    expect(await counts()).toEqual([0, 0, 0, 0]);
  }, 10000);
  it("process killed inside receipt/completion transaction leaves neither new record, then retries exactly once", async () => {
    const f = await seed(); const args = await argsFor(f); const blocker = postgres(url!, { max: 1 });
    let release!: () => void; let held!: () => void; const ready = new Promise<void>(r => { held = r; }); const barrier = new Promise<void>(r => { release = r; });
    const holding = blocker.begin(async tx => { await tx`SELECT pg_advisory_xact_lock(1126,637)`; held(); await barrier; }); await ready;
    await faultAt(completionTable, "AFTER", "PERFORM pg_advisory_xact_lock(1126,637);");
    const child = worker(args); const childOutcome = child.result.catch(error => error);
    try {
      const deadline = performance.now()+10000; let blocked = false;
      while (performance.now()<deadline) {
        blocked = Number((await client`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory'
          AND query LIKE '%insert into "trader_research_understanding_completions_v1"%'`)[0]!.n)>0;
        if (blocked) break; await new Promise(r => setTimeout(r, 20));
      }
      expect(blocked).toBe(true); await stop(child.child); await childOutcome;
    } finally { release(); await holding; await blocker.end({ timeout: 3 }); }
    // Wait for the killed socket's transaction rollback; the lease remains until its real expiry.
    await expiry(); await clearFault(); expect(await counts()).toEqual([1, 0, 1, 0]);
    const result = await worker(args).result; expect(result.result.status).toBe("COMPLETE"); expect(await counts()).toEqual([1, 1, 1, 1]);
  }, 30000);
});
