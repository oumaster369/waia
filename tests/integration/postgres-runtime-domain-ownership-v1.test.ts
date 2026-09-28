import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, afterEach, afterAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema.postgres";
import { seedWp13User } from "./wp13-intelligence-test-helpers";
import { assertRecordedAnalysisTestDatabase } from "../helpers/recorded-paper-public-transport";
import { seedApplicationNative, seedSavedDomainApplicationNative } from "../helpers/research-application-v1-process";
import { runSavedApplication, runSavedDomainApplication } from "@/lib/trader/paper/research-application-v1/run-saved-application";
import { runSavedDomainResearchLoop } from "@/lib/trader/paper/research-understanding-v1/run-saved-research-loop";
import { createSavedResearchOwner } from "@/lib/trader/paper/research-understanding-v1/repository-postgres";
import { HeldResearchAccounting, prepareHeldSavedDomainResearchReplay } from "@/lib/trader/paper/research-understanding-v1/held-replay";
import { claimRecordedAcquisitionWithinHeldTransactionV1, claimSavedResearchWithinHeldTransactionV1,
  assertSavedResearchHolderWithinHeldTransactionV1, lockSavedResearchOrganizationV1 } from "@/lib/trader/runtime-authority/v2/noncapital-domain-lease-postgres-v1";
import { claimRuntimeControlLeaseAtDatabaseTimeV2 } from "@/lib/trader/runtime-authority/v2/runtime-control-lease-database-clock-postgres-v2";
import type { SavedApplicationRequest } from "@/lib/trader/paper/research-application-v1/repository-postgres";

const url = process.env.DATABASE_URL_POSTGRES?.trim(), enabled = process.env.WAIA_PG_INTEGRATION === "1" && !!url;
const applicationTables = ["trader_research_application_assignments_v1", "trader_research_applications_v1",
  "trader_research_application_availability_v1", "trader_research_application_consumptions_v1"];
const receiptTables = ["trader_runtime_noncapital_cycles_v2", "trader_recorded_analysis_sessions_v1", "trader_recorded_analysis_packets_v1",
  "trader_recorded_analysis_companions_v1", "trader_research_understanding_assignments_v1", "trader_research_understanding_completions_v1", ...applicationTables];
