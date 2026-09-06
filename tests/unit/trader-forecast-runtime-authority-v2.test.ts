import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createHistoricalForecastNonActionableEvidenceV3,
  verifyHistoricalForecastNonActionableEvidenceV3,
} from "@/lib/trader/historical-simulation-v2/non-actionable-forecast-source-v3";
import {
  createHistoricalForecastNonActionableSourceV2,
  createHistoricalForecastNonActionableVerificationV2,
} from "@/lib/trader/historical-simulation-v2/non-actionable-forecast-source-v2";
import {
  cloneBoundedForecastWireJsonV1,
  encodeForecastRuntimeInputWireV1,
  encodeForecastAuthorizedOutcomeWireV1,
  hydrateForecastRuntimeInputWireV1,
  hydrateForecastAuthorizedOutcomeWireV1,
  forecastPackageWireVersionV1,
  assertForecastSourceWireVersionV1,
  FORECAST_SOURCE_VERIFIER_BOUNDED_V3,
  FORECAST_SOURCE_VERIFIER_LEGACY_V2,
  reviveLegacyForecastPackageJsonV1,
} from "@/lib/trader/intelligence/forecast-v2/forecast-package-wire-v1";
import {
  encodePredictivePackageV1, hydratePredictivePackageAsyncV1,
} from "@/lib/trader/intelligence/forecast-v2/predictive-package-codec-v1";
const transport = vi.hoisted(() => ({ hydrate: vi.fn() }));
vi.mock("@/lib/trader/intelligence/forecast-v2/predictive-package-storage-postgres-v1", () => ({
  hydratePredictivePackageStorageV1: transport.hydrate,
}));

import { MODEL_TRANSFORM_VERSION } from "@/lib/trader/intelligence/forecast-v2/constants";
import { buildForecastContractBindingV1 } from "@/lib/trader/intelligence/forecast-v2/forecast-contract-binding-service-v1";
import {
  buildForecastInputContractV2,
  buildForecastModelArtifactV2,
  buildForecastModelSpecV2,
} from "@/lib/trader/intelligence/forecast-v2/forecast-contract-foundation-v2";
import {
  issueForecastRuntimeV2,
  requireForecastRuntimeAuthorizedOutcomeV2,
  requireForecastRuntimeAuthorityV2,
  type ForecastRuntimeInputV2,
} from "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";
import { digestHex } from "@/lib/trader/intelligence/forecast-v2/identity-digests";
import {
  buildPredictivePackageV1,
  type SourceAnchor,
} from "@/lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { buildMarketStateSnapshotV2 } from "@/lib/trader/intelligence/predictive-admission";
import type { PredictiveAdmissionReceiptV1 } from "@/lib/trader/intelligence/predictive-admission";
import {
  FORECAST_V2_LOG_LOSS_FLOOR,
  scoreForecastV2MulticlassObservation,
} from "@/lib/trader/intelligence/calibration/calibration-scorer";

const hex = (char: string) => char.repeat(64);
const organizationId = "11111111-1111-4111-8111-111111111111";
const pitAnchor = "2023-11-14T22:13:20.000Z";

function anchor(index: number): SourceAnchor {
  return {
    venue: "htx",
    market: "spot",
    symbol: "BTCUSDT",
    closedBarEpochMs: 1_690_000_000_000 + index * 60_000,
    barContentDigest: createHash("sha256").update(String(index)).digest("hex"),
    realizedVol20m_1m: 0.01 + (index % 12) * 0.0015,
    outcome13d: Array.from({ length: 13 }, (_, coordinate) =>
      (index % 7) * 0.0004 + coordinate * 0.00001,
    ),
  };
}

