// @vitest-environment node
import { describe, expect, it } from "vitest";
import { APPLICATION_COMPUTATION_SOURCE_MANIFEST_DIGEST } from "@/lib/trader/paper/research-application-v1/computation-manifest";
import { prepareCanonicalPitAttemptV1 } from "@/lib/trader/market-data/normalization/gateway-to-canonical-pit";
import { buildCanonicalGatewayPitReceiptV1 } from "@/lib/trader/mi/canonical-pit-repository-postgres";
import { researchCapturedFixture, researchPureFixture } from "../helpers/research-understanding-fixture";
import { evaluateSavedResearchUnderstanding } from "@/lib/trader/paper/research-understanding-v1/evaluate";
import { buildMarketUnderstandingBridge } from "@/lib/trader/intelligence/market-understanding-bridge-v0";
import { buildMsvUnderstandingBlock } from "@/lib/trader/intelligence/analytical-layers-v0";
import { normalizeMandatory } from "@/lib/trader/paper/durable-noncapital/normalize-mandatory-packet-v1";
import { seal, digest } from "@/lib/trader/paper/durable-noncapital/recorded-analysis-v1";
import { buildHypothesisDefinitionDigest, computeHypothesisKey, buildLifecycleContentDigest } from "@/lib/trader/mi/serialize-hypothesis";
import { buildMeasurementDigestFromDefinition, computeMeasurementKey } from "@/lib/trader/mi/serialize-measurement";
import type { MiHypothesis, MiHypothesisLifecycleEvent } from "@/lib/trader/mi/hypothesis.types";
import type { MiMeasurement } from "@/lib/trader/mi/measurement.types";
import { APPLICATION_SPECIFICATION, APPLICATION_BRIDGE, APPLICATION_QUESTION_MAP, APPLICATION_AUTHORITY, APPLICATION_PURPOSE,
  applicationDigest, captureApplicationConfigurationV1, type ResearchApplicationRelationV1 } from "@/lib/trader/paper/research-application-v1/contract";
import { CATEGORICAL_MEASUREMENT_NAME, categoricalMeasurementDefinitionV1, categoricalHypothesisNameV1, categoricalHypothesisDefinitionV1,
  assertCategoricalRegistrationV1, assessedSavedWhatV1, evaluateCategoricalApplicationMeaningV1, foldResearchApplicationRelationV1,
  selectResearchApplicationRelationV1 } from "@/lib/trader/paper/research-application-v1/specification";

