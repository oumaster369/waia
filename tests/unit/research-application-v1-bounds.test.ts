// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ResearchReadBudget } from "@/lib/trader/paper/research-understanding-v1/bounded-source-postgres";

// Reflect also executes the real pre-extraction constructor, which ignored the
// extra command ledger. These RED controls concern the new composed boundary.
function local(maximum: number, shared: ResearchReadBudget): ResearchReadBudget {
  return Reflect.construct(ResearchReadBudget, [maximum, shared]);
}
function admit(budget: ResearchReadBudget, size: number, projection: string, id = "row") {
  Reflect.apply(budget.admit, budget, ["table", id, size, 100, projection]);
}
describe("held research shared projected-input budget", () => {
  it("keeps legacy independent limits and exact duplicate behavior", () => {
    const a = new ResearchReadBudget(10); const b = new ResearchReadBudget(10);
    a.admit("t", "a", 10, 10); b.admit("t", "b", 10, 10); a.admit("t", "a", 10, 10);
    expect(a.total).toBe(10); expect(b.total).toBe(10);
    expect(() => a.admit("t", "c", 1, 10)).toThrow("INPUT_AGGREGATE_LIMIT_EXCEEDED");
  });
  it("rejects combined overflow even when each packet is independently below its local cap", () => {
    const shared = new ResearchReadBudget(10); const a = local(10, shared); const b = local(10, shared);
    admit(a, 6, "packet", "a");
    expect(() => admit(b, 5, "packet", "b")).toThrow("INPUT_AGGREGATE_LIMIT_EXCEEDED");
    expect(b.total).toBe(0); expect(shared.total).toBe(6);
  });
  it("rejects changed size for the same shared projection across different packet readers", () => {
    const shared = new ResearchReadBudget(20); admit(local(10, shared), 6, "profile");
    expect(() => admit(local(10, shared), 5, "profile")).toThrow("SNAPSHOT_ROW_IDENTITY_CONFLICT");
  });
  it("deduplicates repeated projection but separately accounts for a smaller predecessor projection", () => {
    const shared = new ResearchReadBudget(20);
    const a = local(10, shared);
    admit(a, 6, "completion"); admit(local(10, shared), 6, "completion"); admit(a, 3, "predecessor");
    expect(shared.total).toBe(9);
  });
});

