// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureAssignmentConfig, captureProfileDefinition, assertResearchProfile, rangeSchema, parseStrict,
  LIMITS } from "@/lib/trader/paper/research-understanding-v1/contract";
import * as postgresAdapter from "drizzle-orm/postgres-js";
import * as sourceReader from "@/lib/trader/paper/research-understanding-v1/bounded-source-postgres";
import * as lease from "@/lib/trader/runtime-authority/v2/runtime-control-lease-database-clock-postgres-v2";
import * as evaluator from "@/lib/trader/paper/research-understanding-v1/evaluate";
import { createSavedResearchOwner } from "@/lib/trader/paper/research-understanding-v1/repository-postgres";
import { runSavedResearchLoop } from "@/lib/trader/paper/research-understanding-v1/run-saved-research-loop";
import { researchPureFixture } from "../helpers/research-understanding-fixture";
import { seal } from "@/lib/trader/paper/durable-noncapital/recorded-analysis-v1";
import * as recorded from "@/lib/trader/paper/durable-noncapital/recorded-analysis-v1";
import * as informationStore from "@/lib/trader/intelligence/information-sufficiency/information-sufficiency-repository-postgres";
import { decodeBody } from "@/lib/trader/paper/durable-noncapital/recorded-source-read-validation-v1";
import type postgres from "postgres";
vi.mock("drizzle-orm/postgres-js", async importOriginal => ({ ...await importOriginal<typeof postgresAdapter>(), drizzle: vi.fn() }));

const org = "11111111-1111-4111-8111-111111111111";
function config() { return { organizationId: org, accountId: "saved-account", symbol: "BTC/USDT", researchSessionId: "research",
  sourceSessionId: "source", sourceConfigDigest: "a".repeat(64), firstSourceSequence: 0, releaseSha: "a".repeat(40),
  admissions: ["1m", "4h"].map(lane => ({ lane, sourceId: "source", revisionDigests: ["b".repeat(64)] })) }; }
function profile() { return { organizationId: org, accountId: "saved-account", symbol: "BTC/USDT", profileVersion: "research-recorded-what/v1/explicit-research",
  purpose: "RESEARCH_NON_CAPITAL", venue: "htx", analyticalTimeframe: "1m", horizon: "explicit-horizon", forecastPackageId: null,
  forecastPackageContentDigest: null, inputContractContentDigest: null, aggregateQualityContract: null,
  requirements: ["1m", "4h"].map(lane => ({ id: `research_what_price_${lane}_v1`, questionId: "Q_WHAT_HAPPENING", classification: "MANDATORY",
    contextTriggerKey: null, satisfiers: [{ evidenceFamily: `research_recorded_price_${lane}_v1`, providerIds: ["htx_spot"], substitutionRuleId: null }],
    allowedObservationKinds: ["ohlcv_bar"], allowedObservationSchemaVersions: ["mi-canonical-pit-observation-v1"], allowedMeasurementDefinitionDigests: [],
    maxStalenessMs: null, minimumTrustScore: null, minimumIndependentGroups: 1, contradictionPolicy: "FAIL_UNRESOLVED",
    requirePitQualified: true, requireReplayEligible: true, inquiryBounds: { maxDepth: 0, maxDurationMs: 0, maxProviderFanout: 0 } })) }; }

