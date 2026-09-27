// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import type postgres from "postgres";
import * as postgresAdapter from "drizzle-orm/postgres-js";
// Observe the actual installed constructor without replacing its implementation.
// The package namespace export itself is non-configurable, so spyOn cannot wrap it.
vi.mock("drizzle-orm/postgres-js", async importOriginal => {
  const actual = await importOriginal<typeof import("drizzle-orm/postgres-js")>();
  return { ...actual, drizzle: vi.fn(actual.drizzle) };
});
import { getTableColumns, getTableName, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema.postgres";
import { prepareHeldResearchReplay, HeldResearchAccounting, type ResearchRequest } from "@/lib/trader/paper/research-understanding-v1/held-replay";
import { createSavedResearchOwner } from "@/lib/trader/paper/research-understanding-v1/repository-postgres";
import * as evaluation from "@/lib/trader/paper/research-understanding-v1/evaluate";
import * as recorded from "@/lib/trader/paper/durable-noncapital/recorded-analysis-v1";
import { encodeBody } from "@/lib/trader/paper/durable-noncapital/recorded-source-read-validation-v1";
import { buildCanonicalGatewayPitReceiptV1 } from "@/lib/trader/mi/canonical-pit-repository-postgres";
import { researchPureFixture } from "../helpers/research-understanding-fixture";
import type { TrustAsOfReceiptV1 } from "@/lib/trader/mi/trust-as-of-v1";
import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";

/** Actual Drizzle SQL and actual readers/evaluator. Inert row transport only:
 * this is not a PostgreSQL isolation, guard, source-provenance or rollback proof. */
function fixture(driverDates: "strings" | "objects" = "strings") {
  const f = researchPureFixture();
  for (const [i, source] of f.packet.sources.entries()) {
    if (!source.observation) continue;
    const old = source.observation as unknown as Record<string, unknown>;
    const observation: Record<string, unknown> = { ...old, observationKey: `synthetic:${i}`, revisionOf: null, revisionSeq: 1,
      createdAt: f.packet.analysisPitAnchor };
    const body = { schemaVersion: observation.schemaVersion, organizationId: observation.organizationId, sourceId: observation.sourceId,
      observationKey: observation.observationKey, observationKind: observation.observationKind, subjectRef: observation.subjectRef,
      eventTimeUtc: observation.eventTime, availableAtUtc: observation.availableAt, ingestTimeUtc: observation.ingestTime,
      canonicalProviderId: observation.canonicalProviderId, trustAsOfReceiptId: observation.trustAsOfReceiptId,
      sourceTrustRevisionId: observation.sourceTrustRevisionId, sourceTrustContentDigest: observation.sourceTrustContentDigest,
      normalizedInputDigest: observation.normalizedInputDigest, payloadCanonical: JSON.parse(String(observation.payloadJson)), revisionOf: null, revisionSeq: 1 };
    const canonicalObservation = { ...observation, contentDigest: recorded.digest(body) }; source.observation = canonicalObservation;
    source.receipt = buildCanonicalGatewayPitReceiptV1({ ...source.receipt, observationContentDigest: canonicalObservation.contentDigest });
  }
  const { contentDigest: _old, ...packetBody } = f.packet; void _old; f.packet = recorded.seal(packetBody);
  for (const revision of f.revisions) Object.assign(revision, { createdAt: f.packet.analysisPitAnchor });
  const revisions = [...f.revisions].sort((a, b) => a.id.localeCompare(b.id));
  const output = evaluation.evaluateSavedResearchUnderstanding(f.packet, f.assignment, f.profile, revisions);
  const completion = recorded.seal({ schemaVersion: f.assignment.schemaVersion, organizationId: f.session.organizationId,
    researchSessionId: f.config.researchSessionId, sequence: 0, sourceSessionId: f.session.sessionId, sourceSequence: 0,
    assignmentDigest: f.assignment.contentDigest, packetDigest: f.packet.contentDigest, previousCompletionDigest: null, output });
  const rows: Record<string, Record<string, unknown>[]> = {
    trader_research_understanding_assignments_v1: [{ ...f.assignment, sessionId: f.config.researchSessionId, bodyJson: encodeBody(f.assignment) }],
    trader_required_information_profile_v2: [{ ...f.profile, profileJson: f.profile }],
    trader_research_understanding_completions_v1: [{ ...completion, sessionId: f.config.researchSessionId, receiptId: output.receipt.id, bodyJson: encodeBody(completion) }],
    trader_information_sufficiency_receipt_v2: [{ ...output.receipt, receiptJson: output.receipt }],
    trader_recorded_analysis_sessions_v1: [{ organizationId: f.session.organizationId, sessionId: f.session.sessionId,
      contentDigest: f.session.configDigest, bodyJson: canonicalJsonString(Object.fromEntries(Object.entries(f.session).filter(([k]) => k !== "configDigest"))) }],
    trader_recorded_analysis_packets_v1: [{ ...f.packet, organizationId: f.session.organizationId, sessionId: f.session.sessionId,
      configDigest: f.session.configDigest, bodyJson: encodeBody(f.packet) }],
    trader_recorded_analysis_companions_v1: [{ organizationId: f.session.organizationId, sessionId: f.session.sessionId, sequence: 0,
      packetDigest: f.packet.contentDigest, accountId: f.session.accountId, symbol: f.session.symbol, barInterval: "1m", scheduledBarCloseTime: f.packet.normalized.scheduledBarCloseTime }],
    trader_mi_gateway_pit_receipt_v1: f.packet.sources.map(s => ({ ...s.receipt, receiptJson: s.receipt })),
    trader_mi_observation: f.packet.sources.flatMap(s => s.observation ? [s.observation as unknown as Record<string, unknown>] : []),
    trader_mi_source: [...new Map(f.packet.sources.map(s => { const row = s.source as Record<string, unknown>; return [row.id, row] as const; })).values()],
    trader_mi_source_trust: f.revisions,
    trader_mi_trust_as_of_receipt_v1: [...new Map(f.packet.sources.flatMap(s => { const trust = s.trust as TrustAsOfReceiptV1 | null;
      return trust ? [[trust.id, { ...trust, anchorTime: trust.anchorTimeUtc, receiptJson: canonicalJsonString(trust) }] as const] : []; })).values()],
  };
  const tables = new Map<string, PgTable>();
  for (const table of Object.values(schema)) if (is(table, PgTable)) tables.set(getTableName(table), table);
  const trace: Array<{ sql: string; params: unknown[] }> = [];
  let afterQuery: (q: string) => void = () => {};
  const unsafe = vi.fn((sql: string, params: unknown[] = []) => {
    trace.push({ sql, params });
    if (sql.startsWith("set ")) return Object.assign(Promise.resolve([]), { values: async () => [] });
    const metadata = sql.includes("octet_length");
    const selected = metadata ? /from\s+\((select [\s\S]+)\) as bounded_row/.exec(sql)![1]! : sql;
    const table = /from "([a-z0-9_]+)"/.exec(selected)![1]!;
    const columns = getTableColumns(tables.get(table)!);
    const names = new Map(Object.entries(columns).map(([name, col]) => [col.name, name]));
    const wanted = /select\s+([\s\S]+?)\s+from/.exec(selected)![1]!.split(/,\s*/).map(term => {
      const words = [...term.matchAll(/"([^"]+)"/g)].map(m => m[1]!);
      const alias = term.includes(" as ") ? words.at(-1)! : names.get(words.at(-1)!)!;
      const column = term.includes(" as ") ? words.at(-2)! : words.at(-1)!;
      return { alias, name: names.get(column)! };
    });
    const selectedRows = (rows[table] ?? []).filter(row => {
      if (!params.includes(row.organizationId)) return false;
      if (/"id" (?:=|in)/.test(selected)) return params.includes(row.id);
      if (/"content_digest" =/.test(selected)) return params.includes(row.contentDigest);
      return true;
    });
    const projected = selectedRows.map(row => Object.fromEntries(wanted.map(c => [c.alias, row[c.name] ?? null])));
    const result: Record<string, unknown>[] = metadata ? selectedRows.map((row, i) => ({ identity: JSON.stringify(row.id ? [row.id] :
      row.sequence === undefined ? [row.organizationId, row.sessionId] : [row.organizationId, row.sessionId, row.sequence]), bytes: Buffer.byteLength(JSON.stringify(projected[i])) })) : projected;
    const finish = () => {
      afterQuery(sql);
      if (metadata || driverDates === "strings") return result;
      // PostgreSQL's default date parser may return Date; an already initialized
      // root Drizzle client uses strings. Do not alter stored JSON or digests.
      return result.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key,
        ["eventTime", "availableAt", "ingestTime", "createdAt", "analysisPitAnchor", "scheduledBarCloseTime", "anchorTime", "pitAnchor"].includes(key) && typeof value === "string"
          ? new Date(value) : value])));
    };
    const promise = Promise.resolve().then(finish);
    return Object.assign(promise, { values: () => promise.then(values => values.map(row => wanted.map(c => row[c.alias]))) });
  });
  const options = { parsers: {}, serializers: {} };
  const held = { unsafe, savepoint: vi.fn(() => { throw new Error("UNEXPECTED_SAVEPOINT"); }) } as unknown as postgres.TransactionSql;
  const begin = vi.fn(async (fn: (client: postgres.TransactionSql) => Promise<unknown>) => fn(held));
  const pool = { unsafe, options, begin } as unknown as postgres.Sql;
  const request: ResearchRequest = { assignment: f.config, profile: { definition: f.profileDefinition }, range: { startSequence: 0, count: 1, leaseDurationMs: 1000 } };
  return { f, rows, output, completion, request, context: { organizationId: f.session.organizationId }, trace, unsafe, held, pool, begin,
    afterQuery(fn: (q: string) => void) { afterQuery = fn; } };
}
afterEach(() => vi.restoreAllMocks());
describe("actual fixed held replay and unchanged public owner", () => {
  it("matches public replay and output bytes using one held client and counts every nested dispatch", async () => {
    const f = fixture(); const old = await createSavedResearchOwner(f.pool, f.context, f.request).replay(0);
    expect(old).toEqual({ outcome: "REPLAYED", completion: f.completion }); expect(f.begin).toHaveBeenCalledOnce();
    expect(f.trace[0]!.sql).toContain("repeatable read read only");
    const before = f.trace.length; const accounting = new HeldResearchAccounting();
    expect("options" in f.held).toBe(false); Object.freeze(f.held);
    const held = prepareHeldResearchReplay(f.pool, accounting).bindHeld(f.held); const actual = await held.replay(f.context, f.request, 0);
    expect(actual?.completion).toEqual(f.completion); expect(actual?.output).toEqual(f.output);
    expect(f.trace.length - before).toBe(accounting.statements); expect(accounting.statements).toBeGreaterThan(30);
    expect(f.begin).toHaveBeenCalledOnce(); expect(f.held.savepoint).not.toHaveBeenCalled();
    expect(Object.keys(held.executor).sort()).toEqual(["execute", "insert", "select"]);
    const queries = f.trace.slice(before).map(r => r.sql);
    expect(queries.some(q => q.startsWith("select") && !q.includes("octet_length") && q.includes('from "trader_mi_observation"'))).toBe(true);
    expect(queries.some(q => q.startsWith("select") && !q.includes("octet_length") && q.includes('from "trader_mi_trust_as_of_receipt_v1"'))).toBe(true);
    const bytes = accounting.inputs.total; const count = accounting.statements;
    expect((await held.replay(f.context, f.request, 0))?.completion).toEqual(f.completion);
    expect(accounting.inputs.total).toBe(bytes); expect(accounting.statements).toBe(count * 2);
  });
  it("preserves default driver Date values and existing string parsing without touching the held client", async () => {
    const strings = fixture("strings"); const objects = fixture("objects");
    const a = prepareHeldResearchReplay(strings.pool, new HeldResearchAccounting()).bindHeld(Object.freeze(strings.held));
    const b = prepareHeldResearchReplay(objects.pool, new HeldResearchAccounting()).bindHeld(Object.freeze(objects.held));
    const before = Object.keys(objects.held);
    expect((await b.replay(objects.context, objects.request, 0))?.completion).toEqual((await a.replay(strings.context, strings.request, 0))?.completion);
    expect(Object.keys(objects.held)).toEqual(before); expect(objects.begin).not.toHaveBeenCalled();
  });
  it("rejects ownership inversion before I/O", () => {
    const f = fixture();
    expect(() => prepareHeldResearchReplay(f.pool, new HeldResearchAccounting()).bindHeld(f.pool as unknown as postgres.TransactionSql)).toThrow("HELD_TRANSACTION_REQUIRED");
    expect(() => createSavedResearchOwner(f.held as unknown as postgres.Sql, f.context, f.request)).toThrow("POOL_REQUIRED");
    expect(f.unsafe).not.toHaveBeenCalled();
  });
  it("initializes originating metadata before the owner begins and binds only once without reconstructing", async () => {
    const f = fixture(); const accounting = new HeldResearchAccounting();
    const constructor = vi.mocked(postgresAdapter.drizzle); constructor.mockClear();
    const rootUnsafe = vi.spyOn(f.pool, "unsafe").mockImplementation(() => { throw new Error("ROOT_TRANSPORT_FORBIDDEN"); });
    const originalOptions = f.pool.options;
    const pending = prepareHeldResearchReplay(f.pool, accounting);
    expect(constructor).toHaveBeenCalledOnce(); expect(f.begin).not.toHaveBeenCalled();
    expect(Object.keys(pending)).toEqual(["bindHeld"]); expect(accounting.statements).toBe(0);
    const transport = (constructor.mock.calls[0]![0] as unknown as { client: { options: unknown; unsafe: (query: string) => unknown } }).client;
    expect(transport.options).toBe(originalOptions); expect(Object.keys(transport).sort()).toEqual(["options", "unsafe"]);
    expect(() => transport.unsafe("select forbidden_before_bind")).toThrow("HELD_TRANSACTION_NOT_BOUND");
    const jsonCodec = originalOptions.serializers[3802]; const timestampParser = originalOptions.parsers[1184];
    const result = await f.pool.begin(async tx => {
      // This models the owner's call order on inert ports, not a native pairing proof.
      expect(originalOptions.serializers[3802]).toBe(jsonCodec);
      const held = pending.bindHeld(Object.freeze(tx));
      expect(constructor).toHaveBeenCalledOnce();
      expect(originalOptions.serializers[3802]).toBe(jsonCodec); expect(originalOptions.parsers[1184]).toBe(timestampParser);
      expect(() => pending.bindHeld(tx)).toThrow("HELD_BINDING_ALREADY_USED");
      expect("options" in tx).toBe(false);
      return held.replay(f.context, f.request, 0);
    });
    expect(result?.completion).toEqual(f.completion); expect(f.begin).toHaveBeenCalledOnce();
    expect(rootUnsafe).not.toHaveBeenCalled(); expect(f.held.savepoint).not.toHaveBeenCalled();
    expect(accounting.statements).toBe(f.trace.length);
  });
  it.each([119999, 120001])("admits codec initialization completion only within the original deadline at %sms", elapsed => {
    const f = fixture(); let now = 0; vi.spyOn(performance, "now").mockImplementation(() => now);
    const accounting = new HeldResearchAccounting();
    f.pool.options.serializers = new Proxy({}, { set(target, key, value) { now = elapsed; return Reflect.set(target, key, value); } });
    if (elapsed > 120000) expect(() => prepareHeldResearchReplay(f.pool, accounting)).toThrow("INVOCATION_DEADLINE_EXCEEDED");
    else expect(Object.keys(prepareHeldResearchReplay(f.pool, accounting))).toEqual(["bindHeld"]);
    expect(f.begin).not.toHaveBeenCalled(); expect(f.unsafe).not.toHaveBeenCalled(); expect(accounting.statements).toBe(0);
  });
  it("refuses held setup or absent originating codec metadata without detached defaults", () => {
    const f = fixture();
    expect(() => prepareHeldResearchReplay(f.held as unknown as postgres.Sql, new HeldResearchAccounting())).toThrow("POOL_REQUIRED");
    for (const options of [undefined, { parsers: null, serializers: {} }, { parsers: {}, serializers: null }]) {
      const root = { begin: f.begin, options } as unknown as postgres.Sql;
      expect(() => prepareHeldResearchReplay(root, new HeldResearchAccounting())).toThrow("ORIGINATING_CODEC_METADATA_REQUIRED");
    }
    expect(f.begin).not.toHaveBeenCalled(); expect(f.unsafe).not.toHaveBeenCalled();
  });
  it.each(["scope", "profile", "output", "source-missing", "availableAt", "actor"] as const)("retains real %s refusal", async kind => {
    const f = fixture();
    if (kind === "scope") f.request.assignment.organizationId = "22222222-2222-4222-8222-222222222222";
    if (kind === "profile") f.request.profile = { id: "0".repeat(64), contentDigest: "0".repeat(64) };
    if (kind === "output") {
      const { contentDigest: _digest, ...body } = f.completion; void _digest;
      const changed = recorded.seal({ ...body, output: { ...f.output, disposition: f.output.disposition === "COMPLETED_SUPPORTED" ? "COMPLETED_UNRESOLVED" : "COMPLETED_SUPPORTED" } });
      f.rows.trader_research_understanding_completions_v1![0] = { ...f.rows.trader_research_understanding_completions_v1![0], contentDigest: changed.contentDigest, bodyJson: encodeBody(changed) };
    }
    if (kind === "source-missing") f.rows.trader_mi_source = [];
    if (kind === "availableAt") f.rows.trader_mi_source_trust![0]!.availableAt = "2026-01-01T00:00:00.001Z";
    if (kind === "actor") Object.assign(f.context, { userId: "not-a-member" });
    const expected = { scope: "COMMAND_SCOPE_CONFLICT", profile: "PROFILE_IDENTITY_CONFLICT", output: "REPLAY_OUTPUT_CONFLICT",
      "source-missing": "EXACT_ROW_SET_MISSING_OR_AMBIGUOUS", availableAt: "SOURCE_REVISION_CHRONOLOGY_CONFLICT", actor: "ORG_MEMBERSHIP_REQUIRED" }[kind];
    await expect(prepareHeldResearchReplay(f.pool, new HeldResearchAccounting()).bindHeld(f.held).replay(f.context, f.request, 0)).rejects.toThrow(expected);
    expect(f.trace.every(q => q.sql.startsWith("select"))).toBe(true);
  });
  it("prepares an existing completion with fixed evidence and no persistence or lease authority", async () => {
    const f = fixture(), accounting = new HeldResearchAccounting();
    const bound = prepareHeldResearchReplay(f.pool, accounting).bindHeld(f.held);
    const prepared = await bound.prepareCompletion(f.context, f.request, 0);
    expect(prepared).toMatchObject({ outcome: "REPLAYED", completion: f.completion });
    expect(prepared.facts).toEqual({ organizationId: f.context.organizationId, accountId: f.f.session.accountId,
      symbol: f.f.session.symbol, assignmentDigest: f.f.assignment.contentDigest, researchSessionId: f.f.assignment.researchSessionId,
      sourceSessionId: f.f.session.sessionId, sourceConfigDigest: f.f.session.configDigest, sourceSequence: 0,
      profileId: f.f.profile.id, profileContentDigest: f.f.profile.contentDigest,
      computation: f.output.declarations.computation, computationManifestDigest: f.output.declarations.computationManifestDigest,
      analysisPitAnchor: f.f.packet.analysisPitAnchor, scheduledBarCloseTime: f.f.packet.normalized.scheduledBarCloseTime });
    expect(Object.isFrozen(prepared.facts)).toBe(true);
    expect(Object.values(prepared.facts).every(v => typeof v === "string" || typeof v === "number")).toBe(true);
    expect(() => Object.assign(prepared.facts, { sourceSequence: 999 })).toThrow();
    expect(accounting.statements).toBe(f.trace.length);
    expect(f.trace.every(q => q.sql.startsWith("select"))).toBe(true);
    expect(f.begin).not.toHaveBeenCalled();
  });
  it("rejects forged, copied, independently budgeted and reused completion handles before dispatch", async () => {
    const f = fixture(); f.rows.trader_research_understanding_completions_v1 = [];
    const accounting = new HeldResearchAccounting();
    const bound = prepareHeldResearchReplay(f.pool, accounting).bindHeld(f.held);
    const prepared = await bound.prepareCompletion(f.context, f.request, 0);
    if (prepared.outcome !== "PREPARED") throw new Error("EXPECTED_MISSING_COMPLETION");
    expect(Object.keys(prepared).sort()).toEqual(["facts", "outcome", "prepared"]);
    expect(Object.isFrozen(prepared.prepared)).toBe(true);
    const before = f.trace.length;
    const holder = { organizationId: "22222222-2222-4222-8222-222222222222", runtimeInstanceId: "wrong-org",
      leaseEpoch: 1, leaseContentDigest: "a".repeat(64) };
    await expect(bound.writeCompletion({ ...prepared.prepared }, holder)).rejects.toThrow("RESEARCH_COMPLETION_HANDLE_INVALID");
    await expect(bound.writeCompletion(prepared.facts as unknown as typeof prepared.prepared, holder)).rejects.toThrow("RESEARCH_COMPLETION_HANDLE_INVALID");
    const unrelated = prepareHeldResearchReplay(f.pool, new HeldResearchAccounting()).bindHeld(f.held);
    await expect(unrelated.writeCompletion(prepared.prepared, holder)).rejects.toThrow("RESEARCH_COMPLETION_HANDLE_INVALID");
    await expect(bound.writeCompletion(prepared.prepared, holder)).rejects.toThrow("HOLDER_SCOPE_CONFLICT");
    await expect(bound.writeCompletion(prepared.prepared, holder)).rejects.toThrow("RESEARCH_COMPLETION_HANDLE_INVALID");
    expect(f.trace).toHaveLength(before); expect(f.begin).not.toHaveBeenCalled();
  });
  it.each(["statements", "deadline"])("keeps the preparation %s limit when a minted handle reaches the writer", async limit => {
    let now = 0; vi.spyOn(performance, "now").mockImplementation(() => now);
    const f = fixture(); f.rows.trader_research_understanding_completions_v1 = [];
    const accounting = new HeldResearchAccounting();
    const bound = prepareHeldResearchReplay(f.pool, accounting).bindHeld(f.held);
    const prepared = await bound.prepareCompletion(f.context, f.request, 0);
    if (prepared.outcome !== "PREPARED") throw new Error("EXPECTED_MISSING_COMPLETION");
    const before = f.trace.length;
    if (limit === "statements") while (accounting.statements < 512) accounting.beforeStatement();
    else now = 120001;
    await expect(bound.writeCompletion(prepared.prepared, { organizationId: f.context.organizationId,
      runtimeInstanceId: "synthetic-current-holder", leaseEpoch: 1, leaseContentDigest: "a".repeat(64) }))
      .rejects.toThrow(limit === "statements" ? "STATEMENT_LIMIT_EXCEEDED" : "INVOCATION_DEADLINE_EXCEEDED");
    expect(f.trace).toHaveLength(before); expect(f.begin).not.toHaveBeenCalled();
  });
  it("captures selectors before awaiting and returns absence without repairing", async () => {
    const f = fixture(); f.rows.trader_research_understanding_completions_v1 = [];
    const pending = prepareHeldResearchReplay(f.pool, new HeldResearchAccounting()).bindHeld(f.held).replay(f.context, f.request, 0);
    f.request.assignment.accountId = "changed-after-entry";
    expect(await pending).toBeNull(); expect(f.trace.every(q => q.sql.startsWith("select"))).toBe(true);
  });
  for (const phase of ["read", "compute", "digest", "return"] as const) it.each([119999, 120001])(`checks ${phase} deadline at %sms`, async elapsed => {
    const f = fixture(); let now = 0; vi.spyOn(performance, "now").mockImplementation(() => now);
    const accounting = new HeldResearchAccounting();
    if (phase === "read") f.afterQuery(q => { if (!q.includes("octet_length") && q.includes('from "trader_mi_observation"')) now = elapsed; });
    const actualEvaluate = evaluation.evaluateSavedResearchUnderstanding;
    if (phase === "compute" || phase === "return") vi.spyOn(evaluation, "evaluateSavedResearchUnderstanding").mockImplementation((...args) => {
      const value = actualEvaluate(...args); if (phase === "return") queueMicrotask(() => { now = elapsed; }); else now = elapsed; return value;
    });
    const actualDigest = recorded.digest;
    if (phase === "digest") vi.spyOn(recorded, "digest").mockImplementation(value => { const result = actualDigest(value);
      if (value && typeof value === "object" && "questionEvaluations" in value) now = elapsed; return result; });
    const result = prepareHeldResearchReplay(f.pool, accounting).bindHeld(f.held).replay(f.context, f.request, 0);
    if (elapsed > 120000) await expect(result).rejects.toThrow("INVOCATION_DEADLINE_EXCEEDED");
    else expect((await result)?.completion).toEqual(f.completion);
  });
});