// The real Drizzle adapter emits SQL to an inert transaction client. No DB is opened.
import type postgres from "postgres";
import { sql } from "drizzle-orm";
import { afterEach, vi } from "vitest";
import { prepareHeldResearchReplay, HeldResearchAccounting } from "@/lib/trader/paper/research-understanding-v1/held-replay";
import { APPLICATION_LIMITS } from "@/lib/trader/paper/research-application-v1/contract";
afterEach(() => vi.restoreAllMocks());
function transport() {
  const unsafe = vi.fn(() => Object.assign(Promise.resolve([]), { values: async () => [] }));
  const client = { unsafe, savepoint() { throw new Error("SAVEPOINT_FORBIDDEN"); } } as unknown as postgres.TransactionSql;
  const pool = { begin() { throw new Error("ROOT_BEGIN_FORBIDDEN"); }, options: { parsers: {}, serializers: {} } } as unknown as postgres.Sql;
  const accounting = new HeldResearchAccounting(); return { unsafe, accounting, executor: prepareHeldResearchReplay(pool, accounting).bindHeld(client).executor };
}
describe("actual held dispatch and invocation accounting", () => {
  it("allows exactly512 dispatches and refuses the513th before the driver call", async () => {
    const f = transport();
    for (let i = 0; i < 512; i++) await f.executor.execute(sql`select ${i}`);
    expect(f.unsafe).toHaveBeenCalledTimes(512); expect(f.accounting.statements).toBe(512);
    await expect(f.executor.execute(sql`select 513`)).rejects.toThrow("STATEMENT_LIMIT_EXCEEDED");
    expect(f.unsafe).toHaveBeenCalledTimes(512);
  });
  it("retains counted reserved rollback after business exhaustion and deadline", async () => {
    let now = 0; vi.spyOn(performance, "now").mockImplementation(() => now);
    const f = transport(); f.accounting.reserveFinalization(1);
    for (let i = 0; i < 511; i++) await f.executor.execute(sql`select 1`);
    await expect(f.executor.execute(sql`select 2`)).rejects.toThrow("STATEMENT_LIMIT_EXCEEDED");
    now = 120001; expect(() => f.accounting.beforeFinalizationStatement()).not.toThrow();
    expect(f.accounting.statements).toBe(512); expect(() => f.accounting.beforeFinalizationStatement()).toThrow("FINALIZATION_SLOT_REQUIRED");
  });
  it("keeps one64MiB ledger across independently bounded reads, with no rounding", () => {
    const accounting = new HeldResearchAccounting();
    for (let i = 0; i < 4; i++) accounting.budget(16_777_216).admit("t", String(i), 16_777_216, 16_777_216, "packet");
    expect(accounting.inputs.total).toBe(APPLICATION_LIMITS.uniqueInputAggregate);
    expect(() => accounting.budget(10).admit("t", "extra", 1, 10)).toThrow("INPUT_AGGREGATE_LIMIT_EXCEEDED");
  });
  it("keeps additional application bodies inside the same64MiB through completion and consumption", () => {
    const accounting = new HeldResearchAccounting();
    const completion = accounting.budget(2_097_152), receipt = accounting.budget(2_097_152);
    completion.admit("completion", "B", 2_097_152, 2_097_152, "completion");
    receipt.admit("receipt", "B", 2_097_152, 2_097_152, "receipt");
    const remainder = APPLICATION_LIMITS.uniqueInputAggregate - 4_194_304 - APPLICATION_LIMITS.additionalAggregate;
    accounting.budget(remainder).admit("selected", "P/A/B", remainder, remainder, "packet");
    const additional = accounting.budget(APPLICATION_LIMITS.additionalAggregate);
    additional.admit("application", "existing", APPLICATION_LIMITS.additionalAggregate, APPLICATION_LIMITS.additionalAggregate);
    expect(accounting.inputs.total).toBe(APPLICATION_LIMITS.uniqueInputAggregate);
    // The subsequent reader charges the same admitted completion projection once.
    accounting.budget(2_097_152).admit("completion", "B", 2_097_152, 2_097_152, "completion");
    expect(() => accounting.budget(1).admit("consumption", "new", 1, 1)).toThrow("INPUT_AGGREGATE_LIMIT_EXCEEDED");
  });
  it("shares the original deadline with previously created local budgets", () => {
    let now = 0; vi.spyOn(performance, "now").mockImplementation(() => now);
    const f = transport(); const budget = f.accounting.budget(10);
    now = 119999; budget.admit("t", "a", 1, 10);
    now = 120001; expect(() => budget.admit("t", "b", 1, 10)).toThrow("INVOCATION_DEADLINE_EXCEEDED");
    expect(() => f.accounting.budget(10)).toThrow("INVOCATION_DEADLINE_EXCEEDED"); expect(f.unsafe).not.toHaveBeenCalled();
  });
});