function fixture(): ForecastRuntimeInputV2 {
  const family = {
    organizationId,
    venue: "htx",
    market: "spot",
    symbol: "BTCUSDT",
    primaryHorizonMinutes: 30,
    executionHorizonMinutes: 33,
    packageSubjectVersion: "pkg-subject/v1",
    terminalTargetDefinitionDigestHex: hex("a"),
    executionOpportunityTargetDefinitionDigestHex: hex("b"),
    modelTransformVersion: MODEL_TRANSFORM_VERSION,
    developmentDatasetDigestHex: hex("c"),
    featureVersion: "realized-volatility-20m-from-1m/v2",
    normalizationVersionDigestHex: hex("d"),
    codeReleaseSha: "e".repeat(40),
  };
  const predictivePackage = buildPredictivePackageV1({
    family,
    sourceCorpus: Array.from({ length: 180 }, (_, index) => anchor(index)),
    kConfigDec: 3,
    mConfigDec: 4,
    runtimeContract: { osClass: "linux", arch: "x64", nodeVersionExact: "v22.0.0" },
  });
  const inputContract = buildForecastInputContractV2({
    measurementSemanticVersion: family.featureVersion,
    hypothesisAssessmentSchemaVersion: "waia.trader.hypothesis_assessment.v1",
  });
  const modelSpec = buildForecastModelSpecV2({
    modelId: "rv-state-conditional-empirical-joint/v1",
    modelTransformVersion: family.modelTransformVersion,
    inputContractDigestHex: inputContract.contentDigestHex,
    terminalTargetDefinitionDigestHex: family.terminalTargetDefinitionDigestHex,
    executionOpportunityTargetDefinitionDigestHex:
      family.executionOpportunityTargetDefinitionDigestHex,
  });
  const modelArtifact = buildForecastModelArtifactV2({
    modelSpecDigestHex: modelSpec.contentDigestHex,
    inputContractDigestHex: inputContract.contentDigestHex,
    developmentDatasetDigestHex: family.developmentDatasetDigestHex,
    runtimeContractDigestHex: digestHex(predictivePackage.runtimeContractDigest),
    artifactPayloadDigestHex: hex("f"),
  });
  const forecastContractBinding = buildForecastContractBindingV1({
    organizationId,
    scientificAdmissionReceiptId: "22222222-2222-4222-8222-222222222222",
    scientificAdmissionReceiptContentDigestHex: hex("1"),
    selectedPredictivePackageContentDigestHex: digestHex(
      predictivePackage.predictivePackageContentDigest,
    ),
    inputContract,
    modelSpec,
    modelArtifact,
  });
  const marketStateSnapshot = buildMarketStateSnapshotV2({
    organizationId,
    accountId: null,
    instrumentId: "BTC/USDT",
    symbol: "BTCUSDT",
    venue: "htx",
    analysisPurpose: "NEW_OPPORTUNITY",
    analyticalTimeframe: "1m",
    horizon: "30m",
    pitAnchor,
    runtimeContextDigestHex: hex("2"),
    runtimePosture: "FULL_ANALYSIS_AND_NEW_RISK",
    requiredInformationProfileDigestHex: hex("3"),
    informationSufficiencyReceiptDigestHex: hex("4"),
    reconstructionDigestHex: hex("5"),
    stateRepresentationSpecDigestHex: hex("6"),
    dynamicStateDescriptorDigestHex: hex("7"),
    understandingClaimSetDigestHex: hex("8"),
    activeKnowledgeStateDigestHex: hex("9"),
    selectedKnowledgeClaimDigestsHex: [hex("a")],
    selectedFailureBoundaryDigestsHex: [hex("b")],
    hypothesisAssessmentSetDigestHex: hex("c"),
    consumedHypothesisAssessments: [
      {
        hypothesisAssessmentContentDigestHex: hex("d"),
        evaluatorIdentityDigestHex: hex("e"),
        status: "APPLICABLE",
      },
    ],
    sourceProfileDigestHex: hex("f"),
    representationProfileDigestHex: hex("1"),
    anchorRealizedVol20m_1m: 0.018,
    forecastContractBinding,
  });
  const receiptBody = {
    schemaVersion: "waia.trader.predictive_admission_receipt.v1" as const,
    verdict: "ADMITTED" as const,
    capitalAuthority: "NONE" as const,
    analysisPurpose: "NEW_OPPORTUNITY" as const,
    pitAnchor,
    marketStateSnapshotContentDigestHex: marketStateSnapshot.contentDigestHex,
    selectedPredictivePackageContentDigestHex:
      forecastContractBinding.selectedPredictivePackageContentDigestHex,
    scientificAdmissionReceiptContentDigestHex:
      forecastContractBinding.scientificAdmissionReceiptContentDigestHex,
    inputContractDigestHex: inputContract.contentDigestHex,
    modelSpecDigestHex: modelSpec.contentDigestHex,
    modelArtifactDigestHex: modelArtifact.contentDigestHex,
    qualifiedInputBindingDigestHex: marketStateSnapshot.qualifiedInputBindingDigestHex,
    blockingReasons: [] as const,
  };
  const predictiveAdmissionReceipt: PredictiveAdmissionReceiptV1 = {
    ...receiptBody,
    contentDigestHex: computeSemanticSha256Hex(receiptBody),
  };
  return {
    predictiveAdmissionReceipt,
    marketStateSnapshot,
    forecastContractBinding,
    predictivePackage,
    executionHorizonMinutes: 33,
    normalizationVersionDigestHex: family.normalizationVersionDigestHex,
    knowledgeEdgeId: "00000000-0000-4000-8000-000000063200",
    knowledgeContentDigestHex: hex("6"),
  };
}