import { createSavedApplicationOwner, captureSavedApplicationCommand, type SavedApplicationRequest } from "@/lib/trader/paper/research-application-v1/repository-postgres";
import { runSavedApplication } from "@/lib/trader/paper/research-application-v1/run-saved-application";
import { APPLICATION_COMPUTATION_SOURCE_MANIFEST_DIGEST } from "@/lib/trader/paper/research-application-v1/computation-manifest";
import { APPLICATION_SPECIFICATION, APPLICATION_BRIDGE, APPLICATION_QUESTION_MAP } from "@/lib/trader/paper/research-application-v1/contract";
function emptyApplication() {
  const f = researchPureFixture();
  const request: SavedApplicationRequest = { operation: "replay", previousSourceSequence: 0, currentSourceSequence: 1,
    research: { assignment: f.config, profile: { definition: f.profileDefinition }, range: { startSequence: 0, count: 2, leaseDurationMs: 1000 } },
    configuration: { organizationId: f.session.organizationId, accountId: f.session.accountId, symbol: f.session.symbol,
      researchAssignmentDigest: f.assignment.contentDigest, researchSessionId: f.assignment.researchSessionId,
      sourceSessionId: f.session.sessionId, sourceConfigDigest: f.session.configDigest, profileId: f.profile.id, profileContentDigest: f.profile.contentDigest,
      computation: f.assignment.declarations.computation, computationManifestDigest: f.assignment.declarations.computationManifestDigest,
      applicationComputationManifestDigest: APPLICATION_COMPUTATION_SOURCE_MANIFEST_DIGEST,
      hypothesisId: "explicit-h", hypothesisKey: "a".repeat(64), hypothesisVersion: 1, hypothesisDefinitionDigest: "b".repeat(64),
      measurementId: "explicit-m", measurementKey: "c".repeat(64), measurementVersion: 1, measurementDefinitionDigest: "d".repeat(64),
      specification: APPLICATION_SPECIFICATION, bridge: APPLICATION_BRIDGE, questionMap: APPLICATION_QUESTION_MAP, maxAgeMs: 60000 } };
  const trace: string[] = []; let afterQuery: () => void = () => {}; let afterCommit: () => void = () => {};
  const unsafe = vi.fn((query: string, _params: unknown[] = []) => {
    void _params;
    trace.push(query); const promise: Promise<unknown[]> = Promise.resolve().then(() => { afterQuery(); return []; });
    return Object.assign(promise, { values: () => promise });
  });
  const held = { unsafe, savepoint: () => { throw new Error("SAVEPOINT_FORBIDDEN"); } } as unknown as postgres.TransactionSql;
  const begin = vi.fn(async (options: string, callback: (client: postgres.TransactionSql) => Promise<unknown>) => {
    trace.push(`begin ${options}`);
    let result: unknown;
    try { result = await callback(held); } catch (error) { trace.push("rollback"); throw error; }
    trace.push("commit"); afterCommit(); return result;
  });
  const pool = { begin, unsafe: () => { throw new Error("ROOT_TRANSPORT_FORBIDDEN"); }, options: { serializers: {}, parsers: {} } } as unknown as postgres.Sql;
  return { request, pool, held, trace, unsafe, begin, context: { organizationId: f.session.organizationId },
    afterQuery(fn: () => void) { afterQuery = fn; }, afterCommit(fn: () => void) { afterCommit = fn; } };
}
describe("actual application command capture/ownership and absent replay", () => {
  it("captures only an explicit complete-consumer B and never accepts returned facts or holder as input", () => {
    const f = emptyApplication(); f.request.operation = "complete-consumer";
    expect(() => captureSavedApplicationCommand(f.pool, f.context, f.request)).toThrow("APPLICATION_OPERATION_INVALID");
    f.request.consumerSourceSequence = 3;
    expect(captureSavedApplicationCommand(f.pool, f.context, f.request).request.operation).toBe("complete-consumer");
    for (const field of ["facts", "prepared", "holder", "source", "output", "evaluator"])
      expect(() => captureSavedApplicationCommand(f.pool, f.context, { ...f.request, [field]: {} })).toThrow("APPLICATION_COMMAND_INVALID");
    expect(f.begin).not.toHaveBeenCalled(); expect(f.unsafe).not.toHaveBeenCalled();
  });
  it("captures selectors before awaiting and allows an explicitly later nonadjacent B without an artificial32 offset", () => {
    const f = emptyApplication(); f.request.consumerSourceSequence = 100; const value = captureSavedApplicationCommand(f.pool, f.context, f.request);
    f.request.configuration.maxAgeMs = 0; f.request.currentSourceSequence = 99;
    expect(value.config.maxAgeMs).toBe(60000); expect(value.request.currentSourceSequence).toBe(1); expect(value.request.consumerSourceSequence).toBe(100);
    expect(f.begin).not.toHaveBeenCalled(); expect(f.unsafe).not.toHaveBeenCalled();
  });
  it.each(["actor", "evaluator", "output", "transaction", "tenant", "pair", "consumer"])("rejects %s input authority before any I/O", kind => {
    const f = emptyApplication(); const supplied = f.request as unknown as Record<string, unknown>;
    if (["actor", "evaluator", "output"].includes(kind)) supplied[kind] = "caller-selected";
    if (kind === "tenant") f.request.configuration.organizationId = "22222222-2222-4222-8222-222222222222";
    if (kind === "pair") f.request.currentSourceSequence = 2;
    if (kind === "consumer") f.request.consumerSourceSequence = 1;
    expect(() => createSavedApplicationOwner(kind === "transaction" ? f.held as unknown as postgres.Sql : f.pool, f.context, f.request)).toThrow();
    expect(f.begin).not.toHaveBeenCalled(); expect(f.unsafe).not.toHaveBeenCalled();
  });
  it("uses the actual isolated RR read-only owner and refuses absent replay without claiming a lease or writing", async () => {
    const f = emptyApplication(); const result = await runSavedApplication(f.pool, f.context, f.request);
    expect(result).toEqual({ status: "APPLICATION_OPERATION_MISSING", outcome: "REFUSED" });
    expect(f.trace[0]).toBe("begin isolation level repeatable read read only");
    expect(f.trace[1]).toContain("set local lock_timeout"); expect(f.trace[2]).toContain("set local statement_timeout");
    expect(f.trace.at(-1)).toBe("commit"); expect(f.begin).toHaveBeenCalledOnce();
    expect(f.trace.join("\n")).not.toMatch(/insert|for update|pg_advisory|runtime_control_lease/);
  });
  it.each(["query", "commit"])("refuses late %s result after120001ms without claiming rollback of committed data", async kind => {
    let now = 0; vi.spyOn(performance, "now").mockImplementation(() => now); const f = emptyApplication();
    if (kind === "query") f.afterQuery(() => { now = 120001; }); else f.afterCommit(() => { now = 120001; });
    expect(await runSavedApplication(f.pool, f.context, f.request)).toEqual({ status: "INVOCATION_DEADLINE_EXCEEDED", outcome: "REFUSED" });
    expect(f.trace.at(-1)).toBe(kind === "query" ? "rollback" : "commit"); expect(f.begin).toHaveBeenCalledOnce();
  });
  it("admits the119999 boundary but does not turn absent replay into COMPLETE", async () => {
    let now = 0; vi.spyOn(performance, "now").mockImplementation(() => now); const f = emptyApplication(); f.afterCommit(() => { now = 119999; });
    expect(await runSavedApplication(f.pool, f.context, f.request)).toEqual({ status: "APPLICATION_OPERATION_MISSING", outcome: "REFUSED" });
  });
  it("propagates unexpected transport and unknown commit errors instead of market unavailability", async () => {
    const f = emptyApplication(); f.afterCommit(() => { throw new Error("COMMIT_ACK_UNKNOWN"); });
    await expect(runSavedApplication(f.pool, f.context, f.request)).rejects.toThrow("COMMIT_ACK_UNKNOWN");
    expect(f.trace.at(-1)).toBe("commit"); expect(f.trace).not.toContain("rollback");
  });
  it("checks USER membership before reading any selected application body", async () => {
    const f = emptyApplication();
    await expect(runSavedApplication(f.pool, { ...f.context, userId: "22222222-2222-4222-8222-222222222222" }, f.request)).rejects.toThrow();
    expect(f.trace.join("\n")).toContain('"organization_members"');
    expect(f.trace.join("\n")).not.toContain('"trader_research_application'); expect(f.trace.at(-1)).toBe("rollback");
  });
});