describe("saved research explicit bounded configuration", () => {
  it("retains explicit null floors and exact existing profile identity", () => {
    const p = captureProfileDefinition(profile()); expect(() => assertResearchProfile(p)).not.toThrow();
    expect(p.requirements.map(r => r.minimumTrustScore)).toEqual([null, null]); expect(p.authority).toBe("EPISTEMIC_PREREQUISITE_ONLY");
    expect(captureAssignmentConfig(config())).toEqual(config());
  });
  it.each(["actor", "userId", "trust", "result", "evaluator", "unknown"])("refuses request-owned %s rather than ignoring it", key => {
    expect(() => captureAssignmentConfig({ ...config(), [key]: "supplied" })).toThrow("INVALID_ASSIGNMENT_CONFIG");
  });
  it.each(["purpose", "namespace", "floor", "substitution", "one-lane", "independence", "contradiction", "inquiry", "kind", "horizon", "extra"])("refuses unsupported profile %s", kind => {
    const p = profile();
    if (kind === "purpose") p.purpose = "NEW_OPPORTUNITY";
    if (kind === "namespace") p.profileVersion = "research-recorded-what/v1/UPPER";
    if (kind === "floor") delete (p.requirements[0] as Partial<typeof p.requirements[number]>).minimumTrustScore;
    if (kind === "substitution") Object.assign(p.requirements[0]!.satisfiers[0]!, { substitutionRuleId: "fallback" });
    if (kind === "one-lane") p.requirements.pop();
    if (kind === "independence") p.requirements[0]!.minimumIndependentGroups = 2;
    if (kind === "contradiction") p.requirements[0]!.contradictionPolicy = "RECORD_ONLY";
    if (kind === "inquiry") p.requirements[0]!.inquiryBounds.maxProviderFanout = 1;
    if (kind === "kind") p.requirements[0]!.allowedObservationKinds = ["quote_l1"];
    if (kind === "horizon") p.horizon = "";
    if (kind === "extra") Object.assign(p, { trust: "TRUSTED" });
    expect(() => captureProfileDefinition(p)).toThrow();
  });
  it("requires literal two lane identities and unique finite revision admission sets", () => {
    const c = config(); c.admissions[1]!.lane = "1m"; expect(() => captureAssignmentConfig(c)).toThrow();
    const duplicate = config(); duplicate.admissions[0]!.revisionDigests.push("b".repeat(64)); expect(() => captureAssignmentConfig(duplicate)).toThrow();
    const maximum = config(); maximum.admissions[0]!.revisionDigests = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(64, "0"));
    expect(captureAssignmentConfig(maximum).admissions[0]!.revisionDigests).toHaveLength(32);
    maximum.admissions[0]!.revisionDigests.push("f".repeat(64)); expect(() => captureAssignmentConfig(maximum)).toThrow();
  });
  it.each([0, 33, 1.5, Infinity])("refuses range count %s", count => {
    expect(() => parseStrict(rangeSchema, { startSequence: 0, count, leaseDurationMs: 1 }, "RANGE")).toThrow("RANGE");
  });
  it("accepts safe maximum and refuses arithmetic overflow and inherited generic lease maximum", () => {
    expect(parseStrict(rangeSchema, { startSequence: Number.MAX_SAFE_INTEGER - 31, count: 32, leaseDurationMs: 120_000 }, "RANGE").count).toBe(32);
    for (const input of [{ startSequence: Number.MAX_SAFE_INTEGER, count: 2, leaseDurationMs: 1 }, { startSequence: 0, count: 1, leaseDurationMs: 120_001 }])
      expect(() => parseStrict(rangeSchema, input, "RANGE")).toThrow("RANGE");
    expect(LIMITS.replayAggregate).toBe(LIMITS.completion + LIMITS.informationReceipt + LIMITS.predecessor);
  });
});

