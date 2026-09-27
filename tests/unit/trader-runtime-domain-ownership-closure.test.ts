// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { ResearchReadBudget } from "@/lib/trader/paper/research-understanding-v1/bounded-source-postgres";
import { NoncapitalControlReadBudget, assertSavedApplicationRootsWithinHeldTransactionV1,
  assertSavedUnderstandingRootWithinHeldTransactionV1, claimSavedResearchWithinHeldTransactionV1,
  claimRecordedAcquisitionWithinHeldTransactionV1, assertSavedResearchHolderWithinHeldTransactionV1,
  type SavedResearchHolderV1 } from "@/lib/trader/runtime-authority/v2/noncapital-domain-lease-postgres-v1";

const org = "10000000-0000-0000-0000-000000000001";
const h = (value: string) => createHash("sha256").update(value).digest("hex");
const input = { organizationId: org, assignmentDigest: h("configuration"), applicationId: h("pair1"),
  researchSessionId: "saved-session", researchAssignmentDigest: h("research") };
const dialect = new PgDialect();
type Query = ReturnType<PgDialect["sqlToQuery"]>;
function port(read: (query: Query) => unknown[]) {
  const queries: Query[] = [];
  const tx = { async execute(query: SQL) { const value = dialect.sqlToQuery(query); queries.push(value); return read(value); } };
  return { tx: tx as unknown as Pick<WaiaPostgresDb, "execute">, queries };
}
function packet(values: unknown[]) { const text = JSON.stringify(values); return [{ packet: text, bytes: Buffer.byteLength(text) }]; }
function root(kind: "APPLICATION_ASSIGNMENT" | "APPLICATION" | "UNDERSTANDING_ASSIGNMENT", domain = "SAVED_RESEARCH_V1") {
  const key = kind === "APPLICATION_ASSIGNMENT" ? input.assignmentDigest : kind === "APPLICATION" ? input.applicationId : input.researchSessionId;
  return { rootKind: kind, organizationId: org, keyDigest: h(key), ownershipDomain: domain,
    contentDigest: kind === "UNDERSTANDING_ASSIGNMENT" ? input.researchAssignmentDigest : h(kind), leaseEpoch: 1, leaseDigest: h("lease"), present: true };
}
function budget(maximum = 67_108_864) {
  const shared = new ResearchReadBudget(maximum); return { shared, control: new NoncapitalControlReadBudget(shared) };
}