function evaluation(kind: "trending" | "chopping" | "unclear" | "missing" = "trending", shift = 0) {
  const captured = researchCapturedFixture();
  if (kind === "chopping") captured.bars["4h"]!.forEach((b, i) => Object.assign(b, { open: String(200 - i * 3), high: String(202 - i * 3), low: String(198 - i * 3), close: String(199 - i * 3) }));
  if (kind === "unclear") captured.bars["4h"]!.forEach(b => Object.assign(b, { open: "100", close: "100", high: "102", low: "99" }));
  if (kind === "missing") { delete captured.bars["4h"]; captured.observations = captured.observations.filter(o => o.interval !== "4h"); }
  const f = researchPureFixture({ captured });
  if (shift) {
    const analysisPitAnchor = new Date(Date.parse(f.packet.analysisPitAnchor) + shift).toISOString();
    const { contentDigest: _digest, ...packet } = f.packet; void _digest;
    const normalized = normalizeMandatory(captured, f.session, analysisPitAnchor);
    // Pure synthetic source fixture: re-normalize/reseal the actual changed input, never change the computed answer.
    const sources = normalized.observations.map((o, index) => {
      const previous = packet.sources[index]!;
      const attempt = prepareCanonicalPitAttemptV1(o, { pitCutoffUtc: analysisPitAnchor });
      const observation: Record<string, unknown> | null = previous.observation && attempt.status === "AVAILABLE" ? { ...(previous.observation as Record<string, unknown>),
        normalizedInputDigest: attempt.normalizedInputDigest, payloadJson: JSON.stringify(attempt.payloadCanonical),
        contentDigest: digest({ fixtureObservation: index, attempt }) } : null;
      const receipt = buildCanonicalGatewayPitReceiptV1({ organizationId: f.session.organizationId, providerId: attempt.providerId,
        gatewayKind: attempt.gatewayKind, sourceId: previous.receipt.sourceId, trustAsOfReceiptId: previous.receipt.trustAsOfReceiptId,
        normalizedInputDigest: attempt.normalizedInputDigest, status: previous.receipt.status, reason: previous.receipt.reason,
        observationId: observation ? String(observation.id) : null, observationContentDigest: observation ? String(observation.contentDigest) : null });
      return { ...previous, observation, receipt };
    });
    f.packet = seal({ ...packet, analysisPitAnchor, normalized, sources });
  }
  return { f, out: evaluateSavedResearchUnderstanding(f.packet, f.assignment, f.profile, f.revisions) };
}
function registration() {
  const { f } = evaluation(); const createdAt = new Date("2026-01-01T00:00:00.000Z"); const organizationId = f.session.organizationId;
  const m0 = { organizationId, measurementKind: "feature_transform" as const, name: CATEGORICAL_MEASUREMENT_NAME };
  const measurementKey = computeMeasurementKey(m0), md = categoricalMeasurementDefinitionV1();
  const measurement: MiMeasurement = { ...m0, id: "m", measurementKey, schemaVersion: "mi-measurement-v1", definitionJson: JSON.stringify(md),
    definitionDigest: buildMeasurementDigestFromDefinition({ ...m0, measurementKey, definition: md }), versionSeq: 1, revisionOf: null, authoredBy: "fixture", createdAt };
  const config0 = { organizationId, accountId: f.session.accountId, symbol: f.session.symbol, researchAssignmentDigest: f.assignment.contentDigest,
    researchSessionId: f.assignment.researchSessionId, sourceSessionId: f.session.sessionId, sourceConfigDigest: f.session.configDigest,
    profileId: f.profile.id, profileContentDigest: f.profile.contentDigest, computation: f.assignment.declarations.computation,
    computationManifestDigest: f.assignment.declarations.computationManifestDigest, measurementId: measurement.id, measurementKey,
    measurementVersion: measurement.versionSeq, measurementDefinitionDigest: measurement.definitionDigest,
    applicationComputationManifestDigest: APPLICATION_COMPUTATION_SOURCE_MANIFEST_DIGEST,
    specification: APPLICATION_SPECIFICATION, bridge: APPLICATION_BRIDGE, questionMap: APPLICATION_QUESTION_MAP, maxAgeMs: 60_000 };
  const h0 = { organizationId, hypothesisKind: "market_claim" as const, name: categoricalHypothesisNameV1(f.session.symbol) };
  const hypothesisKey = computeHypothesisKey(h0);
  const definition = categoricalHypothesisDefinitionV1(config0, { ordinal: "low", band: "wide" }, ["always-flat-cash", "simple-trend-baseline", "buy-and-hold"]);
  const hypothesis: MiHypothesis = { ...h0, id: "h", hypothesisKey, schemaVersion: "mi-hypothesis-v1", definitionJson: JSON.stringify(definition),
    definitionDigest: buildHypothesisDefinitionDigest({ ...h0, hypothesisKey, definition }), supersedesJson: null, versionSeq: 1, revisionOf: null, authoredBy: "fixture", createdAt };
  const l0 = { organizationId, hypothesisId: "h", hypothesisKey, lifecycleState: "PROPOSED" as const, rationale: "explicit research fixture", recordedBy: "fixture", seq: 1 };
  const lifecycle: MiHypothesisLifecycleEvent = { ...l0, id: "life", createdAt, contentDigest: buildLifecycleContentDigest(l0) };
  const config = captureApplicationConfigurationV1({ ...config0, hypothesisId: hypothesis.id, hypothesisKey,
    hypothesisVersion: hypothesis.versionSeq, hypothesisDefinitionDigest: hypothesis.definitionDigest });
  return { config, read: { hypothesis, measurement, versions: [hypothesis], lifecycles: [lifecycle] }, definition };
}