describe("DEE-946 bounded input AND authorized-outcome wire", () => {
  it("structurally revives legacy jsonb with exact prior JSON/Buffer semantics", () => {
    const value = { b: Buffer.from([1, 255]), wire: { type: "Buffer", data: [0, 127] },
      zero: -0, nan: NaN, absent: undefined, nested: [undefined, -0, Infinity, Array(2)],
      proto: JSON.parse('{"__proto__":{"x":1}}') };
    const old = JSON.parse(JSON.stringify(value), (_key, candidate) =>
      candidate && candidate.type === "Buffer" && Array.isArray(candidate.data)
        ? Buffer.from(candidate.data) : candidate);
    expect(reviveLegacyForecastPackageJsonV1(value)).toStrictEqual(old);
    const x: unknown[] = []; x.push(x);
    expect(() => reviveLegacyForecastPackageJsonV1(x)).toThrow("LEGACY_CYCLE");
    expect(() => reviveLegacyForecastPackageJsonV1({ execute: () => 1 })).toThrow("LEGACY_NON_JSON_VALUE");
  });
  it("binds the verifier version to both wires and refuses downgrade/mixing", () => {
    const ref = { schemaVersion: "waia.trader.forecast_package_reference.v1" };
    expect(() => assertForecastSourceWireVersionV1(FORECAST_SOURCE_VERIFIER_BOUNDED_V3, ref, ref)).not.toThrow();
    expect(() => assertForecastSourceWireVersionV1(FORECAST_SOURCE_VERIFIER_LEGACY_V2, {}, {})).not.toThrow();
    for (const [version, a, b] of [
      [FORECAST_SOURCE_VERIFIER_LEGACY_V2, ref, ref],
      [FORECAST_SOURCE_VERIFIER_BOUNDED_V3, {}, {}],
      [FORECAST_SOURCE_VERIFIER_BOUNDED_V3, ref, {}],
      ["unknown", ref, ref],
    ] as const) expect(() => assertForecastSourceWireVersionV1(version, a, b)).toThrow("SOURCE_VERIFIER_WIRE_VERSION");
  });
  function wireFixture() {
    const input = fixture();
    const outcome = issueForecastRuntimeV2(input);
    if (outcome.status !== "FORECAST_AUTHORIZED") throw new Error("fixture not authorized");
    const encoded = encodePredictivePackageV1(input.predictivePackage!);
    const reference = {
      packageId: "00000000-0000-4000-8000-000000000946",
      organizationId,
      codecVersion: encoded.manifest.version,
      generationDigestHex: encoded.manifest.generationDigestHex,
      contentDigestHex: encoded.manifest.contentDigestHex,
      manifestDigestHex: encoded.manifest.manifestDigestHex,
    };
    transport.hydrate.mockReset().mockImplementation(async (_sql, trusted) => {
      async function* chunks() { yield* encoded.chunks; }
      return hydratePredictivePackageAsyncV1(encoded.manifest, chunks(), trusted);
    });
    return { input, outcome, reference, scope: { organizationId, packageId: reference.packageId } };
  }

  function abstentionFixture() {
    const base = wireFixture();
    const { contentDigestHex: _prior, ...prior } = base.input.predictiveAdmissionReceipt!;
    void _prior;
    const body = { ...prior, verdict: "NOT_ADMITTED" as const,
      blockingReasons: ["HYPOTHESIS_NOT_APPLICABLE"] as const };
    const input = { ...base.input,
      predictiveAdmissionReceipt: { ...body, contentDigestHex: computeSemanticSha256Hex(body) } };
    const outcome = issueForecastRuntimeV2(input);
    if (outcome.status !== "NON_ACTIONABLE") throw new Error("expected real abstention");
    const scope = { organizationId, accountId: "account", runId: "run", cycleId: "cycle",
      symbol: "BTCUSDT" as const, pitAnchor, datasetMembershipContentDigestHex: hex("a") };
    const releaseSha = "a".repeat(40);
    return { input, outcome, scope, releaseSha, reference: base.reference,
      evidence: createHistoricalForecastNonActionableEvidenceV3({
        ...scope, runtimeInput: input, outcome, reference: base.reference, releaseSha }) };
  }

  it("keeps a real NON_ACTIONABLE package bounded and replays after hydration", async () => {
    const { input, outcome, scope, releaseSha, evidence } = abstentionFixture();
    const durable = JSON.parse(JSON.stringify(evidence));
    expect(JSON.stringify(durable)).not.toMatch(/canonicalSourceCorpus|replicaArtifacts/);
    expect(Buffer.byteLength(JSON.stringify(durable))).toBeLessThan(50 * 1024);
    const restored = await verifyHistoricalForecastNonActionableEvidenceV3(
      {} as never, durable.source, durable.verification, scope, releaseSha);
    expect(restored).toStrictEqual(input);
    expect(issueForecastRuntimeV2(restored)).toStrictEqual(outcome);
    expect(transport.hydrate).toHaveBeenCalledTimes(1);
  });

  it.each(["scope", "wire", "verification", "release", "downgrade"] as const)(
    "refuses NON_ACTIONABLE %s tampering before hydration", async (kind) => {
      const { scope, releaseSha, evidence } = abstentionFixture();
      const durable = JSON.parse(JSON.stringify(evidence));
      if (kind === "scope") durable.source.organizationId = "22222222-2222-4222-8222-222222222222";
      if (kind === "wire") durable.source.runtimeInput.predictivePackage.reference.manifestDigestHex = hex("b");
      if (kind === "verification") durable.verification.verifierVersion = "historical-forecast-non-actionable-verifier/1";
      if (kind === "downgrade") durable.source.schemaVersion = "waia.trader.historical_forecast_non_actionable_source.v2";
      await expect(verifyHistoricalForecastNonActionableEvidenceV3({} as never,
        durable.source, durable.verification, scope, kind === "release" ? "b".repeat(40) : releaseSha,
      )).rejects.toThrow();
      expect(transport.hydrate).not.toHaveBeenCalled();
    });

  it("refuses an internally resealed wrong package manifest instead of accepting negative evidence", async () => {
    const { input, outcome, scope, releaseSha, reference } = abstentionFixture();
    const evidence = createHistoricalForecastNonActionableEvidenceV3({ ...scope,
      runtimeInput: input, outcome, releaseSha,
      reference: { ...reference, manifestDigestHex: hex("b") } });
    await expect(verifyHistoricalForecastNonActionableEvidenceV3({} as never,
      evidence.source, evidence.verification, scope, releaseSha)).rejects.toThrow();
    expect(transport.hydrate).toHaveBeenCalledTimes(1);
  });

  it("preserves strict legacy abstention verification without pretending it is V3", async () => {
    const { input, outcome, scope, releaseSha } = abstentionFixture();
    const source = createHistoricalForecastNonActionableSourceV2({ ...scope,
      runtimeInput: input, outcome });
    const verification = createHistoricalForecastNonActionableVerificationV2({ source, releaseSha });
    const restored = await verifyHistoricalForecastNonActionableEvidenceV3({} as never,
      source, verification, scope, releaseSha);
    expect(issueForecastRuntimeV2(restored)).toStrictEqual(outcome);
    expect(transport.hydrate).not.toHaveBeenCalled();
  });

  it("rejects missing expected scope before reading the NON_ACTIONABLE package", async () => {
    const { releaseSha, evidence } = abstentionFixture();
    await expect(verifyHistoricalForecastNonActionableEvidenceV3({} as never,
      evidence.source, evidence.verification, {} as never, releaseSha)).rejects.toThrow("SOURCE_IDENTITY");
    expect(transport.hydrate).not.toHaveBeenCalled();
  });

  it("refuses sealing a BTC abstention as an ETH source", () => {
    const { input, outcome, scope, releaseSha, reference } = abstentionFixture();
    expect(() => createHistoricalForecastNonActionableEvidenceV3({ ...scope,
      symbol: "ETHUSDT", runtimeInput: input, outcome, releaseSha, reference,
    })).toThrow("SOURCE_IDENTITY");
  });

  it("owns NON_ACTIONABLE wire metadata across asynchronous package hydration", async () => {
    const { scope, releaseSha, evidence, outcome } = abstentionFixture();
    const durable = JSON.parse(JSON.stringify(evidence));
    const hydrate = transport.hydrate.getMockImplementation()!;
    transport.hydrate.mockImplementationOnce(async (...args) => {
      durable.source.runtimeInput.predictiveAdmissionReceipt.blockingReasons = ["TAMPERED"];
      durable.source.outcome.upstreamReasonCodes = ["TAMPERED"];
      return hydrate(...args);
    });
    const restored = await verifyHistoricalForecastNonActionableEvidenceV3({} as never,
      durable.source, durable.verification, scope, releaseSha);
    expect(issueForecastRuntimeV2(restored)).toStrictEqual(outcome);
  });

  it("does not reinterpret another refusal as a permitted market abstention", () => {
    const { input, scope, releaseSha, reference } = abstentionFixture();
    const refusedInput = { ...input, predictiveAdmissionReceipt: null };
    const outcome = issueForecastRuntimeV2(refusedInput);
    if (outcome.status !== "NON_ACTIONABLE") throw new Error("expected refusal");
    expect(() => createHistoricalForecastNonActionableEvidenceV3({ ...scope,
      runtimeInput: refusedInput, outcome, reference, releaseSha,
    })).toThrow("NOT_A_PERMITTED_MARKET_ABSTENTION");
  });

  it("round-trips both surfaces and reproduces the actual Forecast authority", async () => {
    const { input, outcome, reference, scope } = wireFixture();
    const inputWire = encodeForecastRuntimeInputWireV1(input, reference);
    const outcomeWire = encodeForecastAuthorizedOutcomeWireV1(outcome, reference);
    expect(JSON.stringify(inputWire)).not.toContain("canonicalSourceCorpus");
    expect(JSON.stringify(outcomeWire)).not.toContain("replicaArtifacts");
    expect(inputWire.predictivePackage.family.symbol).toBe("BTCUSDT");
    expect(outcomeWire.issuance.package.family.symbol).toBe("BTCUSDT");
    const restoredInput = await hydrateForecastRuntimeInputWireV1({} as never, inputWire, scope);
    const restoredOutcome = await hydrateForecastAuthorizedOutcomeWireV1({} as never, outcomeWire, scope);
    expect(restoredInput).toStrictEqual(input);
    expect(restoredOutcome).toStrictEqual(outcome);
    expect(issueForecastRuntimeV2(restoredInput)).toStrictEqual(outcome);
    expect(requireForecastRuntimeAuthorizedOutcomeV2(restoredOutcome)).toStrictEqual(outcome);
    expect(Buffer.byteLength(JSON.stringify(inputWire))).toBeLessThan(50_000);
    expect(Buffer.byteLength(JSON.stringify(outcomeWire))).toBeLessThan(50_000);
  });

  it("does not inspect corpus or pools when serializing admitted references", () => {
    const { input, outcome, reference } = wireFixture();
    const pkg = { ...input.predictivePackage! };
    Object.defineProperty(pkg, "canonicalSourceCorpus", { get() { throw Error("WHOLE_CORPUS_VISITED"); } });
    Object.defineProperty(pkg, "replicaArtifacts", { get() { throw Error("WHOLE_POOLS_VISITED"); } });
    expect(() => encodeForecastRuntimeInputWireV1({ ...input, predictivePackage: pkg }, reference)).not.toThrow();
    expect(() => encodeForecastAuthorizedOutcomeWireV1({ ...outcome, issuance: { ...outcome.issuance, package: pkg } }, reference)).not.toThrow();
  });

  it.each(["organization", "package", "version", "extra", "digest"])("rejects %s substitution before storage access", async (kind) => {
    const { input, reference, scope } = wireFixture();
    const wire = encodeForecastRuntimeInputWireV1(input, reference);
    if (kind === "organization") wire.predictivePackage.reference.organizationId = "00000000-0000-4000-8000-000000000947";
    if (kind === "package") wire.predictivePackage.reference.packageId = "00000000-0000-4000-8000-000000000947";
    if (kind === "version") Object.assign(wire.predictivePackage, { schemaVersion: "unknown" });
    if (kind === "extra") Object.assign(wire.predictivePackage.reference, { authority: "LIVE" });
    if (kind === "digest") wire.predictivePackage.reference.manifestDigestHex = "invalid";
    await expect(hydrateForecastRuntimeInputWireV1({} as never, wire, scope)).rejects.toThrow("FORECAST_PACKAGE_WIRE_REFUSED");
    expect(transport.hydrate).not.toHaveBeenCalled();
  });

  it("rejects valid-format wrong seal and altered family against hydrated evidence", async () => {
    const { input, reference, scope } = wireFixture();
    const wrongSeal = encodeForecastRuntimeInputWireV1(input, { ...reference, manifestDigestHex: "0".repeat(64) });
    await expect(hydrateForecastRuntimeInputWireV1({} as never, wrongSeal, scope)).rejects.toThrow("MANIFEST");
    const wrongFamily = encodeForecastRuntimeInputWireV1(input, reference);
    wrongFamily.predictivePackage.family.symbol = "ETHUSDT";
    await expect(hydrateForecastRuntimeInputWireV1({} as never, wrongFamily, scope)).rejects.toThrow("FAMILY_SUBSTITUTION");
  });

  it("reads legacy JSON without interpreting it as a reference or granting authority", async () => {
    const { input, outcome, scope } = wireFixture();
    const oldInput = JSON.parse(JSON.stringify(input));
    const oldOutcome = JSON.parse(JSON.stringify(outcome));
    expect(forecastPackageWireVersionV1(oldInput.predictivePackage)).toBe("LEGACY");
    expect(await hydrateForecastRuntimeInputWireV1({} as never, oldInput, scope)).toStrictEqual(input);
    expect(await hydrateForecastAuthorizedOutcomeWireV1({} as never, oldOutcome, scope)).toStrictEqual(outcome);
    expect(transport.hydrate).not.toHaveBeenCalled();
  });

  it("refuses oversized or cyclic metadata before JSON serialization", () => {
    const oversized = { value: "x".repeat(4 * 1024 * 1024) };
    const stringify = vi.spyOn(JSON, "stringify");
    try {
      expect(() => cloneBoundedForecastWireJsonV1(oversized)).toThrow("WIRE_TOO_LARGE");
      expect(stringify).not.toHaveBeenCalled();
    } finally { stringify.mockRestore(); }
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    expect(() => cloneBoundedForecastWireJsonV1(cycle)).toThrow("CYCLE");
    expect(() => cloneBoundedForecastWireJsonV1({ value: Infinity })).toThrow("NONFINITE");
  });
});