const completionTable = "trader_research_understanding_completions_v1", consumptionTable = applicationTables[3]!;
const fault = "dee1136_domain_fault", children = new Set<ChildProcess>();
type Fixture = Awaited<ReturnType<typeof seedSavedDomainApplicationNative>>;
type Result = Awaited<ReturnType<typeof runSavedDomainApplication>>;
function complete(result: Result) { expect(result.status).toBe("COMPLETE"); if (!("application" in result)) throw new Error(`DOMAIN_RESULT:${result.status}`); return result; }
function worker(route: "saved" | "acquisition", args: string[], holdAfterResult = false) {
  const child = spawn(process.execPath, ["--import", "tsx", "--conditions=react-server", "tests/helpers/noncapital-domain-process.ts"], {
    cwd: process.cwd(), env: { PATH: process.env.PATH, CI: process.env.CI, NODE_ENV: "test", WAIA_PG_INTEGRATION: "1", WAIA_TRADER_CLI: "1", WAIA_POSTGRES_CLI: "1",
      WAIA_DB_BACKEND: "postgres", WAIA_POSTGRES_PER_REQUEST_CLIENT: "true", DATABASE_URL_POSTGRES: url,
      WAIA_DOMAIN_TEST_PAYLOAD: JSON.stringify({ route, args, holdAfterResult }) }, stdio: ["ignore", "pipe", "pipe"] });
  children.add(child); let buffer = "", errors = "";
  const result = new Promise<{ event: string; result: Result; message?: string; fetches: number; forbidden: string[] }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("DOMAIN_CHILD_TIMEOUT")), 125000);
    child.stdout!.on("data", chunk => { buffer += String(chunk); const lines = buffer.split("\n"); buffer = lines.pop()!;
      for (const line of lines) { let value; try { value = JSON.parse(line); } catch { continue; }
        if (["result", "error"].includes(value.event)) { clearTimeout(timer); resolve(value); } } });
    child.stderr!.on("data", chunk => { errors += String(chunk); });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("exit", (code, signal) => { clearTimeout(timer); if (code || signal) reject(new Error(`DOMAIN_CHILD_EXIT:${code}:${signal}:${errors.slice(-2048)}`)); });
  });
  return { child, result };
}
async function stop(child: ChildProcess) {
  if (child.exitCode === null && child.signalCode === null) { const exited = once(child, "exit"); child.kill("SIGKILL"); await exited; }
  children.delete(child);
}
function errorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? errorCode(error.cause) : null;
}
describe.skipIf(!enabled)("Postgres fixed noncapital domains actual owners", () => {
  let client: postgres.Sql, organizationId: string, userId: string, directory: string;
  const trace: Array<{ query: string; params: unknown[] }> = [];
  const db = () => drizzle(client, { schema });
  const fixture = (options: Parameters<typeof seedSavedDomainApplicationNative>[3] = {}) => seedSavedDomainApplicationNative(client, organizationId, userId, options);
  const run = (input: SavedApplicationRequest) => runSavedDomainApplication(client, { organizationId }, input);
  const records = (table: string) => client.unsafe(`select to_jsonb(t) value from ${table} t where organization_id=$1::uuid order by to_jsonb(t)::text`, [organizationId]);
  const claim = (kind: "saved" | "acquisition", durationMs = 3000) => db().transaction(tx => kind === "saved"
    ? claimSavedResearchWithinHeldTransactionV1(tx, { organizationId, runtimeInstanceId: randomUUID(), durationMs })
    : claimRecordedAcquisitionWithinHeldTransactionV1(tx, { organizationId, runtimeInstanceId: randomUUID(), durationMs }));
  const capital = () => records("trader_runtime_control_lease_heads_v2");
  async function counts() { return Promise.all(applicationTables.map(async table => Number((await client.unsafe(`select count(*)::int n from ${table} where organization_id=$1::uuid`, [organizationId]))[0]!.n))); }
  async function savedCompletion(sequence: number) { return client`select * from trader_research_understanding_completions_v1 where organization_id=${organizationId}::uuid and source_sequence=${sequence}`; }
  async function argsFor(f: Fixture, operation: SavedApplicationRequest["operation"] = "apply", b?: number) {
    const file = path.join(directory, "application.json"); await writeFile(file, JSON.stringify({ configuration: f.application.configuration, research: f.application.research }));
    return ["--saved-research-application", `--application-file=${file}`, `--operation=${operation}`, `--previous-sequence=${f.application.previousSourceSequence}`,
      `--current-sequence=${f.application.currentSourceSequence}`, ...(b === undefined ? [] : [`--consumer-sequence=${b}`])];
  }
  async function composite(options: Parameters<typeof seedSavedDomainApplicationNative>[3] = {}, b = 2) {
    const f = await fixture(options), applied = complete(await run(f.application)); await f.expiry();
    if (b > 2) await f.appendThrough(b - 1);
    await f.appendSourceThrough(b);
    const input: SavedApplicationRequest = { ...f.application, research: { ...f.application.research,
      range: { ...f.application.research.range, leaseDurationMs: 120000 } }, operation: "complete-consumer", consumerSourceSequence: b };
    return { f, applied, b, input };
  }
  async function clearFault() {
    for (const table of [completionTable, consumptionTable]) await client.unsafe(`drop trigger if exists ${fault} on ${table}`);
    await client.unsafe(`drop function if exists ${fault}()`);
  }
  async function faultAt(table: string, body: string) {
    expect([completionTable, consumptionTable]).toContain(table);
    await client.unsafe(`create function ${fault}() returns trigger language plpgsql as $$ begin if NEW.organization_id='${organizationId}'::uuid then ${body} end if; return NEW; end $$`);
    await client.unsafe(`create trigger ${fault} before insert on ${table} for each row execute function ${fault}()`);
  }
  beforeAll(async () => {
    assertRecordedAnalysisTestDatabase(url); client = postgres(url!, { max: 4, debug: (_id, query, params) => trace.push({ query, params: [...params] }) });
    expect(Number((await client`select count(*)::int n from drizzle.__drizzle_migrations`)[0]!.n)).toBe(226);
    expect(await client`select created_at::text from drizzle.__drizzle_migrations order by created_at desc limit 2`)
      .toEqual([{ created_at: "1780000000225" }, { created_at: "1780000000224" }]);
  });
  beforeEach(async () => { userId = randomUUID(); organizationId = await seedWp13User(url!, userId, "DEE1136 synthetic domain proof");
    directory = await mkdtemp(path.join(tmpdir(), "dee1136-native-")); trace.length = 0; });
  afterEach(async () => { vi.restoreAllMocks(); await Promise.all([...children].map(stop)); await clearFault(); await rm(directory, { recursive: true, force: true }); });
  afterAll(async () => { await client?.end({ timeout: 3 }); });

  it("allows three same-org fixed owners concurrently and keeps same-domain busy without touching capital history", async () => {
    const old = await claimRuntimeControlLeaseAtDatabaseTimeV2(db(), { organizationId, runtimeInstanceId: "capital", durationMs: 30000 }); expect(old).not.toBeNull();
    const before = await capital(), history = await records("trader_runtime_control_lease_history_v2");
    const [a, r] = await Promise.all([claim("acquisition", 30000), claim("saved", 30000)]); expect(a).not.toBeNull(); expect(r).not.toBeNull();
    expect(await claim("acquisition")).toBeNull(); expect(await claim("saved")).toBeNull();
    expect(await capital()).toEqual(before); expect(await records("trader_runtime_control_lease_history_v2")).toEqual(history);
    const refs = await records("trader_runtime_ownership_refs_v1"); expect(refs).toHaveLength(3);
    expect(refs.map(row => row.value.ownership_domain).sort()).toEqual(["CAPITAL_LEGACY_V2", "RECORDED_ACQUISITION_V1", "SAVED_RESEARCH_V1"]);
    console.info(JSON.stringify({ proof: "DEE1136_THREE_DOMAINS", refs: refs.length, capitalUnchanged: true }));
  }, 15000);
  it("executes the real recorded acquisition CLI through inert public GET transport and persists four acquisition receipts", async () => {
    const before = await capital();
    const event = await worker("acquisition", ["--durable-noncapital", `--org-id=${organizationId}`, "--account-key=synthetic", "--symbol=BTC/USDT",
      "--session-id=fixed-acquisition", `--release-sha=${"a".repeat(40)}`, "--start-sequence=0", "--max-cycles=1", "--max-packet-bytes=2000000",
      "--max-bars-per-interval=1000", "--lease-duration-ms=30000"]).result;
    expect(event.event, event.message).toBe("result"); expect(event.result.status).toBe("COMPLETE"); expect(event.fetches).toBeGreaterThan(0); expect(event.forbidden).toEqual([]);
    for (const table of receiptTables.slice(0, 4)) { const rows = await records(table); expect(rows).toHaveLength(1); expect(rows[0]!.value.ownership_domain).toBe("RECORDED_ACQUISITION_V1"); }
    expect(await capital()).toEqual(before);
  }, 45000);
  it("executes fixed saved CLI complete-consumer with one holder then replays all ten typed receipt relationships read-only", async () => {
    const { f, input, applied, b } = await composite(); f.application.research.range = input.research.range;
    const before = await capital(), event = await worker("saved", await argsFor(f, "complete-consumer", b)).result;
    expect(event.event, event.message).toBe("result"); expect(event.fetches).toBe(0); expect(event.forbidden).toEqual([]);
    const result = complete(event.result); expect(result.application).toEqual(applied.application); expect(result.consumption?.selection?.selectedRelations).toHaveLength(1);
    const [completion] = await savedCompletion(b), [consumption] = await records(consumptionTable);
    for (const key of ["runtime_instance_id", "lease_epoch", "lease_content_digest", "ownership_domain"]) expect(completion![key]).toBe(consumption!.value[key]);
    const body = JSON.parse(String(completion!.body_json)); expect(body).not.toHaveProperty("contentDigest");
    expect(createHash("sha256").update(String(completion!.body_json)).digest("hex")).toBe(completion!.content_digest);
    const old = await createSavedResearchOwner(client, f.researchContext, { ...input.research, range: { ...input.research.range, startSequence: b, count: 1 } }).replay(b);
    expect(old).toEqual({ outcome: "REPLAYED", completion: { ...body, contentDigest: completion!.content_digest } });
    for (const [index, table] of receiptTables.entries()) {
      const rows = await client.unsafe(`select count(*)::int n from ${table} t join trader_runtime_ownership_refs_v1 r using(ownership_domain,organization_id,runtime_instance_id,lease_epoch,lease_content_digest) where t.organization_id=$1::uuid`, [organizationId]);
      expect(Number(rows[0]!.n)).toBeGreaterThan(0);
      expect((await records(table)).every(row => row.value.ownership_domain === (index < 4 ? "RECORDED_ACQUISITION_V1" : "SAVED_RESEARCH_V1"))).toBe(true);
    }
    trace.length = 0; expect(complete(await run(input)).consumption).toEqual(result.consumption); const replayTrace = [...trace];
    expect(replayTrace.map(q => q.query).join("\n")).not.toMatch(/pg_advisory|for update|insert into|selected_roots/);
    expect(await capital()).toEqual(before);
    console.info(JSON.stringify({ proof: "DEE1136_SAVED_SAME_HOLDER", tenTypedRelationships: true, oldReplayShape: true, finalReplayNoProbeOrClaim: true }));
  }, 60000);
  it("rejects legacy configuration with a new pair at the distinct configuration root before any saved claim", async () => {
    const f = await seedApplicationNative(client, organizationId, userId); complete(await runSavedApplication(client, { organizationId }, f.application));
    await f.appendThrough(3); const input = { ...f.application, previousSourceSequence: 2, currentSourceSequence: 3 };
    const prior = await counts(); trace.length = 0; expect((await run(input)).status).toBe("ASSIGNMENT_DOMAIN_CONFLICT");
    const queries = trace.map(q => q.query); expect(queries.filter(q => q.includes("selected_roots"))).toHaveLength(1);
    expect(queries.join("\n")).not.toMatch(/insert into|pg_advisory|for update/); expect(await counts()).toEqual(prior);
    expect(await records("trader_saved_research_lease_history_v1")).toEqual([]);
  }, 45000);
  it("allows a genuine saved configuration for a later pair without copying or rewriting its original assignment", async () => {
    const f = await fixture(); complete(await run(f.application)); const assignment = await records(applicationTables[0]!);
    await f.expiry(); await f.appendThrough(3); complete(await run({ ...f.application, previousSourceSequence: 2, currentSourceSequence: 3 }));
    expect(await records(applicationTables[0]!)).toEqual(assignment); expect(await counts()).toEqual([1, 2, 2, 0]);
  }, 45000);
  it("reads completed legacy Understanding facts for saved apply but refuses write-capable B in that legacy root", async () => {
    const f = await seedApplicationNative(client, organizationId, userId); complete(await run(f.application)); await f.expiry();
    const before = await records("trader_saved_research_lease_history_v1");
    expect((await run({ ...f.application, operation: "complete-consumer", consumerSourceSequence: 2 })).status).toBe("ASSIGNMENT_DOMAIN_CONFLICT");
    expect(await records("trader_saved_research_lease_history_v1")).toEqual(before); expect(await savedCompletion(2)).toEqual([]);
    expect((await counts()).slice(0, 3)).toEqual([1, 1, 1]);
  }, 45000);
  it("uses one natural32-history ledger with bounded control, candidate bytes and actual submitted SQL", async () => {
    const { f, b, input } = await composite({ hypothesisVersions: 32, priorOrdinal: "p".repeat(60000) }, 3);
    const ledgers: HeldResearchAccounting[] = [], original = HeldResearchAccounting.prototype.budget;
    vi.spyOn(HeldResearchAccounting.prototype, "budget").mockImplementation(function (this: HeldResearchAccounting, maximum) {
      if (!ledgers.includes(this)) ledgers.push(this); return original.call(this, maximum);
    });
    trace.length = 0; const start = performance.now(); const result = complete(await run(input)), elapsedMs = performance.now() - start, queries = [...trace];
    expect(ledgers).toHaveLength(1); const ledger = ledgers[0]!;
    expect(ledger.statements).toBe(queries.length); expect(ledger.statements).toBeLessThanOrEqual(512);
    expect(ledger.inputs.total).toBeLessThanOrEqual(67108864); expect(ledger.noncapitalControls.total).toBeGreaterThan(0); expect(ledger.noncapitalControls.total).toBeLessThanOrEqual(4096);
    expect(elapsedMs).toBeLessThanOrEqual(60000); expect(queries.filter(q => /^begin /i.test(q.query))).toHaveLength(5);
    expect(queries.filter(q => q.query.includes("selected_roots"))).toHaveLength(1);
    expect(queries.filter(q => q.query.includes("octet_length(jsonb_build_object")).length).toBeGreaterThanOrEqual(3);
    expect(result.consumption?.consumer.sourceSequence).toBe(b);
    console.info(JSON.stringify({ proof: "DEE1136_NATURAL32", statements: ledger.statements, uniqueBytes: ledger.inputs.total,
      controlBytes: ledger.noncapitalControls.total, elapsedMs, registrationBytes: await f.hypothesisProjectionBytes(), transactions: 5 }));
  }, 90000);
  it.each(["saved", "acquisition"] as const)("keeps%s lease busy through expiry and rejects stale held identity after real successor", async domain => {
    const first = await claim(domain, 1000); expect(first).not.toBeNull(); expect(await claim(domain)).toBeNull();
    const table = domain === "saved" ? "trader_saved_research_lease_heads_v1" : "trader_recorded_acquisition_lease_heads_v1";
    await client.unsafe(`select pg_sleep(greatest(0,extract(epoch from valid_until_utc-clock_timestamp()))+0.02) from ${table} where organization_id=$1::uuid`, [organizationId]);
    const successor = await claim(domain, 3000); expect(successor?.leaseEpoch).toBe(first!.leaseEpoch + 1);
    if (domain === "saved") await expect(db().transaction(async tx => {
      await lockSavedResearchOrganizationV1(tx, organizationId);
      return assertSavedResearchHolderWithinHeldTransactionV1(tx, first as NonNullable<Awaited<ReturnType<typeof claimSavedResearchWithinHeldTransactionV1>>>);
    })).rejects.toThrow();
    expect(await capital()).toEqual([]);
  }, 15000);
  it("rejects a real claim whose deferred COMMIT crosses expiry and retains no head/history/reference", async () => {
    await expect(db().transaction(async tx => {
      expect(await claimSavedResearchWithinHeldTransactionV1(tx, { organizationId, runtimeInstanceId: "expired-before-commit", durationMs: 500 })).not.toBeNull();
      await tx.execute(sql`select pg_sleep(0.7)`);
    })).rejects.toThrow();
    expect(await records("trader_saved_research_lease_history_v1")).toEqual([]);
    expect(await records("trader_saved_research_lease_heads_v1")).toEqual([]);
    expect(await records("trader_runtime_ownership_refs_v1")).toEqual([]);
  }, 15000);
  it("keeps all ten typed-holder FKs and eight immediate affinity constraints independently validated", async () => {
    const refs = await client`select conname,convalidated,condeferrable,pg_get_constraintdef(oid) definition from pg_constraint
      where conname like 'noncapital_receipt_holder_%' or conname like 'noncapital_affinity_%' order by conname`;
    expect(refs.filter(row => row.conname.startsWith("noncapital_receipt_holder_"))).toHaveLength(10);
    expect(refs.filter(row => row.conname.startsWith("noncapital_affinity_"))).toHaveLength(8);
    expect(refs.every(row => row.convalidated && !row.condeferrable && row.definition.includes("ownership_domain"))).toBe(true);
    const actualFences = await client`select c.relname,t.tgdeferrable,t.tginitdeferred from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_proc p on p.oid=t.tgfoid
      where c.relname=any(${receiptTables}) and p.proname in ('trader_runtime_noncapital_cycles_v2_fence','trader_recorded_analysis_v1_fence')`;
    expect(actualFences).toHaveLength(10); expect(actualFences.every(row => row.tgdeferrable && row.tginitdeferred)).toBe(true);
  });
  it.each(["missing-active", "inactive-only", "wrong-runtime", "wrong-org", "mismatched-parent"])("rejects typed-reference%s and preserves the actual constraint category", async mutation => {
    const holder = await claim("saved", 30000); expect(holder).not.toBeNull();
    const digest = holder!.leaseContentDigest;
    const values = { organizationId, runtime: holder!.runtimeInstanceId, lease: digest, capital: null as string | null, acquisition: null as string | null, saved: digest as string | null };
    if (mutation === "missing-active") values.saved = null;
    if (mutation === "inactive-only") { values.saved = null; values.capital = digest; }
    if (mutation === "wrong-runtime") values.runtime = "wrong-runtime";
    if (mutation === "wrong-org") values.organizationId = randomUUID();
    if (mutation === "mismatched-parent") { values.lease = "0".repeat(64); values.saved = digest; }
    const error = await client`insert into trader_runtime_ownership_refs_v1(ownership_domain,organization_id,runtime_instance_id,lease_epoch,lease_content_digest,
      capital_parent_digest,acquisition_parent_digest,research_parent_digest) values('SAVED_RESEARCH_V1',${values.organizationId}::uuid,${values.runtime},${holder!.leaseEpoch},
      ${values.lease},${values.capital},${values.acquisition},${values.saved})`.then(() => null, error => error);
    expect(error).not.toBeNull();
    // A duplicate existing PK wins before FK enforcement for wrong-runtime.
    // This is recorded as uniqueness evidence, never as direct parent-FK proof.
    expect(errorCode(error)).toBe(mutation === "wrong-runtime" ? "23505" : mutation === "wrong-org" ? "23503" : "23514");
    expect(await records("trader_runtime_ownership_refs_v1")).toHaveLength(1);
  });
  it.each(["completion", "consumption"] as const)("rolls back%s stage effects at actual expiry and preserves only the committed prefix", async stage => {
    const { f, input, b } = await composite(); input.research.range.leaseDurationMs = 1500;
    await faultAt(stage === "completion" ? completionTable : consumptionTable, "PERFORM pg_sleep(2.0);");
    expect((await run(input).catch(() => null))?.status).not.toBe("COMPLETE");
    expect(await savedCompletion(b)).toHaveLength(stage === "completion" ? 0 : 1); expect(await counts()).toEqual([1, 1, 1, 0]);
    await clearFault(); await f.expiry(); complete(await run(input)); expect(await savedCompletion(b)).toHaveLength(1);
  }, 60000);
  it.each(["completion-before-commit", "consumption-before-commit", "consumption-after-commit"] as const)("retains the true saved-domain prefix after process death at%s", async phase => {
    const { f, input, b } = await composite(); input.research.range.leaseDurationMs = 10000; f.application.research.range = input.research.range;
    const table = phase === "completion-before-commit" ? completionTable : consumptionTable;
    if (phase !== "consumption-after-commit") await faultAt(table, "PERFORM pg_sleep(3.0);");
    const child = worker("saved", await argsFor(f, "complete-consumer", b), phase === "consumption-after-commit"), pending = child.result.catch(() => null);
    let pid: number | null = null;
    if (phase === "consumption-after-commit") { const result = await pending; expect(result?.event).toBe("result"); complete(result!.result); }
    else {
      const deadline = performance.now() + 15000;
      while (performance.now() < deadline) {
        const waits = await client`select pid from pg_stat_activity where datname=current_database() and wait_event='PgSleep'
          and query like ${`%insert into "${table}"%`} and pid<>pg_backend_pid()`;
        if (waits.length) { pid = Number(waits[0]!.pid); break; } await new Promise(resolve => setTimeout(resolve, 25));
      }
      expect(pid).not.toBeNull();
    }
    await stop(child.child); await pending;
    if (pid !== null) {
      const deadline = performance.now() + 10000;
      while (performance.now() < deadline && (await client`select pid from pg_stat_activity where pid=${pid}`).length) await new Promise(resolve => setTimeout(resolve, 25));
      expect(await client`select pid from pg_stat_activity where pid=${pid}`).toEqual([]);
    }
    const retained = await savedCompletion(b); expect(retained).toHaveLength(phase === "completion-before-commit" ? 0 : 1);
    expect(await counts()).toEqual([1, 1, 1, phase === "consumption-after-commit" ? 1 : 0]);
    await clearFault(); if (phase !== "consumption-after-commit") { expect((await run(input)).status).toBe("APPLICATION_LEASE_BUSY"); await f.expiry(); }
    complete(await run(input)); if (retained.length) expect(await savedCompletion(b)).toEqual(retained);
    console.info(JSON.stringify({ proof: "DEE1136_CRASH_PREFIX", phase, retainedCompletion: retained.length, backendClosed: true }));
  }, 60000);
  it("refuses simulated-monotonic late ACK after actual B COMMIT without erasing its durable receipt", async () => {
    const { f, input, b } = await composite(); input.research.range.leaseDurationMs = 1500;
    const original = client.begin.bind(client); let count = 0, now = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    const begin = vi.spyOn(client, "begin").mockImplementation(((options: string, callback: (held: postgres.TransactionSql) => Promise<unknown>) =>
      original(options, callback).then(result => { if (++count === 4) now = 120001; return result; })) as typeof client.begin);
    try { expect((await run(input)).status).toBe("INVOCATION_DEADLINE_EXCEEDED"); }
    finally { begin.mockRestore(); clock.mockRestore(); }
    expect(await savedCompletion(b)).toHaveLength(1); expect(await counts()).toEqual([1, 1, 1, 0]);
    await f.expiry(); complete(await run(input));
    console.info(JSON.stringify({ proof: "DEE1136_SIMULATED_LATE_ACK", actualBCommit: true, simulatedMonotonicMs: now, actualElapsed120sClaimed: false }));
  }, 45000);
  it("charges induced actual dispatch to the original ledger and reserves rollback for slot512", async () => {
    const { input, b } = await composite(); const observed: { ledger?: HeldResearchAccounting } = {}; let invocations = 0, injected = 0;
    const originalBudget = HeldResearchAccounting.prototype.budget, originalBegin = client.begin.bind(client);
    vi.spyOn(HeldResearchAccounting.prototype, "budget").mockImplementation(function (this: HeldResearchAccounting, maximum) {
      if (observed.ledger && observed.ledger !== this) throw new Error("DOMAIN_LEDGER_RESET"); observed.ledger = this; return originalBudget.call(this, maximum);
    });
    const begin = vi.spyOn(client, "begin").mockImplementation(((options: string, callback: (held: postgres.TransactionSql) => Promise<unknown>) => originalBegin(options, async held => {
      if (++invocations === 4) {
        expect(observed.ledger).toBeDefined(); const bound = prepareHeldSavedDomainResearchReplay(client, observed.ledger!).bindHeld(held);
        while (observed.ledger!.statements < 511) { await bound.executor.execute(sql`select 1 as dee1136_induced_dispatch`); injected++; }
      }
      return callback(held);
    })) as typeof client.begin);
    trace.length = 0;
    try { expect((await run(input)).status).toBe("STATEMENT_LIMIT_EXCEEDED"); expect(observed.ledger!.statements).toBe(512);
      expect(trace).toHaveLength(512); expect(trace.at(-1)!.query.toLowerCase()).toBe("rollback"); }
    finally { begin.mockRestore(); vi.restoreAllMocks(); }
    expect(await savedCompletion(b)).toEqual([]); expect(await counts()).toEqual([1, 1, 1, 0]);
    console.info(JSON.stringify({ proof: "DEE1136_INDUCED_513", injectedActualSelects: injected, reservedRollback: true, statements: 512 }));
  }, 45000);
  it.each(["composite", "range"] as const)("refuses suppressed completion through the actual%s owner with no orphan receipt", async owner => {
    const { f, input, b } = await composite(); input.research.range.leaseDurationMs = 1500;
    const receipts = await records("trader_information_sufficiency_receipt_v2"); await faultAt(completionTable, "RETURN NULL;");
    const result = owner === "composite" ? await run(input) : await runSavedDomainResearchLoop(client, f.researchContext,
      { ...input.research, range: { ...input.research.range, startSequence: b, count: 1 } });
    expect(result.status).toBe("RESEARCH_FENCED_INSERT_REQUIRED"); expect(await savedCompletion(b)).toEqual([]);
    expect(await records("trader_information_sufficiency_receipt_v2")).toEqual(receipts); expect(await counts()).toEqual([1, 1, 1, 0]);
    await clearFault(); await f.expiry(); complete(await run(input));
  }, 45000);
});