import { readApplicationRows, applicationScope, decodeApplicationBody } from "@/lib/trader/paper/research-application-v1/bounded-read-postgres";
import { ResearchApplicationRefusal, applicationDigest } from "@/lib/trader/paper/research-application-v1/contract";
function applicationTransport(replies: unknown[][]) {
  const trace: string[] = [];
  const client = { savepoint() { throw new Error("SAVEPOINT_FORBIDDEN"); }, unsafe(query: string) {
    trace.push(query); return Object.assign(Promise.resolve(replies[trace.length - 1] ?? []), { values: async () => [] });
  } } as unknown as postgres.TransactionSql;
  const pool = { begin() { throw new Error("ROOT_BEGIN_FORBIDDEN"); }, options: { parsers: {}, serializers: {} } } as unknown as postgres.Sql;
  const accounting = new HeldResearchAccounting();
  return { trace, accounting, db: prepareHeldResearchReplay(pool, accounting).bindHeld(client).executor,
    budget: accounting.budget(APPLICATION_LIMITS.additionalAggregate) };
}
const applicationOrg = "00000000-0000-4000-8000-000000000001";
describe("actual bounded application SQL reader", () => {
  it("admits exact metadata before transferring the projection and preserves the canonical body", async () => {
    const body = { test: "synthetic" }, encoded = JSON.stringify(body), identity = '["org","app"]';
    const row = { applicationId: "app", bodyJson: encoded, contentDigest: applicationDigest(body), recordedAt: new Date("2026-01-01T00:00:00Z") };
    const f = applicationTransport([[{ identity, bytes: 400, projectionDigest: "a" }], [{ ...row, __identity: identity, __bytes: 400, __digest: "a" }]]);
    const result = await readApplicationRows(f.db, "application", applicationScope("application", applicationOrg, "app"), f.budget);
    expect(result).toEqual([{ ...row, recordedAt: "2026-01-01T00:00:00.000Z" }]); expect(decodeApplicationBody(result[0]!)).toEqual(body);
    expect(f.trace).toHaveLength(2); expect(f.trace[0]).toContain("octet_length(to_jsonb(bounded_row)::text)");
    expect(f.trace[0]).not.toContain("select bounded_row.*"); expect(f.trace[1]).toContain("select bounded_row.*");
    // The inner body set is an explicit admitted projection, not an unbounded table wildcard.
    expect(f.trace[1]).toContain('"ownership_domain" as "ownershipDomain"');
    expect(f.trace[1]).toContain('"body_json" as "bodyJson"'); expect(f.trace[1]).not.toMatch(/select \* from/);
    expect(f.accounting.statements).toBe(2); expect(f.accounting.inputs.total).toBe(400);
  });
  it("normalizes actual raw int8 projection strings without rounding saved sequence identities", async () => {
    const row = { organizationId: applicationOrg, applicationId: "app", previousSourceSequence: "0", currentSourceSequence: "1",
      consumerSourceSequence: "9007199254740991", sequence: "12" };
    const f = applicationTransport([[{ identity: "one", bytes: 400, projectionDigest: "a" }],
      [{ ...row, __identity: "one", __bytes: 400, __digest: "a" }]]);
    expect(await readApplicationRows(f.db, "application", applicationScope("application", applicationOrg, "app"), f.budget))
      .toEqual([{ ...row, previousSourceSequence: 0, currentSourceSequence: 1, consumerSourceSequence: Number.MAX_SAFE_INTEGER, sequence: 12 }]);
    expect(f.trace).toHaveLength(2);
  });
  it.each(["9007199254740992", "-1", "1.5", "", "01", null])("refuses raw integer identity %j instead of coercing it", async value => {
    const f = applicationTransport([[{ identity: "one", bytes: 400, projectionDigest: "a" }],
      [{ sequence: value, __identity: "one", __bytes: 400, __digest: "a" }]]);
    await expect(readApplicationRows(f.db, "consumption", applicationScope("consumption", applicationOrg, "app"), f.budget))
      .rejects.toThrow("APPLICATION_INTEGER_INVALID");
  });
  it.each(["oversize", "history33", "missing"])("refuses %s before a body query", async kind => {
    const one = { identity: "one", bytes: kind === "oversize" ? APPLICATION_LIMITS.registration + 1 : 400, projectionDigest: "a" };
    const f = applicationTransport([kind === "missing" ? [] : kind === "history33" ? Array.from({ length: 33 }, (_, i) => ({ ...one, identity: String(i) })) : [one]]);
    await expect(readApplicationRows(f.db, "hypothesis", applicationScope("hypothesis", applicationOrg, "h"), f.budget,
      { maximum: kind === "history33" ? 32 : 1 })).rejects.toThrow();
    expect(f.trace).toHaveLength(1); expect(f.trace[0]).not.toContain("select bounded_row.*");
  });
  it.each(["bytes", "digest", "identity", "disappeared"])("refuses metadata/body %s drift", async kind => {
    const row = { id: "h", __identity: kind === "identity" ? "other" : "one", __bytes: kind === "bytes" ? 401 : 400, __digest: kind === "digest" ? "b" : "a" };
    const f = applicationTransport([[{ identity: "one", bytes: 400, projectionDigest: "a" }], kind === "disappeared" ? [] : [row]]);
    await expect(readApplicationRows(f.db, "hypothesis", applicationScope("hypothesis", applicationOrg, "h"), f.budget)).rejects.toThrow(/APPLICATION_ROW_/);
    expect(f.trace).toHaveLength(2);
  });
  it("locks only the admitted source set after metadata and body, with scalar lock projection", async () => {
    const row = { id: "source", organizationId: applicationOrg, venue: "SYNTHETIC", feedKind: "quote", symbol: "SYNTH" };
    const f = applicationTransport([[{ identity: "one", bytes: 400, projectionDigest: "a" }],
      [{ ...row, __identity: "one", __bytes: 400, __digest: "a" }], [{ identity: "source" }]]);
    expect(await readApplicationRows(f.db, "source", applicationScope("source", applicationOrg, "source"), f.budget, { lock: true })).toEqual([row]);
    expect(f.trace).toHaveLength(3); expect(f.trace[2]).toMatch(/order by[\s\S]+for share/); expect(f.trace[2]).not.toContain("body_json");
  });
  it("does not silently admit an absent requested source lock", async () => {
    const f = applicationTransport([[{ identity: "one", bytes: 400, projectionDigest: "a" }], [{ id: "s", __identity: "one", __bytes: 400, __digest: "a" }], []]);
    await expect(readApplicationRows(f.db, "source", applicationScope("source", applicationOrg, "s"), f.budget, { lock: true })).rejects.toThrow("APPLICATION_LOCK_SET_CHANGED");
  });
  it("maps malformed saved JSON to an explicit integrity refusal", () => {
    expect(() => decodeApplicationBody({ bodyJson: "{", contentDigest: "a" })).toThrow(ResearchApplicationRefusal);
    expect(() => decodeApplicationBody({ bodyJson: "null", contentDigest: applicationDigest(null) })).toThrow("APPLICATION_BODY_CONFLICT");
  });
});

