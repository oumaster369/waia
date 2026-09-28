import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { canonicalizeSemanticJsonString } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { beforeAll, beforeEach, afterEach, afterAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema.postgres";
import { seedWp13User } from "./wp13-intelligence-test-helpers";
import { assertRecordedAnalysisTestDatabase } from "../helpers/recorded-paper-public-transport";
import { seedApplicationNative, seedSavedDomainApplicationNative } from "../helpers/research-application-v1-process";
import { runSavedApplication, runSavedDomainApplication } from "@/lib/trader/paper/research-application-v1/run-saved-application";
import { runSavedDomainResearchLoop } from "@/lib/trader/paper/research-understanding-v1/run-saved-research-loop";
import { createSavedResearchOwner } from "@/lib/trader/paper/research-understanding-v1/repository-postgres";
import { ResearchReadBudget } from "@/lib/trader/paper/research-understanding-v1/bounded-source-postgres";
import { HeldResearchAccounting, prepareHeldSavedDomainResearchReplay } from "@/lib/trader/paper/research-understanding-v1/held-replay";
import { claimRecordedAcquisitionWithinHeldTransactionV1, claimSavedResearchWithinHeldTransactionV1,
  assertSavedResearchHolderWithinHeldTransactionV1, lockSavedResearchOrganizationV1,
  assertRecordedAcquisitionHolderWithinHeldTransactionV1, lockRecordedAcquisitionOrganizationV1 } from "@/lib/trader/runtime-authority/v2/noncapital-domain-lease-postgres-v1";
import { claimRuntimeControlLeaseAtDatabaseTimeV2 } from "@/lib/trader/runtime-authority/v2/runtime-control-lease-database-clock-postgres-v2";
import { commitRecordedNoncapitalCyclePostgresV2 } from "@/lib/trader/runtime-v2/noncapital-cycle-owner-postgres-v2";
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
  const result = new Promise<{ event: string; result: Result; message?: string; fetches: number; forbidden: string[]; observationalImports: string[]; transport: Array<{ method: string; host: string; path: string; authenticated: boolean }> }>((resolve, reject) => {
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
function insertParameter(query: string, column: string) {
  const parsed = /^insert into "[^"]+" \(([^)]+)\) values \(([^)]+)\)/.exec(query);
  if (!parsed) throw new Error("DOMAIN_SINGLE_INSERT_REQUIRED");
  const columns = parsed[1]!.split(",").map(value => value.trim().replaceAll('"', ""));
  const term = parsed[2]!.split(",").map(value => value.trim())[columns.indexOf(column)];
  if (!term || !/^\$[1-9][0-9]*$/.test(term)) throw new Error(`DOMAIN_INSERT_PARAMETER_REQUIRED:${column}`);
  return Number(term.slice(1)) - 1;
}
describe.skipIf(!enabled)("Postgres fixed noncapital domains actual owners", () => {
  let client: postgres.Sql, organizationId: string, userId: string, directory: string;
  const trace: Array<{ query: string; params: unknown[] }> = [];
  const db = () => drizzle(client, { schema });
  const fixture = (options: Parameters<typeof seedSavedDomainApplicationNative>[3] = {}) => seedSavedDomainApplicationNative(client, organizationId, userId, options);
  const run = (input: SavedApplicationRequest) => runSavedDomainApplication(client, { organizationId }, input);
  const records = (table: string) => client.unsafe(`select to_jsonb(t) value from ${table} t where organization_id=$1::uuid order by to_jsonb(t)::text`, [organizationId]);
  const claim = (kind: "saved" | "acquisition", durationMs = 3000) => db().transaction(async tx => kind === "saved"
    ? await claimSavedResearchWithinHeldTransactionV1(tx, { organizationId, runtimeInstanceId: randomUUID(), durationMs }, new HeldResearchAccounting().noncapitalControls)
    : await claimRecordedAcquisitionWithinHeldTransactionV1(tx, { organizationId, runtimeInstanceId: randomUUID(), durationMs }));
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
    for (const table of receiptTables) await client.unsafe(`drop trigger if exists ${fault} on ${table}`);
    await client.unsafe(`drop function if exists ${fault}()`);
  }
  async function faultAt(table: string, body: string) {
    expect(receiptTables).toContain(table);
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
    const before = await capital(), history = await records("trader_runtime_control_lease_epoch_history_v2");
    const [a, r] = await Promise.all([claim("acquisition", 30000), claim("saved", 30000)]); expect(a).not.toBeNull(); expect(r).not.toBeNull();
    expect(await claim("acquisition")).toBeNull(); expect(await claim("saved")).toBeNull();
    expect(await capital()).toEqual(before); expect(await records("trader_runtime_control_lease_epoch_history_v2")).toEqual(history);
    const refs = await records("trader_runtime_ownership_refs_v1"); expect(refs).toHaveLength(3);
    expect(refs.map(row => row.value.ownership_domain).sort()).toEqual(["CAPITAL_LEGACY_V2", "RECORDED_ACQUISITION_V1", "SAVED_RESEARCH_V1"]);
    console.info(JSON.stringify({ proof: "DEE1136_THREE_DOMAINS", refs: refs.length, capitalUnchanged: true }));
  }, 15000);
  it("executes the real recorded acquisition CLI through inert public GET transport and persists four acquisition receipts", async () => {
    const before = await capital();
    const authorityTables = ["trader_runtime_authority_assessments_v2", "trader_risk_allowances_v2", "trader_execution_plans_v2", "trader_execution_attempts_v2", "trader_orders"];
    const authorityBefore = await Promise.all(authorityTables.map(records));
    const event = await worker("acquisition", ["--durable-noncapital", `--org-id=${organizationId}`, "--account-key=synthetic", "--symbol=BTC/USDT",
      "--session-id=fixed-acquisition", `--release-sha=${"a".repeat(40)}`, "--start-sequence=0", "--max-cycles=1", "--max-packet-bytes=2000000",
      "--max-bars-per-interval=1000", "--lease-duration-ms=30000"]).result;
    expect(event.event, event.message).toBe("result"); expect(event.result.status).toBe("COMPLETE"); expect(event.fetches).toBeGreaterThan(0); expect(event.forbidden).toEqual([]);
    for (const table of receiptTables.slice(0, 4)) { const rows = await records(table); expect(rows).toHaveLength(1); expect(rows[0]!.value.ownership_domain).toBe("RECORDED_ACQUISITION_V1"); }
    expect(await capital()).toEqual(before); expect(await Promise.all(authorityTables.map(records))).toEqual(authorityBefore);
    expect(event.observationalImports.sort()).toEqual(["lib/trader/paper/durable-noncapital/evaluate-recorded-analysis-v1.ts",
      "lib/trader/intelligence/evaluation-cycle.ts", "lib/trader/execution/v2/execution-admission-proof-v2.ts",
      "lib/trader/execution/order-repository.types.ts", "lib/trader/execution/cost-model.ts",
      "lib/trader/execution/htr-historical-cost-model-authority.ts"].sort());
    expect(event.transport).toHaveLength(8); expect(event.transport.every(t => t.method === "GET" && t.host === "api.huobi.pro" && !t.authenticated)).toBe(true);
    const [cycle] = await records(receiptTables[0]!); expect(JSON.parse(cycle!.value.canonical_json).result.status).toBe("NO_TRADE");
    const [companion] = await records(receiptTables[3]!); const output = JSON.parse(companion!.value.body_json).output;
    expect(output.authority).toBe("OBSERVATIONAL_ONLY");
    for (const key of ["understandingArtifact", "canonicalRuntimeIntelligenceState", "intelligenceCycleBundle", "forecastDecisionBundle"])
      expect(output.evaluation[key]).toBeUndefined();
    console.info(JSON.stringify({ proof: "DEE1136_ACQUISITION_BOUNDARY", publicGetCalls: event.transport.length, noAuthorityEffects: true, observationalImports: event.observationalImports }));
  }, 45000);
  it("executes fixed saved CLI complete-consumer with one holder then replays all ten typed receipt relationships read-only", async () => {
    const { f, input, applied, b } = await composite(); f.application.research.range = input.research.range;
    const before = await capital(), event = await worker("saved", await argsFor(f, "complete-consumer", b)).result;
    expect(event.event, event.message).toBe("result"); expect(event.fetches).toBe(0); expect(event.forbidden).toEqual([]);
    expect(event.transport).toEqual([]); expect(event.observationalImports).toEqual([]);
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
  it("replays an initially complete foreign final with no root probe or SAVED claim", async () => {
    const f = await seedApplicationNative(client, organizationId, userId);
    const legacy = complete(await runSavedApplication(client, { organizationId }, f.application));
    const prior = await Promise.all([...applicationTables, "audit_logs", "trader_runtime_control_lease_epoch_history_v2"].map(records));
    trace.length = 0; const replay = complete(await run(f.application)); const queries = [...trace];
    expect(replay.application).toEqual(legacy.application); expect(replay.availability).toEqual(legacy.availability); expect(replay.outcome).toBe("REPLAYED");
    expect(queries.map(q => q.query).join("\n")).not.toMatch(/selected_roots|pg_advisory|for update|insert into/i);
    expect(await records("trader_saved_research_lease_history_v1")).toEqual([]);
    expect(await Promise.all([...applicationTables, "audit_logs", "trader_runtime_control_lease_epoch_history_v2"].map(records))).toEqual(prior);
  }, 45000);
  it.each(["configuration", "pair"] as const)("refuses a genuine late legacy%s root after the first RR probe and accounts for the committed SAVED claim", async root => {
    const f = await fixture(); if (root === "configuration") await f.appendThrough(3);
    const input = { ...f.application, previousSourceSequence: root === "configuration" ? 2 : 0, currentSourceSequence: root === "configuration" ? 3 : 1 };
    const peer = postgres(url!, { max: 1 }), original = client.begin.bind(client); let first = true, foreign: unknown[] = [];
    const priorHistory = await records("trader_saved_research_lease_history_v1");
    const begin = vi.spyOn(client, "begin").mockImplementation(((options: string, callback: (held: postgres.TransactionSql) => Promise<unknown>) =>
      original(options, callback).then(async value => {
        if (first) { first = false; complete(await runSavedApplication(peer, { organizationId }, f.application));
          foreign = await Promise.all([...applicationTables, "audit_logs"].map(records)); }
        return value;
      })) as typeof client.begin);
    trace.length = 0;
    try { expect((await run(input)).status).toBe("ASSIGNMENT_DOMAIN_CONFLICT"); }
    finally { begin.mockRestore(); await peer.end({ timeout: 3 }); }
    expect(trace.filter(q => q.query.includes("selected_roots"))).toHaveLength(2);
    expect(await Promise.all([...applicationTables, "audit_logs"].map(records))).toEqual(foreign);
    expect((await records("trader_saved_research_lease_history_v1")).length).toBe(priorHistory.length + 1);
    expect((await records(applicationTables[1]!)).every(row => row.value.ownership_domain === "CAPITAL_LEGACY_V2")).toBe(true);
    console.info(JSON.stringify({ proof: "DEE1136_OBSERVED_ROOT_RACE", root, probes: 2, foreignRowsUnchanged: true, committedSavedClaim: true }));
  }, 60000);
  it("accepts a genuine compatible SAVED pair appearing after the first probe with at most one charged re-probe", async () => {
    const f = await fixture(), peer = postgres(url!, { max: 1 }), original = client.begin.bind(client); let first = true, saved: unknown[] = [];
    const begin = vi.spyOn(client, "begin").mockImplementation(((options: string, callback: (held: postgres.TransactionSql) => Promise<unknown>) =>
      original(options, callback).then(async value => {
        if (first) { first = false; complete(await runSavedDomainApplication(peer, { organizationId }, f.application));
          saved = await Promise.all([...applicationTables, "audit_logs"].map(records)); await f.expiry(); }
        return value;
      })) as typeof client.begin);
    trace.length = 0;
    try { complete(await run(f.application)); }
    finally { begin.mockRestore(); await peer.end({ timeout: 3 }); }
    expect(trace.filter(q => q.query.includes("selected_roots"))).toHaveLength(2);
    expect(await Promise.all([...applicationTables, "audit_logs"].map(records))).toEqual(saved);
  }, 60000);
  it("preserves actual uniqueness refusal for a configuration committed outside the existing RR snapshot", async () => {
    const f = await fixture(); await f.appendThrough(3);
    const input = { ...f.application, research: { ...f.application.research, range: { ...f.application.research.range, leaseDurationMs: 30000 } },
      previousSourceSequence: 2, currentSourceSequence: 3 };
    await faultAt(applicationTables[0]!, "IF NEW.ownership_domain='SAVED_RESEARCH_V1' THEN PERFORM pg_sleep(8); END IF;");
    const peer = postgres(url!, { max: 1 }); trace.length = 0;
    const pending = run(input).then(value => ({ value, error: null }), error => ({ value: null, error }));
    let pid: number | null = null;
    try {
      const deadline = performance.now() + 15000;
      while (performance.now() < deadline) {
        const rows = await peer`select pid from pg_stat_activity where datname=current_database() and wait_event='PgSleep'
          and query like '%insert into "trader_research_application_assignments_v1"%' and pid<>pg_backend_pid()`;
        if (rows.length) { pid = Number(rows[0]!.pid); break; } await new Promise(resolve => setTimeout(resolve, 25));
      }
      expect(pid).not.toBeNull(); complete(await runSavedApplication(peer, { organizationId }, f.application));
      const retained = await Promise.all([...applicationTables, "audit_logs"].map(records));
      const result = await pending; expect(errorCode(result.error)).toBe("23505");
      expect(trace.filter(q => q.query.includes("selected_roots"))).toHaveLength(1);
      expect(await Promise.all([...applicationTables, "audit_logs"].map(records))).toEqual(retained);
      console.info(JSON.stringify({ proof: "DEE1136_INVISIBLE_ROOT_RACE", sqlstate: errorCode(result.error), probes: 1, actualServerWait: true, foreignRowsUnchanged: true }));
    } finally { await pending; await peer.end({ timeout: 3 }); }
  }, 60000);
  it("uses one natural32-history ledger with bounded control, candidate bytes and actual submitted SQL", async () => {
    const { f, b, input } = await composite({ hypothesisVersions: 32, priorOrdinal: "p".repeat(60000) }, 3);
    const ledgers: HeldResearchAccounting[] = [], original = HeldResearchAccounting.prototype.budget;
    const admissions: Array<{ table: string; identity: string; bytes: number; projection: string | undefined }> = [];
    const originalAdmit = ResearchReadBudget.prototype.admit;
    vi.spyOn(ResearchReadBudget.prototype, "admit").mockImplementation(function (this: ResearchReadBudget, table, identity, bytes, maximum, projection) {
      if (table === completionTable || table === "trader_information_sufficiency_receipt_v2") admissions.push({ table, identity, bytes, projection });
      return originalAdmit.call(this, table, identity, bytes, maximum, projection);
    });
    vi.spyOn(HeldResearchAccounting.prototype, "budget").mockImplementation(function (this: HeldResearchAccounting, maximum) {
      if (!ledgers.includes(this)) ledgers.push(this); return original.call(this, maximum);
    });
    trace.length = 0; const start = performance.now(); const result = complete(await run(input)), elapsedMs = performance.now() - start, queries = [...trace];
    expect(ledgers).toHaveLength(1); const ledger = ledgers[0]!;
    expect(ledger.statements).toBe(queries.length); expect(ledger.statements).toBeLessThanOrEqual(512);
    expect(ledger.inputs.total).toBeLessThanOrEqual(67108864); expect(ledger.noncapitalControls.total).toBeGreaterThan(0); expect(ledger.noncapitalControls.total).toBeLessThanOrEqual(4096);
    expect(elapsedMs).toBeLessThanOrEqual(60000);
    expect(queries.filter(q => /^begin /i.test(q.query)).map(q => q.query.toLowerCase())).toEqual([
      "begin isolation level repeatable read read only", "begin isolation level read committed", "begin isolation level repeatable read read only",
      "begin isolation level read committed", "begin isolation level repeatable read"]);
    expect(queries.filter(q => /^commit$/i.test(q.query))).toHaveLength(5);
    const selected = [input.previousSourceSequence, input.currentSourceSequence, b];
    for (const [table, sessionId] of [["trader_recorded_analysis_packets_v1", input.configuration.sourceSessionId],
      [completionTable, input.configuration.researchSessionId]] as const) {
      const bodies: number[] = [], metadata: number[] = [];
      for (const read of queries.filter(q => q.query.startsWith("select ") && q.query.includes(`from "${table}"`) && !q.query.includes("octet_length"))) {
        const scope = read.query.match(new RegExp(`from "${table}" where ([\\s\\S]+?) limit (?:\\$(\\d+)|(\\d+))\\s*$`, "i"));
        expect(scope, read.query).not.toBeNull();
        const parameter = (column: string) => {
          const match = scope![1]!.match(new RegExp(`"${table}"\\."${column}" = \\$(\\d+)`));
          if (!match) throw new Error(`DOMAIN_BODY_SCOPE_MISSING:${column}`); return Number(match[1]) - 1;
        };
        expect(read.params[parameter("organization_id")]).toBe(organizationId); expect(read.params[parameter("session_id")]).toBe(sessionId);
        expect(scope![2] ? read.params[Number(scope![2]) - 1] : Number(scope![3])).toBe(2);
        if (scope![2]) expect(Number(scope![2]) - 1).not.toBe(parameter("sequence"));
        const sequence = Number(read.params[parameter("sequence")]) + (table === completionTable ? input.research.assignment.firstSourceSequence : 0);
        if (read.query.includes('"body_json"')) bodies.push(sequence);
        else {
          expect(table).toBe(completionTable); const projection = [...read.query.matchAll(/as "([^"]+)"/g)].map(m => m[1]);
          if (projection.length === 1 && projection[0] === "receiptId") expect(selected).toContain(sequence);
          else { metadata.push(sequence); expect(projection).toEqual(["organizationId", "sessionId", "sequence", "contentDigest", "assignmentDigest", "sourceSessionId", "sourceSequence", "packetDigest"]); }
        }
      }
      expect([...new Set(bodies)].sort()).toEqual(selected); if (table === completionTable) expect(metadata).toContain(b - 1);
    }
    expect(queries.filter(q => q.query.includes("selected_roots"))).toHaveLength(1);
    expect(queries.filter(q => q.query.includes("octet_length(jsonb_build_object")).length).toBeGreaterThanOrEqual(3);
    expect(result.consumption?.consumer.sourceSequence).toBe(b);
    const receiptWrite = queries.findIndex(q => q.query.startsWith('insert into "trader_information_sufficiency_receipt_v2"'));
    const completionWrite = queries.findIndex(q => q.query.startsWith(`insert into "${completionTable}"`));
    expect(receiptWrite).toBeGreaterThan(0); expect(completionWrite).toBeGreaterThan(receiptWrite);
    expect(queries.slice(0, receiptWrite).filter(q => q.query.includes("octet_length(jsonb_build_object"))).toHaveLength(2);
    const completionBytes = Number((await client`select octet_length(to_jsonb(q)::text)::int bytes from (select
      organization_id as "organizationId", session_id as "sessionId", sequence, content_digest as "contentDigest", body_json as "bodyJson",
      assignment_digest as "assignmentDigest", source_session_id as "sourceSessionId", source_sequence as "sourceSequence", packet_digest as "packetDigest",
      receipt_id as "receiptId", previous_completion_digest as "previousCompletionDigest", runtime_instance_id as "runtimeInstanceId", lease_epoch as "leaseEpoch",
      lease_content_digest as "leaseContentDigest" from trader_research_understanding_completions_v1 where organization_id=${organizationId}::uuid and source_sequence=${b}) q`)[0]!.bytes);
    const selectedAdmissions = admissions.filter(row => row.table === completionTable && row.projection === "completion" && JSON.parse(row.identity)[2] === b);
    expect(selectedAdmissions.length).toBeGreaterThan(1); expect(selectedAdmissions.every(row => row.bytes === completionBytes)).toBe(true);
    console.info(JSON.stringify({ proof: "DEE1136_NATURAL32", statements: ledger.statements, uniqueBytes: ledger.inputs.total,
      controlBytes: ledger.noncapitalControls.total, elapsedMs, registrationBytes: await f.hypothesisProjectionBytes(), transactions: 5,
      selectedBodies: selected, predecessorMetadataOnly: b - 1, candidateMetadataBeforeReceipt: true, completionBytes }));
  }, 90000);
  it("refuses an actual 33-version saved registry at metadata admission without fetching that history body", async () => {
    const f = await fixture({ hypothesisVersions: 33 }), before = await counts(); trace.length = 0;
    const result = await run(f.application), queries = [...trace];
    expect(result.status).toBe("APPLICATION_ROW_SET_REFUSED");
    const selected = queries.filter(q => q.query.includes('from "trader_mi_hypothesis"') && q.query.includes('order by "trader_mi_hypothesis"."version_seq"'));
    expect(selected).toHaveLength(1); expect(selected[0]!.query).toContain("octet_length");
    expect(selected[0]!.query).toMatch(/limit \$[0-9]+/); expect(selected[0]!.params).toContain(33);
    expect(queries.some(q => applicationTables.some(table => q.query.startsWith(`insert into "${table}"`)))).toBe(false);
    expect(await counts()).toEqual(before);
    console.info(JSON.stringify({ proof: "DEE1136_SELECTED_HISTORY33", status: result.status, metadataOnly: true, newStageRows: 0 }));
  }, 45000);
  it.each([65536, 65537])("measures actual saved registry projection at%dbytes and preserves restart or refuses before body", async target => {
    const f = await fixture({ targetHypothesisBytes: target }); expect(await f.hypothesisProjectionBytes()).toBe(target);
    const before = await counts(); trace.length = 0;
    const result = await run(f.application), queries = [...trace];
    const selected = queries.filter(q => q.query.includes('from "trader_mi_hypothesis"') && q.params.includes(f.hypothesis.id));
    expect(selected.length).toBeGreaterThan(0); expect(selected[0]!.query).toContain("octet_length");
    if (target === 65537) {
      expect(result.status).toBe("STORED_ROW_LIMIT_EXCEEDED"); expect(selected).toHaveLength(1); expect(await counts()).toEqual(before);
    } else {
      const applied = complete(result), replay = await worker("saved", await argsFor(f, "replay")).result;
      expect(replay.event, replay.message).toBe("result"); expect(complete(replay.result).application).toEqual(applied.application);
      expect(replay.forbidden).toEqual([]); expect(replay.fetches).toBe(0); expect(queries.length).toBeLessThanOrEqual(512);
    }
    console.info(JSON.stringify({ proof: "DEE1136_REGISTERED_ROW_BOUND", actualProjectionBytes: target, status: result.status }));
  }, 45000);
  it("accounts a genuine 32-input saved Understanding range and resumes an honest budget-limited prefix with a fresh invocation", async () => {
    const f = await fixture({ savedSource32: true }); await f.appendSourceThrough(31); expect(f.packets).toHaveLength(32);
    const preserved = await records(completionTable); expect(preserved).toHaveLength(2);
    const ledgers: HeldResearchAccounting[] = [], original = HeldResearchAccounting.prototype.budget;
    vi.spyOn(HeldResearchAccounting.prototype, "budget").mockImplementation(function (this: HeldResearchAccounting, cap: number) {
      if (!ledgers.includes(this)) ledgers.push(this); return original.call(this, cap);
    });
    const request = { ...f.application.research, range: { startSequence: 0, count: 32, leaseDurationMs: 10000 } };
    trace.length = 0; const started = performance.now();
    const first = await runSavedDomainResearchLoop(client, f.researchContext, request), queries = [...trace], elapsedMs = performance.now() - started;
    expect(["COMPLETE", "STATEMENT_LIMIT_EXCEEDED"]).toContain(first.status); expect(first.completed.length).toBeGreaterThan(2);
    expect(first.completed.map(row => row.sourceSequence)).toEqual(Array.from({ length: first.completed.length }, (_, i) => i));
    expect(ledgers).toHaveLength(1); expect(ledgers[0]!.statements).toBe(queries.length);
    expect(ledgers[0]!.statements).toBeLessThanOrEqual(512); expect(ledgers[0]!.inputs.total).toBeLessThanOrEqual(67108864);
    expect(ledgers[0]!.noncapitalControls.total).toBeLessThanOrEqual(4096); expect(elapsedMs).toBeLessThanOrEqual(120000);
    const prefix = await records(completionTable); expect(prefix).toHaveLength(first.completed.length);
    for (const row of preserved) expect(prefix).toContainEqual(row);
    let resumed = false;
    if (first.status === "STATEMENT_LIMIT_EXCEEDED") {
      expect(first.completed.length).toBeLessThan(32); await f.expiry();
      trace.length = 0;
      const next = await runSavedDomainResearchLoop(client, f.researchContext, { ...request,
        range: { ...request.range, startSequence: first.completed.length, count: 1 } });
      const nextQueries = [...trace]; expect(next.status).toBe("COMPLETE"); expect(next.completed).toHaveLength(1);
      expect(next.completed[0]!.sourceSequence).toBe(first.completed.length); expect(next.completed[0]!.outcome).toBe("COMMITTED");
      expect(ledgers).toHaveLength(2); expect(ledgers[1]).not.toBe(ledgers[0]); expect(ledgers[1]!.statements).toBe(nextQueries.length);
      expect(ledgers[1]!.statements).toBeLessThanOrEqual(512); expect(ledgers[1]!.inputs.total).toBeLessThanOrEqual(67108864);
      expect(ledgers[1]!.noncapitalControls.total).toBeLessThanOrEqual(4096);
      const after = await records(completionTable); expect(after).toHaveLength(prefix.length + 1); for (const row of prefix) expect(after).toContainEqual(row);
      resumed = true;
    } else expect(first.completed).toHaveLength(32);
    expect(await capital()).toEqual([]);
    console.info(JSON.stringify({ proof: "DEE1136_RANGE32_BOUNDED_PREFIX", availableInputs: 32, status: first.status,
      firstCompleted: first.completed.length, firstElapsedMs: elapsedMs, explicitFreshInvocationResumedNext: resumed,
      invocations: ledgers.map(ledger => ({ statements: ledger.statements, uniqueBytes: ledger.inputs.total, controlBytes: ledger.noncapitalControls.total })) }));
  }, 150000);
  it.each(["saved", "acquisition"] as const)("keeps%s lease busy through expiry and rejects stale held identity after real successor", async domain => {
    const first = await claim(domain, 1000); expect(first).not.toBeNull(); expect(await claim(domain)).toBeNull();
    const table = domain === "saved" ? "trader_saved_research_lease_heads_v1" : "trader_recorded_acquisition_lease_heads_v1";
    await client.unsafe(`select pg_sleep(greatest(0,extract(epoch from valid_until_utc-clock_timestamp()))+0.02) from ${table} where organization_id=$1::uuid`, [organizationId]);
    const successor = await claim(domain, 3000); expect(successor?.leaseEpoch).toBe(first!.leaseEpoch + 1);
    if (domain === "saved") await expect(db().transaction(async tx => {
      await lockSavedResearchOrganizationV1(tx, organizationId);
      return assertSavedResearchHolderWithinHeldTransactionV1(tx, first as NonNullable<Awaited<ReturnType<typeof claimSavedResearchWithinHeldTransactionV1>>>, new HeldResearchAccounting().noncapitalControls);
    })).rejects.toThrow();
    if (domain === "acquisition") await expect(db().transaction(async tx => {
      await lockRecordedAcquisitionOrganizationV1(tx, organizationId);
      return assertRecordedAcquisitionHolderWithinHeldTransactionV1(tx, first as NonNullable<Awaited<ReturnType<typeof claimRecordedAcquisitionWithinHeldTransactionV1>>>);
    })).rejects.toThrow("RUNTIME_CONTROL_LEASE_STALE_HOLDER");
    expect(await capital()).toEqual([]);
  }, 15000);
  it("rejects a real claim whose deferred COMMIT crosses expiry and retains no head/history/reference", async () => {
    await expect(db().transaction(async tx => {
      expect(await claimSavedResearchWithinHeldTransactionV1(tx, { organizationId, runtimeInstanceId: "expired-before-commit", durationMs: 500 }, new HeldResearchAccounting().noncapitalControls)).not.toBeNull();
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
    expect(refs.filter(row => /^noncapital_affinity_[0-7]$/.test(row.conname))).toHaveLength(8);
    expect(refs.filter(row => row.conname.startsWith("noncapital_affinity_parent_")).map(row => row.conname).sort())
      .toEqual([0, 1, 2, 3, 4, 5, 7].map(n => `noncapital_affinity_parent_${n}`));
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
  it.each(applicationTables.map((table, index) => [table, index] as const))("rejects every malformed SAVED top-level command in%s with a valid raw body hash", async (table, index) => {
    const { input } = await composite(); complete(await run(input));
    const before = await records(table); expect(before).toHaveLength(1);
    const row = before[0]!.value as Record<string, unknown>, body = JSON.parse(String(row.body_json));
    const malformed: unknown[] = [undefined, null, 7, true, {}, [], "short", "A".repeat(64), "5070c0aa8e42824892dd2915c5d70b21cac4e9a22aec5947a7255d62a3d8faf2"];
    for (const value of malformed) {
      const changed = { ...body }; if (value === undefined) delete changed.commandManifestDigest; else changed.commandManifestDigest = value;
      const raw = canonicalizeSemanticJsonString(changed), contentDigest = createHash("sha256").update(raw).digest("hex");
      const candidate: Record<string, unknown> = { ...row, body_json: raw, content_digest: contentDigest };
      expect((await client`select encode(sha256(convert_to(${raw},'UTF8')),'hex') digest`)[0]!.digest).toBe(contentDigest);
      const failure = await client.begin(async held => {
        // The actual body-hash/audit verifier runs before CHECK enforcement.
        // A fresh matching audit keeps this negative focused on command shape.
        if (row.audit_id) {
          const audit = (await held`select to_jsonb(a) value from audit_logs a where id=${String(row.audit_id)}::uuid`)[0]!.value;
          const id = randomUUID(); candidate.audit_id = id;
          await held`insert into audit_logs select (jsonb_populate_record(null::audit_logs,${JSON.stringify({ ...audit, id,
            metadata_json: { ...audit.metadata_json, bodyDigest: contentDigest } })}::jsonb)).*`;
        }
        await held.unsafe(`insert into ${table} select (jsonb_populate_record(null::${table},$1::jsonb)).*`, [JSON.stringify(candidate)]);
      }).then(() => null, error => error);
      expect(errorCode(failure)).toBe("23514"); expect(failure.constraint_name).toBe(`noncapital_command_profile_${index}`);
      expect(await records(table)).toEqual(before);
    }
    console.info(JSON.stringify({ proof: "DEE1136_SAVED_COMMAND_SHAPE", table, controls: malformed.length, rawHashValid: true, priorRowsUnchanged: true }));
  }, 60000);

  it.each(["application", "availability", "completion", "consumption"] as const)("reaches immediate%s affinity with a real rolled-back producer candidate and a valid alternate holder", async stage => {
    const table = stage === "application" ? applicationTables[1]! : stage === "availability" ? applicationTables[2]!
      : stage === "completion" ? completionTable : consumptionTable;
    let input: SavedApplicationRequest;
    if (stage === "application") {
      const f = await fixture(); complete(await run(f.application)); await f.expiry(); await f.appendThrough(3);
      input = { ...f.application, previousSourceSequence: 2, currentSourceSequence: 3 };
    } else if (stage === "availability") input = (await fixture()).application;
    else input = (await composite()).input;
    await faultAt(table, "RAISE EXCEPTION 'DEE1136_CAPTURE_CANDIDATE';");
    trace.length = 0;
    const outcome = await run(input).then(() => null, error => error); expect(errorCode(outcome)).toBe("P0001");
    const candidate = trace.find(q => q.query.startsWith(`insert into "${table}"`)); expect(candidate).toBeDefined();
    const position = trace.indexOf(candidate!), transactionStart = trace.slice(0, position).findLastIndex(q => /^begin /i.test(q.query));
    expect(transactionStart).toBeGreaterThanOrEqual(0);
    const dependencies = trace.slice(transactionStart + 1, position).filter(q => /^insert into /i.test(q.query));
    const dependencyTables = dependencies.map(q => /^insert into "([^"]+)"/.exec(q.query)?.[1]);
    expect(dependencyTables.every(name => ["audit_logs", "trader_information_sufficiency_receipt_v2",
      "trader_mi_canonical_measurement_definition_v1", "trader_mi_canonical_measurement_value_v1",
      "trader_mi_canonical_measurement_value_input_v1"].includes(name!))).toBe(true);
    if (stage === "completion") expect(dependencyTables).toContain("trader_information_sufficiency_receipt_v2");
    else expect(dependencyTables).toContain("audit_logs");
    await clearFault(); const before = await records(table), receiptsBefore = await records("trader_information_sufficiency_receipt_v2");
    const holder = await claimRuntimeControlLeaseAtDatabaseTimeV2(db(), { organizationId, runtimeInstanceId: "affinity-control-capital", durationMs: 30000 });
    expect(holder).not.toBeNull();
    const parsed = /^insert into "[^"]+" \(([^)]+)\) values \(([^)]+)\)/.exec(candidate!.query); expect(parsed).not.toBeNull();
    const columns = parsed![1]!.split(",").map(value => value.trim().replaceAll('"', ""));
    const values = parsed![2]!.split(",").map(value => value.trim()), parameters = [...candidate!.params];
    for (const [column, value] of Object.entries({ ownership_domain: "CAPITAL_LEGACY_V2", runtime_instance_id: holder!.runtimeInstanceId,
      lease_epoch: holder!.leaseEpoch, lease_content_digest: holder!.leaseContentDigest })) {
      const field = columns.indexOf(column); expect(field).toBeGreaterThanOrEqual(0);
      const placeholder = /^\$(\d+)$/.exec(values[field]!); expect(placeholder).not.toBeNull(); parameters[Number(placeholder![1]) - 1] = value;
    }
    // No public-owner guard is bypassed: its genuine valid SAVED candidate was
    // observed before an explicit test fault. Only the direct SQL negative uses
    // a separately valid CAPITAL holder against that immutable SAVED parent.
    const failure = await client.begin(async held => {
      for (const dependency of dependencies) {
        const params = dependency.params.map(value => {
          if (!dependency.query.startsWith('insert into "audit_logs"') || typeof value !== "string") return value;
          let decoded; try { decoded = JSON.parse(value); } catch { return value; }
          if (!decoded || typeof decoded !== "object" || !decoded.holder) return value;
          return JSON.stringify({ ...decoded, holder: { runtimeInstanceId: holder!.runtimeInstanceId,
            leaseEpoch: holder!.leaseEpoch, leaseContentDigest: holder!.leaseContentDigest } });
        });
        await held.unsafe(dependency.query, params as Parameters<postgres.TransactionSql["unsafe"]>[1]);
      }
      await held.unsafe(candidate!.query, parameters as Parameters<postgres.TransactionSql["unsafe"]>[1]);
    }).then(() => null, error => error);
    expect(errorCode(failure)).toBe("23503");
    const expected = stage === "application" ? ["noncapital_affinity_4"] : stage === "availability" ? ["noncapital_affinity_5"]
      : stage === "completion" ? ["noncapital_affinity_3"] : ["noncapital_affinity_6", "noncapital_affinity_7"];
    expect(expected).toContain(failure.constraint_name);
    expect(await records(table)).toEqual(before); expect(await records("trader_information_sufficiency_receipt_v2")).toEqual(receiptsBefore);
    console.info(JSON.stringify({ proof: "DEE1136_IMMEDIATE_AFFINITY", stage, sqlstate: errorCode(failure), constraint: failure.constraint_name, rolledBack: true }));
  }, 60000);

  it.each(["packet", "companion-packet", "companion-cycle"] as const)("reaches the exact recorded%s affinity with genuine prior data and a separately owned canonical cycle", async stage => {
    const f = await fixture(), packetTable = receiptTables[2]!, companionTable = receiptTables[3]!, cycleTable = receiptTables[0]!;
    const table = stage === "packet" ? packetTable : companionTable;
    await faultAt(table, "RAISE EXCEPTION 'DEE1136_CAPTURE_RECORDED';"); trace.length = 0;
    const failure = await f.appendSourceThrough(2).then(() => null, error => error); expect(errorCode(failure)).toBe("P0001");
    const candidate = trace.find(q => q.query.startsWith(`insert into "${table}"`)); expect(candidate).toBeDefined();
    const cycle = trace.find(q => q.query.startsWith(`insert into "${cycleTable}"`));
    await clearFault();
    const capitalHolder = await claimRuntimeControlLeaseAtDatabaseTimeV2(db(), { organizationId, runtimeInstanceId: "recorded-affinity-capital", durationMs: 30000 });
    expect(capitalHolder).not.toBeNull();
    const parameters = [...candidate!.params];
    if (stage !== "packet") {
      expect(cycle).toBeDefined();
      const captured = JSON.parse(String(cycle!.params[insertParameter(cycle!.query, "canonical_json")]));
      // The unchanged public owner creates its real NO_TRADE cycle from the
      // captured input; there is no forged cycle, lease, evaluator or receipt.
      const actual = await commitRecordedNoncapitalCyclePostgresV2(db(), { organizationId }, capitalHolder!, captured.input);
      expect(actual.outcome).toBe("COMMITTED");
      const body = JSON.parse(String(parameters[insertParameter(candidate!.query, "body_json")]));
      body.canonicalReceiptDigest = actual.receipt.contentDigest;
      const raw = canonicalizeSemanticJsonString(body);
      parameters[insertParameter(candidate!.query, "body_json")] = raw;
      parameters[insertParameter(candidate!.query, "content_digest")] = createHash("sha256").update(raw).digest("hex");
    }
    if (stage !== "companion-cycle") for (const [column, value] of Object.entries({ ownership_domain: "CAPITAL_LEGACY_V2",
      runtime_instance_id: capitalHolder!.runtimeInstanceId, lease_epoch: capitalHolder!.leaseEpoch, lease_content_digest: capitalHolder!.leaseContentDigest }))
      parameters[insertParameter(candidate!.query, column)] = value;
    const before = await Promise.all(receiptTables.slice(0, 4).map(records));
    const refused = await client.unsafe(candidate!.query, parameters as Parameters<postgres.TransactionSql["unsafe"]>[1]).then(() => null, error => error);
    expect(errorCode(refused)).toBe("23503"); expect(refused.constraint_name).toBe(`noncapital_affinity_${stage === "packet" ? 0 : stage === "companion-packet" ? 1 : 2}`);
    expect(await Promise.all(receiptTables.slice(0, 4).map(records))).toEqual(before);
    console.info(JSON.stringify({ proof: "DEE1136_RECORDED_AFFINITY", stage, sqlstate: errorCode(refused), constraint: refused.constraint_name }));
  }, 60000);

  it.each(["saved", "acquisition"] as const)("rejects malformed%s history envelopes, hashes and clock/sequence projections without retained control rows", async domain => {
    const history = domain === "saved" ? "trader_saved_research_lease_history_v1" : "trader_recorded_acquisition_lease_history_v1";
    const head = domain === "saved" ? "trader_saved_research_lease_heads_v1" : "trader_recorded_acquisition_lease_heads_v1";
    trace.length = 0;
    await expect(db().transaction(async tx => {
      const input = { organizationId, runtimeInstanceId: "captured-real-claim", durationMs: 30000 };
      const holder = domain === "saved" ? await claimSavedResearchWithinHeldTransactionV1(tx, input, new HeldResearchAccounting().noncapitalControls)
        : await claimRecordedAcquisitionWithinHeldTransactionV1(tx, input);
      expect(holder).not.toBeNull(); throw new Error("DEE1136_ROLLBACK_VALID_CLAIM");
    })).rejects.toThrow("DEE1136_ROLLBACK_VALID_CLAIM");
    const emitted = trace.find(q => q.query.includes(`insert into "${history}"`)); expect(emitted).toBeDefined();
    const source = JSON.parse(String(emitted!.params.find(value => typeof value === "string" && value.includes('"schemaVersion":"waia.trader.noncapital_domain_lease.v1"'))));
    const project = (body: typeof source) => ({ organization_id: body.organizationId, runtime_instance_id: body.runtimeInstanceId, lease_epoch: body.leaseEpoch,
      content_digest: createHash("sha256").update(canonicalizeSemanticJsonString(body)).digest("hex"), prior_content_digest: body.expectedPreviousDigest,
      adjudicated_at_utc: body.adjudicatedAtUtc, valid_until_utc: body.validUntilUtc, duration_ms: body.durationMs, body_json: canonicalizeSemanticJsonString(body) });
    const controls = ["missing", "null", "wrong-type", "extra-key", "wrong-domain", "wrong-hash", "projection", "duration", "epoch", "prior", "future", "expired"] as const;
    for (const mode of controls) {
      const body = structuredClone(source);
      if (mode === "missing") delete body.durationMs;
      if (mode === "null") body.durationMs = null;
      if (mode === "wrong-type") body.durationMs = "30000";
      if (mode === "extra-key") body.authority = "NONE";
      if (mode === "wrong-domain") body.ownershipDomain = "CAPITAL_LEGACY_V2";
      const row = { ...project(source), body_json: canonicalizeSemanticJsonString(body) };
      row.content_digest = createHash("sha256").update(row.body_json).digest("hex");
      if (mode === "wrong-hash") row.content_digest = "0".repeat(64);
      if (mode === "projection") row.runtime_instance_id = "another-runtime";
      if (mode === "duration") row.duration_ms = 0;
      if (mode === "epoch") row.lease_epoch = 2;
      if (mode === "prior") row.prior_content_digest = "1".repeat(64);
      if (mode === "future") Object.assign(row, project({ ...source,
        adjudicatedAtUtc: new Date(Date.parse(source.adjudicatedAtUtc) + 60000).toISOString(), validUntilUtc: new Date(Date.parse(source.validUntilUtc) + 60000).toISOString() }));
      if (mode === "expired") Object.assign(row, project({ ...source,
        adjudicatedAtUtc: new Date(Date.parse(source.adjudicatedAtUtc) - 60000).toISOString(), validUntilUtc: new Date(Date.parse(source.validUntilUtc) - 60000).toISOString() }));
      const fields = Object.keys(row).join(",");
      const refused = await client.unsafe(`insert into ${history} (${fields}) select ${fields} from jsonb_populate_record(null::${history},$1::jsonb)`, [JSON.stringify(row)]).then(() => null, error => error);
      expect(errorCode(refused)).toBe(["epoch", "prior", "future", "expired"].includes(mode) ? "P0001" : "23514");
      if (["missing", "null", "wrong-type", "extra-key", "wrong-domain", "wrong-hash", "projection"].includes(mode))
        expect(refused.constraint_name).toBe(domain === "saved" ? "noncapital_saved_body" : "noncapital_acq_body");
      expect(await records(history)).toEqual([]); expect(await records(head)).toEqual([]); expect(await records("trader_runtime_ownership_refs_v1")).toEqual([]);
    }
    // A structurally valid history without its head reaches the real deferred
    // COMMIT fence; no SET CONSTRAINTS IMMEDIATE substitutes for that boundary.
    const row = project(source), fields = Object.keys(row).join(",");
    const orphan = await client.unsafe(`insert into ${history} (${fields}) select ${fields} from jsonb_populate_record(null::${history},$1::jsonb)`, [JSON.stringify(row)]).then(() => null, error => error);
    expect(errorCode(orphan)).toBe("P0001"); expect(String(orphan.message)).toContain("NONCAPITAL_LEASE_COMMIT_FENCE");
    expect(await records(history)).toEqual([]); expect(await records("trader_runtime_ownership_refs_v1")).toEqual([]);
    console.info(JSON.stringify({ proof: "DEE1136_MALFORMED_HISTORY", domain, malformedControls: controls.length, realOrphanCommitRefused: true }));
  }, 15000);

  it.each(["saved", "acquisition"] as const)("keeps%s history/reference append-only and denies head renewal, delete and mismatched projection", async domain => {
    const holder = await claim(domain, 30000); expect(holder).not.toBeNull();
    const history = domain === "saved" ? "trader_saved_research_lease_history_v1" : "trader_recorded_acquisition_lease_history_v1";
    const head = domain === "saved" ? "trader_saved_research_lease_heads_v1" : "trader_recorded_acquisition_lease_heads_v1";
    const tables = [history, head, "trader_runtime_ownership_refs_v1"], before = await Promise.all(tables.map(records));
    for (const table of [history, "trader_runtime_ownership_refs_v1"]) {
      for (const command of [`update ${table} set runtime_instance_id=runtime_instance_id`, `delete from ${table}`]) {
        const failure = await client.unsafe(`${command} where organization_id=$1::uuid`, [organizationId]).then(() => null, error => error);
        expect(errorCode(failure)).toBe("P0001");
      }
    }
    for (const command of [`update ${head} set updated_at=updated_at`, `update ${head} set valid_until_utc=valid_until_utc+interval '1 second'`,
      `update ${head} set runtime_instance_id='forged'`, `delete from ${head}`]) {
      const failure = await client.unsafe(`${command} where organization_id=$1::uuid`, [organizationId]).then(() => null, error => error);
      expect(errorCode(failure)).toBe("P0001");
    }
    expect(await Promise.all(tables.map(records))).toEqual(before); expect(await claim(domain)).toBeNull();
  }, 15000);

  it("does not wait on a held capital advisory lock and keeps another organization independent", async () => {
    let release!: () => void, entered!: () => void, heldCapital = false;
    const barrier = new Promise<void>(resolve => { entered = resolve; }), resumed = new Promise<void>(resolve => { release = resolve; });
    const owner = client.begin(async held => {
      await held`select pg_advisory_xact_lock(hashtextextended(${organizationId},637))`;
      heldCapital = true; entered(); await resumed; heldCapital = false;
    });
    await barrier;
    try {
      const saved = await claim("saved", 30000), acquisition = await claim("acquisition", 30000);
      expect(saved).not.toBeNull(); expect(acquisition).not.toBeNull(); expect(heldCapital).toBe(true);
      const foreignId = await seedWp13User(url!, randomUUID(), "DEE1136 independent synthetic organization");
      const foreign = await db().transaction(tx => claimSavedResearchWithinHeldTransactionV1(tx,
        { organizationId: foreignId, runtimeInstanceId: "foreign-owner", durationMs: 30000 }, new HeldResearchAccounting().noncapitalControls));
      expect(foreign?.organizationId).toBe(foreignId); expect(foreign?.leaseEpoch).toBe(1); expect(heldCapital).toBe(true);
      expect(await capital()).toEqual([]); expect(await claim("saved")).toBeNull();
    } finally { release(); await owner; }
    console.info(JSON.stringify({ proof: "DEE1136_DOMAIN_LOCK_ISOLATION", completedWhileCapitalHeld: true, foreignOrgIndependent: true }));
  }, 15000);
  it("keeps all five control tables browser-denied without granting or altering any global role", async () => {
    const tables = ["trader_recorded_acquisition_lease_history_v1", "trader_recorded_acquisition_lease_heads_v1",
      "trader_saved_research_lease_history_v1", "trader_saved_research_lease_heads_v1", "trader_runtime_ownership_refs_v1"];
    expect(await claim("saved", 30000)).not.toBeNull(); expect(await claim("acquisition", 30000)).not.toBeNull();
    const before = await Promise.all(tables.map(records));
    const policies = await client`select tablename,roles,cmd,qual,with_check from pg_policies where schemaname='public' and tablename=any(${tables}) order by tablename,policyname`;
    expect(policies).toHaveLength(5); expect(policies.every(p => p.cmd === "ALL" && p.qual === "false" && p.with_check === "false" &&
      [...p.roles].sort().join(",") === "anon,authenticated")).toBe(true);
    const relations = await client`select relname,relrowsecurity from pg_class where oid=any(${tables}::regclass[]) order by relname`;
    expect(relations).toHaveLength(5); expect(relations.every(row => row.relrowsecurity)).toBe(true);
    const roles = await client`select rolname,rolsuper,rolbypassrls,rolcreaterole from pg_roles where rolname in ('anon','authenticated') order by rolname`;
    expect(roles).toHaveLength(2); expect(roles.every(r => !r.rolsuper && !r.rolbypassrls && !r.rolcreaterole)).toBe(true);
    for (const role of ["anon", "authenticated"]) for (const table of tables) {
      const outcome = await client.begin(async held => {
        await held.unsafe(`set local role ${role}`);
        return held.unsafe(`select count(*)::int n from ${table} where organization_id=$1::uuid`, [organizationId]);
      }).then(rows => ({ rows, error: null }), error => ({ rows: null, error }));
      if (outcome.error) expect(errorCode(outcome.error)).toBe("42501");
      else expect(outcome.rows).toEqual([{ n: 0 }]);
      const denied = await client.begin(async held => {
        await held.unsafe(`set local role ${role}`);
        return held.unsafe(`insert into ${table} select (jsonb_populate_record(null::${table},$1::jsonb)).*`, [JSON.stringify(before[tables.indexOf(table)]![0]!.value)]);
      }).then(() => null, error => error);
      expect(errorCode(denied)).toBe("42501");
    }
    expect(await Promise.all(tables.map(records))).toEqual(before);
    expect(await client`select rolname,rolsuper,rolbypassrls,rolcreaterole from pg_roles where rolname in ('anon','authenticated') order by rolname`).toEqual(roles);
    console.info(JSON.stringify({ proof: "DEE1136_BROWSER_DENY", tables: 5, roles: 2, globalRoleChanges: false }));
  }, 15000);

});