/** Actual command and installed Drizzle; only SQL rows and transaction transport are inert. */
function claimApplication(mode: "absent" | "expired" | "busy" | "unique" | "failure") {
  const f = emptyApplication(); f.request.operation = "apply";
  const now = "2026-01-01T12:00:00.000Z";
  let head: Record<string, unknown> | null = mode === "expired" || mode === "busy" ? {
    organizationId: f.context.organizationId, runtimeInstanceId: "prior", leaseEpoch: 7, contentDigest: "a".repeat(64),
    validUntilUtc: mode === "busy" ? "2026-01-01T12:00:10.000Z" : "2026-01-01T11:59:59.000Z", updatedAt: now,
  } : null;
  const before = head && { ...head }; const writes: Array<{ query: string; params: unknown[] }> = [];
  const columns = getTableColumns(schema.traderRuntimeControlLeaseHeadsV2);
  const keys = new Map(Object.entries(columns).map(([key, col]) => [col.name, key]));
  f.unsafe.mockImplementation((query: string, params: unknown[] = []) => {
    f.trace.push(query);
    const result = async (arrays: boolean) => {
      if (f.begin.mock.calls.length >= 3) throw new Error("AFTER_REAL_CLAIM");
      if (query.includes("clock_timestamp()")) return [{ now }];
      if (query.startsWith("insert into")) {
        writes.push({ query, params: [...params] });
        if (query.includes('"trader_runtime_control_lease_epoch_history_v2"') && (mode === "unique" || mode === "failure"))
          throw Object.assign(new Error(mode === "unique" ? "synthetic unique violation" : "synthetic persistence failure"), { code: mode === "unique" ? "23505" : "XX000" });
        if (query.includes('"trader_runtime_control_lease_heads_v2"')) {
          const names = query.match(/\(([^)]+)\) values/)![1]!.split(",").map(v => v.trim().replaceAll('"', ''));
          const values = query.match(/ values \(([^)]+)\)/)![1]!.split(",").map(v => v.trim());
          head = Object.fromEntries(names.map((name, i) => [keys.get(name) ?? name, values[i]!.startsWith("$") ? params[Number(values[i]!.slice(1)) - 1] : now]));
        }
        return [];
      }
      if (query.includes('from "trader_runtime_control_lease_heads_v2"')) {
        if (!head) return [];
        return arrays ? [Object.keys(columns).map(k => head![k])] : [head];
      }
      return [];
    };
    return Object.assign(Promise.resolve().then(() => result(false)), { values: () => result(true) });
  });
  // Inert rollback model is not a native atomicity proof. It records the owner's order.
  f.begin.mockImplementation(async (options, callback) => {
    f.trace.push(`begin ${options}`); const saved = head && { ...head };
    try { const value = await callback(f.held); f.trace.push("commit"); return value; }
    catch (e) { head = saved; f.trace.push("rollback"); throw e; }
  });
  return { ...f, writes, before, head: () => head };
}
describe("actual application first acquisition composition", () => {
  it.each(["absent", "expired"] as const)("%s head reaches real lease history/head inserts before later work", async mode => {
    const f = claimApplication(mode);
    await expect(runSavedApplication(f.pool, f.context, f.request)).rejects.toThrow("AFTER_REAL_CLAIM");
    expect(f.writes).toHaveLength(2);
    expect(f.head()).toMatchObject({ organizationId: f.context.organizationId, leaseEpoch: mode === "absent" ? 1 : 8 });
    expect(f.writes[0]!.params).toContain(mode === "absent" ? null : "a".repeat(64));
    const begin = f.trace.findIndex(q => q === "begin isolation level read committed");
    const lock = f.trace.findIndex((q, i) => i > begin && q.includes("pg_advisory_xact_lock"));
    expect(begin).toBeGreaterThan(0); expect(f.trace.slice(begin, lock).join("\n")).toContain("lock_timeout");
    expect(f.trace.slice(begin, lock).join("\n")).toContain("statement_timeout");
    expect(f.trace.slice(begin, lock).some(q => /select .*from/.test(q))).toBe(false);
    expect(f.trace.filter(q => q === "commit")).toHaveLength(2); expect(f.trace.at(-1)).toBe("rollback");
  });
  it("live head refuses busy without any lease write", async () => {
    const f = claimApplication("busy");
    expect(await runSavedApplication(f.pool, f.context, f.request)).toEqual({ status: "APPLICATION_LEASE_BUSY", outcome: "REFUSED" });
    expect(f.writes).toEqual([]); expect(f.head()).toEqual(f.before);
  });
  it("23505 reaches actual owning rollback before its busy mapping", async () => {
    const f = claimApplication("unique");
    expect(await runSavedApplication(f.pool, f.context, f.request)).toEqual({ status: "APPLICATION_LEASE_BUSY", outcome: "REFUSED" });
    expect(f.writes).toHaveLength(1); expect(f.head()).toBeNull(); expect(f.trace.at(-1)).toBe("rollback");
    expect(f.begin).toHaveBeenCalledTimes(2);
  });
  it("unrelated claim persistence failure propagates after owning rollback", async () => {
    const f = claimApplication("failure");
    await expect(runSavedApplication(f.pool, f.context, f.request)).rejects.toThrow();
    expect(f.writes).toHaveLength(1); expect(f.head()).toBeNull(); expect(f.trace.at(-1)).toBe("rollback");
    expect(f.begin).toHaveBeenCalledTimes(2);
  });
});