import { admitApplicationWriteRow, readApplicationRegistration } from "@/lib/trader/paper/research-application-v1/bounded-read-postgres";
import type { ResearchApplicationConfigurationV1 } from "@/lib/trader/paper/research-application-v1/contract";
describe("full physical candidate projection admission", () => {
  const candidate = () => ({ ownershipDomain: "CAPITAL_LEGACY_V2", organizationId: applicationOrg, assignmentDigest: "a".repeat(64), contentDigest: "b".repeat(64),
    bodyJson: '{"body":"quoted \\" text"}', runtimeInstanceId: "owner", leaseEpoch: 1, leaseContentDigest: "c".repeat(64),
    researchSessionId: "r", researchAssignmentDigest: "d".repeat(64) });
  it("charges the actual SQL projection bytes with its holder/body escaping, not only the raw body", async () => {
    const row = candidate(), f = applicationTransport([[{ identity: "[\"org\", \"id\"]", bytes: 65536 }]]);
    await admitApplicationWriteRow(f.db, "assignment", row, f.budget);
    expect(f.accounting.inputs.total).toBe(65536); expect(f.trace).toHaveLength(1);
    expect(f.trace[0]).toContain("octet_length(jsonb_build_object(");
    expect(f.trace[0]).toContain("ownershipDomain");
    expect(f.trace[0]).toContain("::uuid"); expect(f.trace[0]).toContain("::integer");
    expect(f.trace[0]).not.toMatch(/insert|select bounded_row\.\*/);
  });
  it("deduplicates candidate and stored admission using the exact server identity text", async () => {
    const row = candidate(), identity = '["org", "id"]';
    const f = applicationTransport([[{ identity, bytes: 1000 }], [{ identity, bytes: 1000, projectionDigest: "digest" }],
      [{ ...row, __identity: identity, __bytes: 1000, __digest: "digest" }]]);
    await admitApplicationWriteRow(f.db, "assignment", row, f.budget);
    expect(await readApplicationRows(f.db, "assignment", applicationScope("assignment", applicationOrg, row.assignmentDigest), f.budget)).toEqual([row]);
    expect(f.budget.total).toBe(1000); expect(f.accounting.inputs.total).toBe(1000);
    expect(f.trace[0]).toContain("jsonb_build_array(");
  });
  it("refuses a one-byte physical overflow without admitting it even when the raw body is tiny", async () => {
    const f = applicationTransport([[{ identity: "[\"org\", \"id\"]", bytes: 65537 }]]);
    await expect(admitApplicationWriteRow(f.db, "assignment", candidate(), f.budget)).rejects.toThrow("STORED_ROW_LIMIT_EXCEEDED");
    expect(f.accounting.inputs.total).toBe(0); expect(f.trace).toHaveLength(1);
  });
  it.each(["extra", "missing", "domain", "body"])("refuses %s candidate before dispatch", async kind => {
    const f = applicationTransport([]), row: Record<string, unknown> = candidate();
    if (kind === "extra") row.extra = 1; else if (kind === "missing") delete row.leaseContentDigest; else if (kind === "domain") delete row.ownershipDomain; else row.bodyJson = "x".repeat(65537);
    await expect(admitApplicationWriteRow(f.db, "assignment", row, f.budget)).rejects.toThrow(); expect(f.trace).toEqual([]);
  });
});