describe("fixed noncapital domain metadata and held lease boundaries", () => {
  it("looks up the configuration root independently of pair application and refuses legacy affinity before any writer", async () => {
    const p = port(() => packet([root("APPLICATION_ASSIGNMENT", "CAPITAL_LEGACY_V2"), root("UNDERSTANDING_ASSIGNMENT")]));
    await expect(assertSavedApplicationRootsWithinHeldTransactionV1(p.tx, input, "apply", budget().control)).rejects.toThrow("ASSIGNMENT_DOMAIN_CONFLICT");
    expect(p.queries).toHaveLength(1);
    const q = p.queries[0]!;
    expect(q.params).toContain(input.assignmentDigest); expect(q.params).toContain(input.applicationId); expect(q.params).toContain(input.researchSessionId);
    expect(q.sql).toContain('from "trader_research_application_assignments_v1" where organization_id=');
    expect(q.sql).toContain('and "assignment_digest"=');
    expect(q.sql.match(/union all/g)).toHaveLength(2);
    expect(q.sql).not.toMatch(/\b(insert|update|delete|for update|body_json|limit)\b/i);
    for (const clause of q.sql.split("where").slice(1)) expect(clause.split(/union all|\) as selected_roots/)[0]).not.toMatch(/ownership_domain|content_digest/);
  });
  it("admits a saved configuration for a new pair while requiring actual Understanding identity", async () => {
    const p = port(() => packet([root("APPLICATION_ASSIGNMENT"), root("UNDERSTANDING_ASSIGNMENT", "CAPITAL_LEGACY_V2")]));
    const result = await assertSavedApplicationRootsWithinHeldTransactionV1(p.tx, input, "apply", budget().control);
    expect(result.application).toBeUndefined(); expect(result.understanding.ownershipDomain).toBe("CAPITAL_LEGACY_V2");
    await expect(assertSavedApplicationRootsWithinHeldTransactionV1(p.tx, { ...input, researchAssignmentDigest: h("other") }, "apply", budget().control))
      .rejects.toThrow("ASSIGNMENT_IDENTITY_CONFLICT");
  });
  it("keeps completed foreign facts readable but requires a saved root for write-capable B", async () => {
    const p = port(() => packet([root("APPLICATION_ASSIGNMENT"), root("APPLICATION"), root("UNDERSTANDING_ASSIGNMENT", "CAPITAL_LEGACY_V2")]));
    await expect(assertSavedApplicationRootsWithinHeldTransactionV1(p.tx, input, "consume", budget().control)).resolves.toBeDefined();
    await expect(assertSavedApplicationRootsWithinHeldTransactionV1(p.tx, input, "complete-consumer", budget().control)).rejects.toThrow("ASSIGNMENT_DOMAIN_CONFLICT");
    const missing = port(() => packet([root("UNDERSTANDING_ASSIGNMENT")]));
    await expect(assertSavedApplicationRootsWithinHeldTransactionV1(missing.tx, input, "consume", budget().control)).rejects.toThrow("ASSIGNMENT_DOMAIN_CONFLICT");
    expect(missing.queries).toHaveLength(1);
  });
  it("uses only the exact session for Understanding and validates an existing assignment against its actual selected digest", async () => {
    const p = port(() => packet([root("UNDERSTANDING_ASSIGNMENT")]));
    await expect(assertSavedUnderstandingRootWithinHeldTransactionV1(p.tx, { organizationId: org, researchSessionId: input.researchSessionId }, budget().control))
      .rejects.toThrow("ASSIGNMENT_IDENTITY_CONFLICT");
    await expect(assertSavedUnderstandingRootWithinHeldTransactionV1(p.tx, { organizationId: org, researchSessionId: input.researchSessionId,
      expectedAssignmentDigest: input.researchAssignmentDigest }, budget().control)).resolves.toMatchObject({ ownershipDomain: "SAVED_RESEARCH_V1" });
    expect(p.queries[0]!.sql).not.toContain("union all");
    expect(p.queries[0]!.params).not.toContain(input.researchAssignmentDigest);
  });
  it("charges actual returned bytes inside the original aggregate and deduplicates exact content", async () => {
    const selected = [root("UNDERSTANDING_ASSIGNMENT")], p = port(() => packet(selected));
    const b = budget();
    await assertSavedApplicationRootsWithinHeldTransactionV1(p.tx, input, "apply", b.control);
    const first = b.shared.total; expect(first).toBeGreaterThan(Buffer.byteLength(JSON.stringify(selected)));
    expect(b.control.total).toBe(first);
    await assertSavedApplicationRootsWithinHeldTransactionV1(p.tx, input, "apply", b.control);
    expect(b.shared.total).toBe(first);
    await expect(assertSavedApplicationRootsWithinHeldTransactionV1(p.tx, input, "apply", budget(first - 1).control)).rejects.toThrow("INPUT_AGGREGATE_LIMIT_EXCEEDED");
  });
  it("charges absence and later presence as separate observations and rejects changed actual bytes under the same persisted version", async () => {
    let values: unknown[] = [];
    const p = port(() => packet(values)), b = budget();
    await assertSavedUnderstandingRootWithinHeldTransactionV1(p.tx, { organizationId: org, researchSessionId: input.researchSessionId }, b.control);
    const empty = b.shared.total; expect(empty).toBeGreaterThan(2);
    values = [root("UNDERSTANDING_ASSIGNMENT")];
    await assertSavedUnderstandingRootWithinHeldTransactionV1(p.tx, { organizationId: org, researchSessionId: input.researchSessionId,
      expectedAssignmentDigest: input.researchAssignmentDigest }, b.control);
    expect(b.shared.total).toBeGreaterThan(empty);
    b.control.admit(["immutable", h("version")], "same-length-a");
    expect(() => b.control.admit(["immutable", h("version")], "same-length-b")).toThrow("CONTROL_VERSION_CONTENT_CONFLICT");
  });
  it.each([
    ["duplicate root", [root("UNDERSTANDING_ASSIGNMENT"), root("UNDERSTANDING_ASSIGNMENT")]],
    ["wrong tenant", [{ ...root("UNDERSTANDING_ASSIGNMENT"), organizationId: "10000000-0000-0000-0000-000000000002" }]],
    ["wrong full-key hash", [{ ...root("UNDERSTANDING_ASSIGNMENT"), keyDigest: h("different") }]],
    ["unsupported domain", [root("UNDERSTANDING_ASSIGNMENT", "RECORDED_ACQUISITION_V1")]],
    ["extra body", [{ ...root("UNDERSTANDING_ASSIGNMENT"), bodyJson: "{}" }]],
    ["not present", [{ ...root("UNDERSTANDING_ASSIGNMENT"), present: false }]],
    ["fractional epoch", [{ ...root("UNDERSTANDING_ASSIGNMENT"), leaseEpoch: 1.5 }]],
    ["unregistered root", [{ ...root("UNDERSTANDING_ASSIGNMENT"), rootKind: "OTHER" }]],
  ])("refuses malformed scalar projection: %s", async (_title, values) => {
    const p = port(() => packet(values as unknown[]));
    await expect(assertSavedApplicationRootsWithinHeldTransactionV1(p.tx, input, "apply", budget().control)).rejects.toThrow("CONTROL_ROOT_SHAPE_CONFLICT");
    expect(p.queries).toHaveLength(1);
  });
  it("refuses inconsistent UTF-8 metadata and the fixed control limit", async () => {
    const p = port(() => [{ packet: "[]", bytes: 1 }]);
    await expect(assertSavedApplicationRootsWithinHeldTransactionV1(p.tx, input, "apply", budget().control)).rejects.toThrow("CONTROL_PACKET_BYTES_CONFLICT");
    const b = budget(); expect(() => b.control.admit(["oversize"], "x".repeat(4097))).toThrow("STORED_ROW_LIMIT_EXCEEDED");
    b.control.admit(["one"], "x".repeat(4096));
    expect(() => b.control.admit(["two"], "x")).toThrow("INPUT_AGGREGATE_LIMIT_EXCEEDED");
  });
  it("refuses caller-forged or wrong-domain holders without SQL", async () => {
    const p = port(() => { throw new Error("UNEXPECTED_SQL"); });
    await expect(assertSavedResearchHolderWithinHeldTransactionV1(p.tx, { organizationId: org, ownershipDomain: "SAVED_RESEARCH_V1" } as SavedResearchHolderV1,
      budget().control)).rejects.toThrow("HOLDER_DOMAIN_CONFLICT");
    expect(p.queries).toHaveLength(0);
  });
  it("uses independent fixed two-int lock domains and does not claim a currently busy domain", async () => {
    const current = { ownershipDomain: "SAVED_RESEARCH_V1", organizationId: org, runtimeInstanceId: "existing-owner", leaseEpoch: 1,
      leaseContentDigest: h("busy"), validUntilUtc: "2026-09-28T00:02:00.000Z" };
    let domain = "SAVED_RESEARCH_V1";
    const p = port(q => q.sql.includes("clock_timestamp()") ? [{ now: "2026-09-28T00:00:00.000Z" }]
      : q.sql.includes("bounded_head") ? [{ packet: JSON.stringify({ ...current, ownershipDomain: domain }), bytes: Buffer.byteLength(JSON.stringify({ ...current, ownershipDomain: domain })) }] : []);
    expect(await claimSavedResearchWithinHeldTransactionV1(p.tx, { organizationId: org, runtimeInstanceId: "new", durationMs: 120000 }, budget().control)).toBeNull();
    domain = "RECORDED_ACQUISITION_V1";
    expect(await claimRecordedAcquisitionWithinHeldTransactionV1(p.tx, { organizationId: org, runtimeInstanceId: "new", durationMs: 120001 })).toBeNull();
    expect(p.queries.filter(q => q.sql.includes("pg_advisory_xact_lock")).map(q => q.params[0])).toEqual([1126001, 1121001]);
    expect(p.queries.some(q => /\b(insert|update|delete)\b/.test(q.sql.replace("for update", "")))).toBe(false);
    expect(p.queries.map(q => q.sql).join("\n")).not.toContain("hashtextextended");
  });
  it("submits a fixed twelve-statement successful held claim and seals the exact persisted body", async () => {
    let published: Record<string, unknown> | null = null, storedBody = "", storedDigest = "";
    const p = port(q => {
      if (q.sql.includes("clock_timestamp()")) return [{ now: "2026-09-28T00:00:00.000Z" }];
      if (q.sql.includes("bounded_head")) { const text = JSON.stringify(published); return published ? [{ packet: text, bytes: Buffer.byteLength(text) }] : []; }
      if (q.sql.includes('insert into "trader_saved_research_lease_history_v1"')) {
        storedBody = String(q.params[8]); storedDigest = String(q.params[3]); return [{ content_digest: storedDigest }];
      }
      if (q.sql.includes('insert into "trader_saved_research_lease_heads_v1"')) {
        published = { ownershipDomain: "SAVED_RESEARCH_V1", organizationId: q.params[0], runtimeInstanceId: q.params[1],
          leaseEpoch: q.params[2], leaseContentDigest: q.params[3], validUntilUtc: q.params[4] }; return [{ content_digest: q.params[3] }];
      }
      return [];
    });
    const b = budget();
    const holder = await claimSavedResearchWithinHeldTransactionV1(p.tx, { organizationId: org, runtimeInstanceId: "new-owner", durationMs: 120000 }, b.control);
    expect(holder?.leaseContentDigest).toBe(storedDigest); expect(h(storedBody)).toBe(storedDigest);
    expect(JSON.parse(storedBody)).toEqual({ schemaVersion: "waia.trader.noncapital_domain_lease.v1", ownershipDomain: "SAVED_RESEARCH_V1",
      organizationId: org, runtimeInstanceId: "new-owner", leaseEpoch: 1, expectedPreviousDigest: null,
      adjudicatedAtUtc: "2026-09-28T00:00:00.000Z", validUntilUtc: "2026-09-28T00:02:00.000Z", durationMs: 120000 });
    expect(p.queries).toHaveLength(12); expect(b.shared.total).toBe(b.control.total); expect(b.control.total).toBeGreaterThan(0);
    expect(p.queries[3]!.sql).toContain("for update"); expect(p.queries[4]!.sql).toContain("clock_timestamp()");
    expect(p.queries[7]!.sql).toContain("returning content_digest"); expect(p.queries[8]!.sql).toContain("returning content_digest");
    expect(p.queries.map(q => q.sql).join("\n")).not.toMatch(/on conflict|trader_runtime_control|\b(begin|commit|rollback)\b/i);
  });
  it("refuses invalid input and a refreshed maximum before submitting a claim", async () => {
    const p = port(() => { throw new Error("UNEXPECTED_SQL"); });
    for (const durationMs of [0, 120001, 1.5, Infinity]) await expect(claimSavedResearchWithinHeldTransactionV1(p.tx,
      { organizationId: org, runtimeInstanceId: "owner", durationMs }, budget().control)).rejects.toThrow("RUNTIME_CONTROL_LEASE_INVALID_DURATION");
    await expect(claimSavedResearchWithinHeldTransactionV1(p.tx, { organizationId: org, runtimeInstanceId: " owner", durationMs: 100 }, budget().control))
      .rejects.toThrow("RUNTIME_CONTROL_LEASE_INVALID_IDENTITY");
    expect(p.queries).toHaveLength(0);
  });
  it("contains only held fixed effects and no root connection, transaction, alternate authority, retry or selector factory", () => {
    const source = readFileSync("lib/trader/runtime-authority/v2/noncapital-domain-lease-postgres-v1.ts", "utf8");
    expect(source).not.toMatch(/\.transaction\(|\.begin\(|createPostgres|process\.env|fetch\(|setTimeout\(|while\s*\(/);
    expect(source).not.toMatch(/runtime-authority-assessment|canonical-pit|forecast|decision|execution|guardian/i);
    expect(source.match(/export (?:async )?function [^(]+/g)).toEqual([
      "export async function lockRecordedAcquisitionOrganizationV1", "export async function lockSavedResearchOrganizationV1",
      "export async function assertRecordedAcquisitionHolderWithinHeldTransactionV1", "export async function assertSavedResearchHolderWithinHeldTransactionV1",
      "export async function claimRecordedAcquisitionWithinHeldTransactionV1", "export async function claimSavedResearchWithinHeldTransactionV1",
      "export async function assertSavedApplicationRootsWithinHeldTransactionV1", "export async function assertSavedUnderstandingRootWithinHeldTransactionV1",
    ]);
  });
});