import { createPostgresRuntimeControlLeaseRepositoryV2 } from "@/lib/trader/runtime-authority/v2/runtime-authority-repository-postgres-v2";
describe("old public claim retains installed Drizzle transaction/savepoint recovery", () => {
  it.each(["valid", "23505", "XX000"])("%s preserves the old nested boundary", async mode => {
    const trace: string[] = []; let writes = 0;
    const unsafe = (query: string) => {
      const execute = async () => { trace.push(query);
        if (query.startsWith("insert")) { writes++; if (mode !== "valid") throw Object.assign(new Error(`SQL_${mode}`), { code: mode }); }
        return [];
      };
      // Lazy thenable matches the driver's one dispatch, including Drizzle array mode.
      return { then: (resolve: (v: unknown[]) => unknown, reject: (e: unknown) => unknown) => execute().then(resolve, reject), values: execute };
    };
    type HeldPort = { unsafe: typeof unsafe; savepoint(fn: (value: HeldPort) => Promise<unknown>): Promise<unknown> };
    const held: HeldPort = { unsafe, savepoint: async fn => {
      trace.push("savepoint");
      try { const result = await fn(held); trace.push("release savepoint"); return result; }
      catch (error) { trace.push("rollback savepoint"); throw error; }
    } };
    const pool = { options: { parsers: {}, serializers: {} }, unsafe,
      begin: async (fn: (value: typeof held) => Promise<unknown>) => {
        trace.push("begin");
        try { const result = await fn(held); trace.push("commit"); return result; }
        catch (error) { trace.push("rollback"); throw error; }
      } };
    const db = postgresAdapter.drizzle(pool as unknown as postgres.Sql, { schema });
    const pending = db.transaction(async tx => {
      const result = await createPostgresRuntimeControlLeaseRepositoryV2(tx).claimExclusive({
        organizationId: "11111111-1111-4111-8111-111111111111", runtimeInstanceId: "old-public",
        leaseEpoch: 1, expectedPreviousDigest: null, leaseContentDigest: "a".repeat(64),
        adjudicatedAtUtc: "2026-01-01T00:00:00.000Z", validUntilUtc: "2026-01-01T00:00:10.000Z" });
      await tx.execute(sql`select 'outer still usable'`); return result;
    });
    if (mode === "XX000") { await expect(pending).rejects.toThrow("SQL_XX000"); expect(trace.at(-1)).toBe("rollback"); }
    else { expect(await pending).toBe(mode === "valid" ? "CLAIMED" : "CONFLICT"); expect(trace.at(-1)).toBe("commit");
      expect(trace.at(-2)).toBe("select 'outer still usable'"); }
    expect(trace[0]).toBe("begin"); expect(trace[1]).toBe("savepoint");
    expect(trace.filter(v => v === "savepoint")).toHaveLength(1);
    expect(trace).toContain(mode === "valid" ? "release savepoint" : "rollback savepoint");
    expect(writes).toBe(mode === "valid" ? 2 : 1);
  });
});
