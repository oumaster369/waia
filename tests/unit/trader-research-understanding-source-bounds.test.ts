// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { ResearchReadBudget, readBoundedResearchInputs, readBoundedResearchProfile, readBoundedResearchAssignment, readBoundedResearchCompletion } from "@/lib/trader/paper/research-understanding-v1/bounded-source-postgres";
import { LIMITS } from "@/lib/trader/paper/research-understanding-v1/contract";
import { encodeBody } from "@/lib/trader/paper/durable-noncapital/recorded-source-read-validation-v1";
import { researchPureFixture } from "../helpers/research-understanding-fixture";
import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";
import * as canonicalService from "@/lib/trader/mi/canonical-pit-service-postgres";
import * as trustReader from "@/lib/trader/mi/trust-as-of-repository-postgres";

/** Inert SQL projection trace only; not a database, transaction, RLS or native-content proof. */
function tracedReader(f: ReturnType<typeof researchPureFixture>, failTable: string, size: number, expected = 1) {
  const trace: string[] = []; const dialect = new PgDialect();
  const header = { organizationId: f.session.organizationId, sessionId: f.session.sessionId, contentDigest: f.session.configDigest,
    bodyJson: canonicalJsonString(Object.fromEntries(Object.entries(f.session).filter(([key]) => key !== "configDigest"))) };
  const packet = { organizationId: f.session.organizationId, sessionId: f.session.sessionId, sequence: 0, configDigest: f.session.configDigest,
    analysisPitAnchor: f.packet.analysisPitAnchor, contentDigest: f.packet.contentDigest, bodyJson: encodeBody(f.packet) };
  const execute = vi.fn(async (query: SQL): Promise<Record<string, unknown>[]> => {
    const { sql: text, params } = dialect.sqlToQuery(query); trace.push(text);
    const table = /from "(trader_[a-z0-9_]+)"/.exec(text)?.[1];
    const metadata = text.includes("octet_length(to_jsonb(bounded_row)::text)");
    if (metadata) {
      if (table === failTable) return Array.from({ length: expected }, (_, i) => ({ identity: JSON.stringify([i]), bytes: size }));
      const known = table === "trader_mi_gateway_pit_receipt_v1" ? f.packet.sources.map(s => s.receipt.id) :
        table === "trader_mi_observation" ? f.packet.sources.flatMap(s => s.receipt.observationId ? [s.receipt.observationId] : []) :
        table === "trader_mi_trust_as_of_receipt_v1" ? f.packet.sources.flatMap(s => s.receipt.trustAsOfReceiptId ? [s.receipt.trustAsOfReceiptId] : []) :
        table === "trader_mi_source_trust" ? f.revisions.map(r => r.id) : table === "trader_mi_source" ? f.packet.sources.map(s => s.receipt.sourceId!) : ["one"];
      return [...new Set(known)].filter(id => id === "one" || params.includes(id)).map(id => ({ identity: JSON.stringify([id]), bytes: 100 }));
    }
    if (table === "trader_recorded_analysis_sessions_v1") return [header];
    if (table === "trader_recorded_analysis_packets_v1") return [packet];
    throw new Error(`UNEXPECTED_BODY_READ:${table}`);
  });
  return { db: { execute } as unknown as WaiaPostgresDb, trace, execute };
}
describe("metadata-first research capacity", () => {
  afterEach(() => { vi.restoreAllMocks(); });
  it.each([false, true])("raw PostgreSQL timestamp projection preserves exact selected chronology (changed=%s)", async changed => {
    const f = researchPureFixture(); const dialect = new PgDialect();
    const t = tracedReader(f, "none", 0); const original = t.execute.getMockImplementation()!;
    const pgTime = (value: string) => value.replace("T", " ").replace(".000Z", "+00");
    vi.spyOn(canonicalService, "readCanonicalPitObservationWithinHeldTransactionV1Postgres").mockImplementation(async (_db, _context, id) =>
      f.packet.sources.find(s => s.receipt.observationId === id)!.observation as Awaited<ReturnType<typeof canonicalService.readCanonicalPitObservationWithinHeldTransactionV1Postgres>>);
    vi.spyOn(trustReader, "readTrustAsOfReceiptV1Postgres").mockImplementation(async (_db, _context, id) =>
      f.packet.sources.find(s => s.receipt.trustAsOfReceiptId === id)!.trust as Awaited<ReturnType<typeof trustReader.readTrustAsOfReceiptV1Postgres>>);
    t.execute.mockImplementation(async query => {
      const q = dialect.sqlToQuery(query).sql;
      if (q.includes("octet_length") || q.includes('from "trader_recorded_analysis_sessions_v1"') || q.includes('from "trader_recorded_analysis_packets_v1"')) return original(query);
      if (q.includes('from "trader_recorded_analysis_companions_v1"')) return [{ packetDigest: f.packet.contentDigest,
        accountId: f.session.accountId, symbol: f.session.symbol, barInterval: "1m", scheduledBarCloseTime: pgTime(f.packet.normalized.scheduledBarCloseTime) }];
      if (q.includes('from "trader_mi_gateway_pit_receipt_v1"')) return f.packet.sources.map(s => ({ id: s.receipt.id, contentDigest: s.receipt.contentDigest, receiptJson: s.receipt }));
      if (q.includes('from "trader_mi_source"')) return f.packet.sources.map(s => s.source as Record<string, unknown>);
      if (q.includes('from "trader_mi_source_trust"')) return f.revisions.map((r, i) => ({ ...r,
        eventTime: pgTime(r.eventTime), ingestTime: pgTime(r.ingestTime), availableAt: changed && i === 0
          ? "2026-01-01 00:00:00.001+00" : r.availableAt ? pgTime(r.availableAt) : null }));
      throw new Error(`UNEXPECTED_BODY_READ:${q}`);
    });
    const result = readBoundedResearchInputs(t.db, f.assignment, f.profile, 0, new ResearchReadBudget(LIMITS.inputAggregate));
    if (changed) await expect(result).rejects.toThrow("SOURCE_REVISION_CHRONOLOGY_CONFLICT");
    else expect((await result).revisions).toEqual([...f.revisions].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  });
  it("deduplicates only exact table/PK pairs, retains repeated embedded bytes, and refuses overflow", () => {
    const b = new ResearchReadBudget(10); b.admit("a", "x", 4, 10); b.admit("a", "x", 4, 10); expect(b.total).toBe(4);
    b.admit("b", "x", 6, 10); expect(b.total).toBe(10);
    expect(() => b.admit("a", "y", 1, 10)).toThrow("INPUT_AGGREGATE_LIMIT_EXCEEDED");
    expect(() => b.admit("a", "x", 5, 10)).toThrow("SNAPSHOT_ROW_IDENTITY_CONFLICT");
  });
  it.each([NaN, Infinity, -1, 0.5, 101])("refuses invalid or oversized metadata %s", size => {
    expect(() => new ResearchReadBudget(1000).admit("t", "id", size, 100)).toThrow("STORED_ROW_LIMIT_EXCEEDED");
  });
  it("bounds the source header before any body materialization", async () => {
    const f = researchPureFixture(); const t = tracedReader(f, "trader_recorded_analysis_sessions_v1", LIMITS.session + 1);
    await expect(readBoundedResearchInputs(t.db, f.assignment, f.profile, 0, new ResearchReadBudget(LIMITS.inputAggregate))).rejects.toThrow("STORED_ROW_LIMIT_EXCEEDED");
    expect(t.trace).toHaveLength(1); expect(t.trace[0]).toContain("octet_length");
  });
  it("bounds the full packet projection before its JSON body is transferred", async () => {
    const f = researchPureFixture(); const t = tracedReader(f, "trader_recorded_analysis_packets_v1", f.session.maxPacketBytes + 1);
    await expect(readBoundedResearchInputs(t.db, f.assignment, f.profile, 0, new ResearchReadBudget(LIMITS.inputAggregate))).rejects.toThrow("STORED_ROW_LIMIT_EXCEEDED");
    expect(t.trace).toHaveLength(3); expect(t.trace.at(-1)).toContain("octet_length");
  });
  it("checks all selected external sets and their aggregate before external/old-output materialization", async () => {
    const f = researchPureFixture(); const count = new Set(f.revisions.map(r => r.id)).size;
    const t = tracedReader(f, "trader_mi_source_trust", LIMITS.externalRow + 1, count);
    await expect(readBoundedResearchInputs(t.db, f.assignment, f.profile, 0, new ResearchReadBudget(LIMITS.inputAggregate))).rejects.toThrow("STORED_ROW_LIMIT_EXCEEDED");
    expect(t.trace.filter(q => !q.includes("octet_length"))).toHaveLength(2); // bounded discovery header and packet only
    const companion = t.trace.find(q => q.includes('from "trader_recorded_analysis_companions_v1"'))!;
    expect(companion).not.toContain("body_json"); expect(companion).not.toContain("output"); expect(companion).not.toContain("nextState");
    expect(t.trace.at(-1)).toContain('from "trader_mi_source_trust"');
  });
  for (const [kind, table] of [
    ["gateway", "trader_mi_gateway_pit_receipt_v1"], ["observation", "trader_mi_observation"],
    ["trust", "trader_mi_trust_as_of_receipt_v1"], ["revision", "trader_mi_source_trust"], ["source", "trader_mi_source"],
  ] as const) it.each([0, 1])(`${kind} exact stored-row bound plus %s is enforced before bodies`, async excess => {
    const f = researchPureFixture();
    const ids = kind === "gateway" ? f.packet.sources.map(s => s.receipt.id) : kind === "observation" ? f.packet.sources.map(s => s.receipt.observationId) :
      kind === "trust" ? f.packet.sources.map(s => s.receipt.trustAsOfReceiptId) : kind === "revision" ? f.revisions.map(r => r.id) : f.packet.sources.map(s => s.receipt.sourceId);
    const count = new Set(ids.filter(Boolean)).size; const maximum = kind === "source" ? LIMITS.source : LIMITS.externalRow;
    const t = tracedReader(f, table, maximum + excess, count);
    await expect(readBoundedResearchInputs(t.db, f.assignment, f.profile, 0, new ResearchReadBudget(LIMITS.inputAggregate)))
      .rejects.toThrow(excess ? "STORED_ROW_LIMIT_EXCEEDED" : "UNEXPECTED_BODY_READ:trader_recorded_analysis_companions_v1");
    expect(t.trace.filter(q => !q.includes("octet_length") && !q.includes('from "trader_recorded_analysis_sessions_v1"') &&
      !q.includes('from "trader_recorded_analysis_packets_v1"'))).toHaveLength(excess ? 0 : 1);
  });
  it.each(["completion", "receipt", "predecessor"] as const)("bounds completed replay %s before either output body", async target => {
    const f = researchPureFixture(); const trace: string[] = []; const dialect = new PgDialect();
    const db = { execute: async (query: SQL) => {
      const q = dialect.sqlToQuery(query).sql; trace.push(q);
      if (q.includes("octet_length")) {
        const kind = q.includes("trader_information_sufficiency_receipt_v2") ? "receipt" : q.includes("body_json") ? "completion" : "predecessor";
        const cap = kind === "receipt" ? LIMITS.informationReceipt : kind === "completion" ? LIMITS.completion : LIMITS.predecessor;
        return [{ identity: JSON.stringify([kind]), bytes: kind === target ? cap + 1 : 100 }];
      }
      if (!q.includes("body_json") && q.includes('as "receiptId"')) return [{ receiptId: "a".repeat(64) }];
      throw new Error("OUTPUT_BODY_MATERIALIZED_BEFORE_CAPS");
    } } as unknown as WaiaPostgresDb;
    await expect(readBoundedResearchCompletion(db, f.assignment, f.profile, 1)).rejects.toThrow("STORED_ROW_LIMIT_EXCEEDED");
    expect(trace.filter(q => !q.includes("octet_length"))).toHaveLength(target === "completion" ? 0 : 1);
  });
  it("rejects an extra exact-ID row sentinel before any selected external body", async () => {
    const f = researchPureFixture(); const t = tracedReader(f, "trader_mi_gateway_pit_receipt_v1", 1, f.packet.sources.length + 1);
    await expect(readBoundedResearchInputs(t.db, f.assignment, f.profile, 0, new ResearchReadBudget(LIMITS.inputAggregate))).rejects.toThrow("EXACT_ROW_SET_MISSING_OR_AMBIGUOUS");
    expect(t.trace.filter(q => !q.includes("octet_length"))).toHaveLength(2);
  });
  it("includes previous admitted profile and assignment bytes in the same input aggregate", async () => {
    const f = researchPureFixture(); const t = tracedReader(f, "trader_mi_gateway_pit_receipt_v1", 100, f.packet.sources.length);
    const budget = new ResearchReadBudget(400); budget.admit("assignment", "id", 100, LIMITS.assignment); budget.admit("profile", "id", 100, LIMITS.profile);
    await expect(readBoundedResearchInputs(t.db, f.assignment, f.profile, 0, budget)).rejects.toThrow("INPUT_AGGREGATE_LIMIT_EXCEEDED");
    expect(t.trace.filter(q => !q.includes("octet_length"))).toHaveLength(2);
  });
  it.each(["profile", "assignment"])("bounds owned %s support row before parsing", async kind => {
    const f = researchPureFixture(); const table = kind === "profile" ? "trader_required_information_profile_v2" : "trader_research_understanding_assignments_v1";
    const t = tracedReader(f, table, (kind === "profile" ? LIMITS.profile : LIMITS.assignment) + 1);
    const result = kind === "profile" ? readBoundedResearchProfile(t.db, f.session.organizationId, f.profile.id) :
      readBoundedResearchAssignment(t.db, f.session.organizationId, f.assignment.researchSessionId, new ResearchReadBudget(LIMITS.inputAggregate));
    await expect(result).rejects.toThrow("STORED_ROW_LIMIT_EXCEEDED"); expect(t.trace).toHaveLength(1);
  });
});