describe("actual registration projection narrowing", () => {
  const createdAt = "2026-01-01T00:00:00.000Z";
  const h = { id: "h", organizationId: applicationOrg, hypothesisKind: "market_claim", hypothesisKey: "hk", name: "name",
    schemaVersion: "mi-hypothesis-v1", definitionJson: "{}", definitionDigest: "hd", supersedesJson: null, versionSeq: 1,
    revisionOf: null, authoredBy: "u", createdAt };
  const m = { id: "m", organizationId: applicationOrg, measurementKind: "feature_transform", measurementKey: "mk", name: "name",
    schemaVersion: "mi-measurement-v1", definitionJson: "{}", definitionDigest: "md", versionSeq: 1, revisionOf: null, authoredBy: "u", createdAt };
  function rows(row: Record<string, unknown>, identity: string): unknown[][] {
    return [[{ identity, bytes: 500, projectionDigest: "d" }], [{ ...row, __identity: identity, __bytes: 500, __digest: "d" }]];
  }
  const configuration = { organizationId: applicationOrg, hypothesisId: "h", hypothesisKey: "hk", measurementId: "m" } as ResearchApplicationConfigurationV1;
  it.each(["valid", "missing", "kind", "unsafe", "nullable"])("narrows %s data without a broadcast domain cast", async kind => {
    const hypothesis: Record<string, unknown> = { ...h };
    if (kind === "missing") delete hypothesis.authoredBy;
    if (kind === "kind") hypothesis.hypothesisKind = "foreign";
    if (kind === "unsafe") hypothesis.versionSeq = Number.MAX_SAFE_INTEGER + 1;
    if (kind === "nullable") hypothesis.revisionOf = false;
    const version = { id: "h", organizationId: applicationOrg, hypothesisKey: "hk", versionSeq: 1, definitionDigest: "hd", createdAt };
    const life = { id: "l", organizationId: applicationOrg, hypothesisId: "h", hypothesisKey: "hk", lifecycleState: "PROPOSED",
      rationale: "r", recordedBy: "u", seq: 1, contentDigest: "ld", createdAt };
    const f = applicationTransport([...rows(hypothesis, "h"), ...rows(m, "m"), ...rows(version, "v"), ...rows(life, "l")]);
    const result = readApplicationRegistration(f.db, configuration, createdAt, f.budget);
    if (kind === "valid") expect((await result).hypothesis).toEqual({ ...h, createdAt: new Date(createdAt) });
    else await expect(result).rejects.toThrow("APPLICATION_REGISTRATION_ROW_INVALID");
    expect(f.trace).toHaveLength(8);
  });
});