describe("DEE-756 Forecast Runtime Authority V2", () => {
  it("issues and replays one deterministic, content-addressed Forecast authority", () => {
    const input = fixture();
    const first = issueForecastRuntimeV2(input);
    const second = issueForecastRuntimeV2(input);
    expect(first.status).toBe("FORECAST_AUTHORIZED");
    expect(second).toEqual(first);
    if (first.status !== "FORECAST_AUTHORIZED") throw new Error("expected authority");
    expect(requireForecastRuntimeAuthorizedOutcomeV2(first)).toBe(first);
    const persisted = JSON.parse(JSON.stringify(first)) as typeof first;
    expect(requireForecastRuntimeAuthorizedOutcomeV2(persisted)).toEqual(first);
    expect(JSON.stringify(first.authority)).not.toMatch(
      /BUY|SELL|confidence|expectedEdge|riskMultiplier|capitalEligible/,
    );
  });

  it("returns typed NON_ACTIONABLE for absent and non-admitted inputs", () => {
    const input = fixture();
    expect(
      issueForecastRuntimeV2({ ...input, predictiveAdmissionReceipt: null }),
    ).toMatchObject({ status: "NON_ACTIONABLE", reason: "MISSING_OR_NOT_ADMITTED" });
    expect(
      issueForecastRuntimeV2({ ...input, knowledgeEdgeId: "arbitrary-non-uuid-edge" }),
    ).toMatchObject({ status: "NON_ACTIONABLE", reason: "PIT_OR_INPUT_MISMATCH" });
    expect(
      issueForecastRuntimeV2({
        ...input,
        predictiveAdmissionReceipt: {
          ...input.predictiveAdmissionReceipt!,
          verdict: "RESEARCH_ONLY",
          analysisPurpose: "RESEARCH_NON_CAPITAL",
        },
      }),
    ).toMatchObject({ status: "NON_ACTIONABLE", reason: "MISSING_OR_NOT_ADMITTED" });
  });

  it("refuses a digest-consistent ETH instrument substituted into a BTC snapshot", () => {
    const input = fixture();
    const { contentDigestHex: _snapshotDigest, ...snapshotBody } =
      input.marketStateSnapshot!;
    void _snapshotDigest;
    const mismatchedSnapshotBody = {
      ...snapshotBody,
      instrumentId: "ETH/USDT",
    };
    const mismatchedSnapshot = {
      ...mismatchedSnapshotBody,
      contentDigestHex: computeSemanticSha256Hex(mismatchedSnapshotBody),
    };
    const { contentDigestHex: _admissionDigest, ...admissionBody } =
      input.predictiveAdmissionReceipt!;
    void _admissionDigest;
    const mismatchedAdmissionBody = {
      ...admissionBody,
      marketStateSnapshotContentDigestHex: mismatchedSnapshot.contentDigestHex,
    };

    expect(issueForecastRuntimeV2({
      ...input,
      marketStateSnapshot: mismatchedSnapshot,
      predictiveAdmissionReceipt: {
        ...mismatchedAdmissionBody,
        contentDigestHex: computeSemanticSha256Hex(mismatchedAdmissionBody),
      },
    })).toMatchObject({ status: "NON_ACTIONABLE", reason: "PIT_OR_INPUT_MISMATCH" });
  });

  it.each([
    ["package", (value: ForecastRuntimeInputV2) => ({ ...value, executionHorizonMinutes: 60 })],
    [
      "normalization contract",
      (value: ForecastRuntimeInputV2) => ({
        ...value,
        normalizationVersionDigestHex: hex("0"),
      }),
    ],
    [
      "executable pool payload",
      (value: ForecastRuntimeInputV2) => {
        const artifact = value.predictivePackage!.replicaArtifacts[0]!;
        const observation = artifact.pools.S0[0]!;
        return {
          ...value,
          predictivePackage: {
            ...value.predictivePackage!,
            replicaArtifacts: [
              {
                ...artifact,
                pools: {
                  ...artifact.pools,
                  S0: [
                    {
                      ...observation,
                      anchor: {
                        ...observation.anchor,
                        outcome13d: observation.anchor.outcome13d.map((component, index) =>
                          index === 0 ? component + 0.5 : component,
                        ),
                      },
                    },
                    ...artifact.pools.S0.slice(1),
                  ],
                },
              },
              ...value.predictivePackage!.replicaArtifacts.slice(1),
            ],
          },
        };
      },
    ],
    [
      "executable replica threshold",
      (value: ForecastRuntimeInputV2) => ({
        ...value,
        predictivePackage: {
          ...value.predictivePackage!,
          replicaArtifacts: value.predictivePackage!.replicaArtifacts.map(
            (artifact, index) => (index === 0 ? { ...artifact, q1: artifact.q1 + 0.5 } : artifact),
          ),
        },
      }),
    ],
    [
      "binding",
      (value: ForecastRuntimeInputV2) => ({
        ...value,
        forecastContractBinding: {
          ...value.forecastContractBinding!,
          contentDigestHex: hex("0"),
        },
      }),
    ],
    [
      "PIT snapshot",
      (value: ForecastRuntimeInputV2) => ({
        ...value,
        marketStateSnapshot: {
          ...value.marketStateSnapshot!,
          anchorRealizedVol20m_1m: 0.019,
        },
      }),
    ],
  ] as const)("fails closed on %s identity mismatch", (_label, mutate) => {
    expect(issueForecastRuntimeV2(mutate(fixture())).status).toBe("NON_ACTIONABLE");
  });

  it("rejects authority and issuance seal tampering on replay", () => {
    const result = issueForecastRuntimeV2(fixture());
    if (result.status !== "FORECAST_AUTHORIZED") throw new Error("expected authority");
    expect(() =>
      requireForecastRuntimeAuthorityV2({
        ...result.authority,
        terminalForecastContentDigestHex: hex("0"),
      }),
    ).toThrow("FORECAST_RUNTIME_AUTHORITY_INVALID");
    const forgedPitBody = {
      ...result.authority,
      anchorClosedBarAt: "2023-11-14T22:14:20.000Z",
    };
    const { contentDigestHex: _oldDigest, ...forgedPitBodyWithoutDigest } = forgedPitBody;
    void _oldDigest;
    expect(() =>
      requireForecastRuntimeAuthorityV2({
        ...forgedPitBody,
        contentDigestHex: computeSemanticSha256Hex(forgedPitBodyWithoutDigest),
      }),
    ).toThrow("FORECAST_RUNTIME_AUTHORITY_INVALID");
    expect(() =>
      requireForecastRuntimeAuthorizedOutcomeV2({
        ...result,
        issuance: {
          ...result.issuance,
          distributionSemanticDigestTerminal: Buffer.alloc(32),
        },
      }),
    ).toThrow("FORECAST_RUNTIME_AUTHORIZED_OUTCOME_INVALID:replay");
    expect(() =>
      requireForecastRuntimeAuthorizedOutcomeV2({
        ...result,
        issuance: {
          ...result.issuance,
          actionable: false,
          reasonCodes: ["FORGED"],
        },
      }),
    ).toThrow("FORECAST_RUNTIME_AUTHORIZED_OUTCOME_INVALID:replay");
    expect(() =>
      requireForecastRuntimeAuthorizedOutcomeV2({
        ...result,
        issuance: {
          ...result.issuance,
          package: {
            ...result.issuance.package,
            terminalTargetGridIdentityDigestHex: hex("0"),
          },
        },
      }),
    ).toThrow("FORECAST_RUNTIME_AUTHORIZED_OUTCOME_INVALID:replay");
  });
});

