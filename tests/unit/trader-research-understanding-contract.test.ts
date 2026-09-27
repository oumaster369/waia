// @vitest-environment node
import { describe, expect, it } from "vitest";
import { captureAssignmentConfig, captureProfileDefinition, assertResearchProfile, rangeSchema, parseStrict,
  LIMITS } from "@/lib/trader/paper/research-understanding-v1/contract";

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