describe("DEE1132 explicit categorical research specification", () => {
  it("matches an exact real-serializer registration without choosing priors or trimming null supersets", () => {
    const r = registration(); expect(assertCategoricalRegistrationV1(r.config, r.read, ["2026-09-26T12:00:02.000Z"])).toEqual(r.definition);
    expect(r.definition.prior).toEqual({ ordinal: "low", band: "wide" }); expect(r.definition.requiredNulls).toHaveLength(3);
  });
  it.each(["name", "claim", "selector", "hash", "tenant", "future", "version", "lifecycle", "null-floor", "prior"])("refuses incompatible %s", kind => {
    const r = registration();
    if (kind === "name") r.read.hypothesis.name = "Trend continuation";
    if (kind === "claim") { const d = JSON.parse(r.read.hypothesis.definitionJson); d.claimShape.isDirectional = true; r.read.hypothesis.definitionJson = JSON.stringify(d); }
    if (kind === "selector") { const d = JSON.parse(r.read.measurement.definitionJson); d.params.selector = "price"; r.read.measurement.definitionJson = JSON.stringify(d); }
    if (kind === "hash") r.read.hypothesis.definitionDigest = "e".repeat(64);
    if (kind === "tenant") r.read.measurement.organizationId = "other";
    if (kind === "future") r.read.hypothesis.createdAt = new Date("2030-01-01T00:00:00.000Z");
    if (kind === "version") r.read.versions.push({ ...r.read.hypothesis, id: "new", versionSeq: 2 });
    if (kind === "lifecycle") { const row = r.read.lifecycles[0]!; row.lifecycleState = "VALIDATED"; row.contentDigest = buildLifecycleContentDigest(row); }
    if (kind === "null-floor" || kind === "prior") { const d = JSON.parse(r.read.hypothesis.definitionJson); if (kind === "prior") d.prior = {}; else d.requiredNulls = ["always-flat-cash"]; r.read.hypothesis.definitionJson = JSON.stringify(d); }
    expect(() => assertCategoricalRegistrationV1(r.config, r.read, ["2026-09-26T12:00:02.000Z"])).toThrow();
  });
  it("captures explicit configuration and rejects actor/default/unknown fields", () => {
    const { config } = registration(); const captured = captureApplicationConfigurationV1(config); config.maxAgeMs = 0; expect(captured.maxAgeMs).toBe(60_000);
    expect(() => captureApplicationConfigurationV1({ ...config, actorId: "claimed" })).toThrow("APPLICATION_CONFIGURATION_INVALID");
    const { maxAgeMs: _age, ...missing } = config; void _age; expect(() => captureApplicationConfigurationV1(missing)).toThrow("APPLICATION_CONFIGURATION_INVALID");
  });
  it("derives FOR and AGAINST from actual complete computations and retains every old claim", () => {
    const p = evaluation(); const a = evaluation("trending", 1); const opposite = evaluation("chopping", 1);
    const before = JSON.stringify([p.out, a.out, opposite.out]);
    expect(evaluateCategoricalApplicationMeaningV1({ previous: p.out, current: a.out })).toMatchObject({ disposition: "OBSERVED_FOR", direction: "FOR" });
    expect(evaluateCategoricalApplicationMeaningV1({ previous: p.out, current: opposite.out })).toMatchObject({ disposition: "OBSERVED_AGAINST", direction: "AGAINST" });
    expect(JSON.stringify([p.out, a.out, opposite.out])).toBe(before); expect(a.out.artifact.claims).toHaveLength(12);
    const bridge = buildMarketUnderstandingBridge({ features: a.out.features, reconstruction: a.out.reconstruction, fusedContext: a.f.packet.normalized.fusedContext });
    expect(buildMsvUnderstandingBlock(bridge).regimeHint).toBe(assessedSavedWhatV1(a.out));
  });
  it.each(["missing", "unclear"] as const)("keeps %s unassessed without a NEUTRAL or false AGAINST fact", kind => {
    const p = evaluation(), a = evaluation(kind, 1);
    expect(evaluateCategoricalApplicationMeaningV1({ previous: p.out, current: a.out })).toMatchObject({ disposition: "UNASSESSED_INPUT", direction: null, relationKind: null });
  });
  it("does not infer AGAINST the claim from a non-TRENDING antecedent", () => {
    expect(evaluateCategoricalApplicationMeaningV1({ previous: evaluation("chopping").out, current: evaluation("trending", 1).out })).toMatchObject({ disposition: "UNASSESSED_ANTECEDENT", direction: null });
  });
  it("refuses changed evaluation seals, unknown categories and false support without unavailable masking", () => {
    const p = evaluation().out, a = evaluation("trending", 1).out;
    expect(() => evaluateCategoricalApplicationMeaningV1({ previous: p, current: { ...a, contentDigest: "e".repeat(64) } })).toThrow("APPLICATION_EVALUATION_INTEGRITY");
    for (const kind of ["category", "support"]) {
      const { contentDigest: _digest, ...body } = structuredClone(a); void _digest;
      if (kind === "category") body.questionEvaluations.find(q => q.questionId === "Q_WHAT_HAPPENING")!.answerSummary = "MOON";
      else body.disposition = "COMPLETED_UNRESOLVED";
      expect(() => evaluateCategoricalApplicationMeaningV1({ previous: p, current: seal(body) })).toThrow();
    }
  });
  it.each(["FOR", "AGAINST"] as const)("reuses judgment and selection for %s without verified/supported authority", direction => {
    const { config } = registration(); const consumer = evaluation("trending", 10).out;
    const relation: ResearchApplicationRelationV1 = { schemaVersion: "waia.trader.research_application_relation.v1", authority: APPLICATION_AUTHORITY, purpose: APPLICATION_PURPOSE,
      id: "relation", organizationId: config.organizationId, symbol: config.symbol, applicationId: "application", evidenceId: "evidence", hypothesisId: config.hypothesisId,
      hypothesisKey: config.hypothesisKey, hypothesisDefinitionDigest: config.hypothesisDefinitionDigest, assignmentDigest: applicationDigest(config), version: 1, contentDigest: "d".repeat(64),
      eventTime: "2026-09-26T12:00:02.001Z", recordedTime: "2026-09-26T12:00:02.002Z", verified: false, confidenceState: "NOT_ASSESSED",
      relationKind: direction === "FOR" ? "observed_categorical_persistence_for/v1" : "observed_categorical_persistence_against/v1" };
    const folded = foldResearchApplicationRelationV1(relation); expect(folded.researchJudgments[0]?.ordinalJudgment).toBe(direction === "FOR" ? "WEAKENED" : "CONTESTED");
    expect(folded).not.toHaveProperty("hypotheses"); expect(folded).not.toHaveProperty("knowledgeSemanticDigest");
    const input = { config, applicationId: "application", relation, availabilityTime: "2026-09-26T12:00:02.003Z", consumer };
    const selected = selectResearchApplicationRelationV1(input); expect(selected.selectedRelations).toEqual([{ relationId: "relation", version: 1, contentDigest: "d".repeat(64) }]);
    expect(selected).not.toHaveProperty("informationNeedPlanDigestHex");
    expect(() => selectResearchApplicationRelationV1({ ...input, availabilityTime: consumer.analysisPitAnchor })).toThrow("APPLICATION_NOT_YET_AVAILABLE");
    expect(() => foldResearchApplicationRelationV1({ ...relation, verified: true } as unknown as ResearchApplicationRelationV1)).toThrow("APPLICATION_RELATION_INVALID");
  });
  it("keeps the existing family lifecycle when a legitimate PROPOSED definition version is appended", () => {
    const r = registration(), old = r.read.hypothesis;
    const revised = { ...r.definition, prior: { ordinal: "explicit-revised", band: "wide" } };
    const next = { ...old, id: "h-v2", versionSeq: 2, revisionOf: old.id, createdAt: new Date("2026-01-02T00:00:00.000Z"),
      definitionJson: JSON.stringify(revised), definitionDigest: buildHypothesisDefinitionDigest({ ...old, definition: revised }) };
    r.read.hypothesis = next; r.read.versions.push(next);
    r.config.hypothesisId = next.id; r.config.hypothesisVersion = 2; r.config.hypothesisDefinitionDigest = next.definitionDigest;
    // The actual append writer retains the family lifecycle; it does not synthesize a second PROPOSED event.
    expect(assertCategoricalRegistrationV1(r.config, r.read, ["2026-09-26T12:00:02.000Z"])).toEqual(revised);
  });
  it("keeps future versions outside an earlier cutoff but refuses their later supersession", () => {
    const r = registration(); r.read.versions.push({ ...r.read.hypothesis, id: "future", versionSeq: 2, createdAt: new Date("2026-09-26T12:01:00.000Z") });
    expect(assertCategoricalRegistrationV1(r.config, r.read, ["2026-09-26T12:00:02.000Z"])).toEqual(r.definition);
    expect(() => assertCategoricalRegistrationV1(r.config, r.read, ["2026-09-26T12:01:00.000Z"])).toThrow("APPLICATION_VERSION_NOT_SELECTED");
  });
  it.each(["null", "bad-json", "row-bytes", "history33"])("refuses %s at the bounded selected registry boundary", kind => {
    const r = registration();
    if (kind === "null") r.read.hypothesis.definitionJson = "null";
    if (kind === "bad-json") r.read.hypothesis.definitionJson = "{";
    if (kind === "row-bytes") r.read.hypothesis.definitionJson = "x".repeat(65_536);
    if (kind === "history33") r.read.versions = Array.from({ length: 33 }, (_, i) => ({ ...r.read.hypothesis, id: `h${i}`, versionSeq: i + 1 }));
    expect(() => assertCategoricalRegistrationV1(r.config, r.read, ["2026-09-26T12:00:02.000Z"])).toThrow();
  });

});