describe("DEE-633 Forecast V2 outcome, calibration and future Knowledge feedback", () => {
  function authorizedFixture() {
    const outcome = issueForecastRuntimeV2(fixture());
    if (outcome.status !== "FORECAST_AUTHORIZED") throw new Error("expected authority");
    return outcome;
  }

  function evidence(outcome = authorizedFixture()) {
    const resolvedAt = new Date(
      outcome.authority.anchorClosedBarEpochMs +
        (outcome.issuance.package.family.primaryHorizonMinutes + 3) * 60_000,
    ).toISOString();
    return {
      organizationId,
      symbol: "BTCUSDT",
      primaryHorizonMinutes: 30,
      anchorClosedBarEpochMs: outcome.authority.anchorClosedBarEpochMs,
      resolvedAt,
      pitEvidenceBoundary: resolvedAt,
      observedTerminalReturn: 0,
      observedOutcomeDigestHex: hex("4"),
      pitMeasurementIdentityDigestHex: hex("5"),
      knowledgeEdgeId: outcome.authority.knowledgeEdgeId,
      knowledgeContentDigestHex: outcome.authority.knowledgeContentDigestHex,
    } as const;
  }

  it("scores the sealed seven-bucket distribution with the ratified proper-score convention", () => {
    const outcome = authorizedFixture();
    const observation = scoreForecastV2MulticlassObservation({
      authorizedOutcome: outcome,
      objectiveEvidence: evidence(outcome),
    });
    const probabilities = outcome.issuance.terminalScenarioMasses.probabilities;
    const expectedBrier =
      0.5 *
      probabilities.reduce(
        (sum, p, ordinal) =>
          sum + (p - (ordinal === observation.observedBucketOrdinal ? 1 : 0)) ** 2,
        0,
      );
    expect(observation.probabilities).toEqual(probabilities);
    expect(Number(observation.normalizedBrierScore)).toBe(expectedBrier);
    expect(Number(observation.logLossScore)).toBe(
      -Math.log(
        Math.max(probabilities[observation.observedBucketOrdinal]!, FORECAST_V2_LOG_LOSS_FLOOR),
      ),
    );
    expect(Number(observation.normalizedBrierScore)).toBeGreaterThanOrEqual(0);
    expect(Number(observation.normalizedBrierScore)).toBeLessThanOrEqual(1);
    expect(observation.capitalAuthority).toBe("NONE");
  });

  it.each([
    ["organization", { organizationId: "22222222-2222-4222-8222-222222222222" }],
    ["symbol", { symbol: "ETHUSDT" }],
    ["horizon", { primaryHorizonMinutes: 60 }],
    ["anchor", { anchorClosedBarEpochMs: 0 }],
  ])("rejects wrong %s binding", (_name, mutation) => {
    const outcome = authorizedFixture();
    expect(() =>
      scoreForecastV2MulticlassObservation({
        authorizedOutcome: outcome,
        objectiveEvidence: { ...evidence(outcome), ...mutation },
      }),
    ).toThrow(/IDENTITY_MISMATCH/);
  });

  it("rejects early and non-finite objective evidence", () => {
    const outcome = authorizedFixture();
    expect(() =>
      scoreForecastV2MulticlassObservation({
        authorizedOutcome: outcome,
        objectiveEvidence: {
          ...evidence(outcome),
          resolvedAt: new Date(outcome.authority.anchorClosedBarEpochMs).toISOString(),
        },
      }),
    ).toThrow(/PIT_MISMATCH/);
    expect(() =>
      scoreForecastV2MulticlassObservation({
        authorizedOutcome: outcome,
        objectiveEvidence: { ...evidence(outcome), observedTerminalReturn: Number.NaN },
      }),
    ).toThrow(/PIT_MISMATCH/);
    expect(() =>
      scoreForecastV2MulticlassObservation({
        authorizedOutcome: outcome,
        objectiveEvidence: {
          ...evidence(outcome),
          pitEvidenceBoundary: new Date(outcome.authority.anchorClosedBarEpochMs).toISOString(),
        },
      }),
    ).toThrow(/PIT_MISMATCH/);
  });

  it("rejects late-bound Knowledge identity that differs from the issuance seal", () => {
    const outcome = authorizedFixture();
    expect(() =>
      scoreForecastV2MulticlassObservation({
        authorizedOutcome: outcome,
        objectiveEvidence: { ...evidence(outcome), knowledgeEdgeId: "late-edge" },
      }),
    ).toThrow(/IDENTITY_MISMATCH/);
  });

});