describe("owned monotonic completion deadline", () => {
  afterEach(() => { vi.restoreAllMocks(); });
  // Actual owner/loop/configuration and fixed computation, with inert accepted-row
  // and transaction ports. This checks late acceptance, not query/CPU cancellation.
  function setup(mode: "replay" | "snapshot" | "concurrent" | "committed", elapsed: number,
    at: "read" | "compute" | "digest" | "ack" | "handoff" = "read") {
    let now = 0; let transaction = 0;
    const f = researchPureFixture(); const actualEvaluate = evaluator.evaluateSavedResearchUnderstanding;
    const output = actualEvaluate(f.packet, f.assignment, f.profile, f.revisions);
    const completion = seal({ schemaVersion: f.assignment.schemaVersion, organizationId: f.session.organizationId,
      researchSessionId: f.config.researchSessionId, sequence: 0, sourceSessionId: f.session.sessionId, sourceSequence: 0,
      assignmentDigest: f.assignment.contentDigest, packetDigest: f.packet.contentDigest, previousCompletionDigest: null, output });
    let written: typeof completion | null = null;
    const execute = vi.fn(async () => []); const insert = vi.fn(() => ({ values: async (value: { bodyJson: string; contentDigest: string }) => {
      if (mode !== "committed") throw new Error("UNEXPECTED_WRITE"); written = decodeBody<typeof completion>(value);
    } }));
    const db = { execute, insert, transaction: async (fn: (tx: unknown) => unknown) => {
      const index = ++transaction; const result = await fn(db);
      if (at === "ack" && index === 3) now = elapsed; return result;
    } };
    vi.spyOn(postgresAdapter, "drizzle").mockReturnValue(db as unknown as ReturnType<typeof postgresAdapter.drizzle>);
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.spyOn(lease, "lockRuntimeOrganizationV2").mockResolvedValue(undefined);
    vi.spyOn(lease, "assertRuntimeDatabaseClockHolderV2").mockResolvedValue(f.assignment.assignedAt);
    vi.spyOn(lease, "claimBoundedResearchRuntimeControlLeaseV2").mockRejectedValue(new Error("UNEXPECTED_CLAIM"));
    vi.spyOn(sourceReader, "readBoundedResearchAssignment").mockResolvedValue(f.assignment);
    vi.spyOn(sourceReader, "readBoundedResearchProfile").mockResolvedValue(f.profile);
    vi.spyOn(sourceReader, "readBoundedResearchPredecessor").mockResolvedValue(null);
    vi.spyOn(sourceReader, "admitOptionalStoredReceipt").mockResolvedValue(null);
    vi.spyOn(informationStore, "persistInformationSufficiencyReceiptWithinTransactionV2Postgres").mockResolvedValue({ receipt: output.receipt, insertedNew: true });
    vi.spyOn(informationStore, "requireInformationSufficiencyAuthorityWithinTransactionV2Postgres").mockResolvedValue(undefined);
    const readCompletion = vi.spyOn(sourceReader, "readBoundedResearchCompletion").mockImplementation(async () => {
      if (mode === "committed") return written;
      if (mode === "concurrent" && transaction === 2) return null;
      if (mode === "concurrent" && transaction === 3 && at === "read") now = elapsed;
      return completion;
    });
    vi.spyOn(sourceReader, "readBoundedResearchInputs").mockImplementation(async () => {
      if (mode !== "concurrent" && at === "read") now = elapsed;
      return { session: f.session, packet: f.packet, companion: {}, revisions: f.revisions, sourceInputBytes: 0 };
    });
    vi.spyOn(evaluator, "evaluateSavedResearchUnderstanding").mockImplementation((...args) => {
      const result = actualEvaluate(...args); if (at === "compute") now = elapsed;
      if (at === "handoff") queueMicrotask(() => { now = elapsed; }); return result;
    });
    const actualDigest = recorded.digest;
    vi.spyOn(recorded, "digest").mockImplementation(value => {
      const result = actualDigest(value); if (at === "digest" && transaction === 3 && value === completion) now = elapsed;
      return result;
    });
    const pool = { begin() { throw new Error("UNEXPECTED_POOL_USE"); } } as unknown as postgres.Sql;
    const context = { organizationId: f.session.organizationId };
    const request = { assignment: f.config, profile: { definition: f.profileDefinition }, range: { startSequence: 0, count: 1, leaseDurationMs: 1000 } };
    const owner = createSavedResearchOwner(pool, context, request);
    const holder = { organizationId: f.session.organizationId, runtimeInstanceId: "inert-owner", leaseEpoch: 1, leaseContentDigest: "a".repeat(64) };
    return { owner, pool, context, request, holder, insert, readCompletion, completion, setNow(value: number) { now = value; } };
  }
  for (const mode of ["replay", "snapshot", "concurrent"] as const) it.each([119999, 120001])(`${mode} existing completion obeys post-await budget %sms`, async elapsed => {
    const f = setup(mode, elapsed);
    const pending = mode === "replay" ? f.owner.replay(0) : f.owner.complete(0, f.holder);
    if (elapsed > LIMITS.durationMs) await expect(pending).rejects.toThrow("INVOCATION_DEADLINE_EXCEEDED");
    else expect((await pending)!.outcome).toBe("REPLAYED");
    expect(f.insert).not.toHaveBeenCalled();
  });
  it.each(["read", "compute"] as const)("actual loop refuses a replay completed after late %s", async at => {
    const f = setup("replay", 120001, at);
    const result = await runSavedResearchLoop(f.pool, f.context, f.request);
    expect(result.status).toBe("INVOCATION_DEADLINE_EXCEEDED"); expect(result.completed).toEqual([]); expect(f.insert).not.toHaveBeenCalled();
  });
  it("retains expired-entry refusal and conflicting-output refusal", async () => {
    const f = setup("replay", 0); f.setNow(120001);
    await expect(f.owner.replay(0)).rejects.toThrow("INVOCATION_DEADLINE_EXCEEDED"); f.setNow(0);
    f.readCompletion.mockResolvedValue({ ...f.completion, output: { ...f.completion.output, disposition: "COMPLETED_UNRESOLVED" } });
    await expect(f.owner.replay(0)).rejects.toThrow("REPLAY_OUTPUT_CONFLICT"); expect(f.insert).not.toHaveBeenCalled();
  });
  for (const at of ["digest", "ack"] as const) it.each([119999, 120001])(`concurrent ${at} completion has a final result deadline at %sms`, async elapsed => {
    const f = setup("concurrent", elapsed, at); const pending = f.owner.complete(0, f.holder);
    if (elapsed > LIMITS.durationMs) await expect(pending).rejects.toThrow("INVOCATION_DEADLINE_EXCEEDED");
    else expect((await pending).outcome).toBe("REPLAYED");
    expect(f.insert).not.toHaveBeenCalled();
  });
  it.each(["replay", "snapshot"] as const)("%s public handoff also refuses elapsed result admission", async mode => {
    const f = setup(mode, 120001, "handoff");
    await expect(mode === "replay" ? f.owner.replay(0) : f.owner.complete(0, f.holder)).rejects.toThrow("INVOCATION_DEADLINE_EXCEEDED");
    expect(f.insert).not.toHaveBeenCalled();
  });
  it("late write acknowledgement refuses the result without pretending rollback; a fresh invocation replays once", async () => {
    const f = setup("committed", 120001, "ack");
    await expect(f.owner.complete(0, f.holder)).rejects.toThrow("INVOCATION_DEADLINE_EXCEEDED");
    expect(f.insert).toHaveBeenCalledOnce();
    expect((await createSavedResearchOwner(f.pool, f.context, f.request).replay(0))!.outcome).toBe("REPLAYED");
    expect(f.insert).toHaveBeenCalledOnce();
  });
});
