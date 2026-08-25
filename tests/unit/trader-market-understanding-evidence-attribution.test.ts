import { describe, expect, it } from "vitest";

import {
  MARKET_UNDERSTANDING_DERIVATION_DEFINITION_V1,
  MARKET_UNDERSTANDING_ONLY_AUTHORITY_V1,
  MARKET_UNDERSTANDING_QUESTION_MAPPING_V1,
  assertMarketUnderstandingArtifactV1,
  assertUnderstandingClaimV1,
  defineMarketUnderstandingArtifactV1,
  defineUnderstandingClaimV1,
} from "@/lib/trader/intelligence/market-understanding-evidence-attribution-v1";
import { CANONICAL_MARKET_QUESTION_IDS } from "@/lib/trader/intelligence/market-understanding.types";
import {
  makeUnderstandingEvidence,
  makeUnderstandingProfileReceipt,
  makeUnderstandingRequirement,
  understandingTestDigest,
} from "@/tests/unit/helpers/market-understanding-evidence";

const RECONSTRUCTION_DIGEST = understandingTestDigest("reconstruction");
const FEATURE_DIGEST = understandingTestDigest("features");

function whatClaim(
  fixture: ReturnType<typeof makeUnderstandingProfileReceipt>,
  overrides: Partial<Parameters<typeof defineUnderstandingClaimV1>[0]> = {},
) {
  return defineUnderstandingClaimV1({
    profile: fixture.profile,
    receipt: fixture.receipt,
    computationInputs: [
      { path: "reconstruction.1m.closed", contentDigest: RECONSTRUCTION_DIGEST },
      { path: "features.price", contentDigest: FEATURE_DIGEST },
      { path: "question.what", contentDigest: understandingTestDigest("question.what") },
    ],
    marketQuestionId: "Q_WHAT_HAPPENING",
    claimState: "SUPPORTED",
    claimKind: "OBSERVED_FACT",
    answerSummary: "price_state_observed",
    consumedEvidence: [
      {
        evidenceId: "evidence-price-1",
        role: "SUPPORTING",
        dependencyPaths: ["reconstruction.1m.closed", "question.what"],
      },
    ],
    ...overrides,
  });
}

function completeClaimSet(
  fixture: ReturnType<typeof makeUnderstandingProfileReceipt>,
  selectedWhatClaim: ReturnType<typeof whatClaim>,
) {
  return CANONICAL_MARKET_QUESTION_IDS.map((marketQuestionId) => {
    if (marketQuestionId === "Q_WHAT_HAPPENING") return selectedWhatClaim;
    const capitalQuestion =
      marketQuestionId === "Q_DEPLOY_CAPITAL" || marketQuestionId === "Q_PRESERVE_CAPITAL";
    return defineUnderstandingClaimV1({
      profile: fixture.profile,
      receipt: fixture.receipt,
      computationInputs: [
        {
          path: `question.${marketQuestionId.toLowerCase()}`,
          contentDigest: understandingTestDigest(`input:${marketQuestionId}`),
        },
      ],
      marketQuestionId,
      claimState: capitalQuestion ? "NOT_APPLICABLE" : "UNAVAILABLE",
      claimKind: "UNRESOLVED",
      answerSummary: capitalQuestion
        ? "outside_market_understanding_authority"
        : "question_receipt_unavailable",
      consumedEvidence: [],
    });
  });
}

describe("DEE-712 exact Market Understanding attribution contract", () => {
  it("freezes the structural question map and no-capital derivation identity", () => {
    expect(MARKET_UNDERSTANDING_QUESTION_MAPPING_V1).toEqual([
      { marketQuestionId: "Q_WHAT_HAPPENING", informationQuestionId: "Q_WHAT_HAPPENING" },
      { marketQuestionId: "Q_WHY_HAPPENING", informationQuestionId: "Q_WHY_HAPPENING" },
      {
        marketQuestionId: "Q_HTF_ALIGNED",
        informationQuestionId: "Q_CROSS_TIMEFRAME_RELATIONSHIP",
      },
      {
        marketQuestionId: "Q_LTF_ALIGNED",
        informationQuestionId: "Q_CROSS_TIMEFRAME_RELATIONSHIP",
      },
      {
        marketQuestionId: "Q_CROSS_VENUE",
        informationQuestionId: "Q_UNKNOWN_OR_CONTRADICTORY",
      },
      { marketQuestionId: "Q_CROWD", informationQuestionId: "Q_UNKNOWN_OR_CONTRADICTORY" },
      { marketQuestionId: "Q_LIQUIDITY", informationQuestionId: "Q_EXECUTION_LIQUIDITY" },
      {
        marketQuestionId: "Q_DATA_TRUST",
        informationQuestionId: "Q_UNKNOWN_OR_CONTRADICTORY",
      },
      { marketQuestionId: "Q_UNKNOWN", informationQuestionId: "Q_UNKNOWN_OR_CONTRADICTORY" },
      {
        marketQuestionId: "Q_HISTORICAL_ANALOGUES",
        informationQuestionId: "Q_HISTORICAL_ANALOGUES",
      },
      { marketQuestionId: "Q_DEPLOY_CAPITAL", informationQuestionId: null },
      { marketQuestionId: "Q_PRESERVE_CAPITAL", informationQuestionId: null },
    ]);
    expect(MARKET_UNDERSTANDING_DERIVATION_DEFINITION_V1.contentDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(MARKET_UNDERSTANDING_ONLY_AUTHORITY_V1).toEqual({
      kind: "MARKET_UNDERSTANDING_ONLY",
      createsForecastAuthority: false,
      createsDecisionAuthority: false,
      createsRiskAuthority: false,
      createsExecutionAuthority: false,
      createsCapitalAuthority: false,
    });
  });

  it("canonicalizes exact receipt evidence and derives the used/ignored partition", () => {
    const unused = makeUnderstandingEvidence({
      evidenceId: "unused-news",
      evidenceFamily: "news",
      providerId: "coindesk_rss",
      sourceId: "00000000-0000-4000-8000-000000000011",
      observationId: "00000000-0000-4000-8000-000000000012",
      observationKind: "news_headline",
      observationContentDigest: understandingTestDigest("unused-news"),
      trustAsOfReceiptId: understandingTestDigest("unused-news-trust"),
      trustRevisionId: "00000000-0000-4000-8000-000000000013",
      trustRevisionContentDigest: understandingTestDigest("unused-news-trust-revision"),
      dependenceGroup: "news-group",
      epistemicRole: "CORROBORATING",
    });
    const fixture = makeUnderstandingProfileReceipt({
      evidence: [unused, makeUnderstandingEvidence()],
    });
    const claim = whatClaim(fixture, { irrelevantEvidenceIds: ["unused-news"] });
    const claims = completeClaimSet(fixture, claim);
    const artifact = defineMarketUnderstandingArtifactV1({
      ...fixture,
      evaluatedAt: fixture.receipt.pitAnchor,
      claims,
    });

    expect(claim.dependencies.map((entry) => entry.evidence.evidenceId)).toEqual([
      "evidence-price-1",
      "unused-news",
    ]);
    expect(artifact.evidenceUsed.map((entry) => entry.evidenceId)).toEqual([
      "evidence-price-1",
    ]);
    expect(artifact.evidenceIgnored.map((entry) => entry.evidenceId)).toEqual(["unused-news"]);
    expect(claim.dependencies[0]?.evidence).toMatchObject({
      sourceId: "00000000-0000-4000-8000-000000000001",
      observationId: "00000000-0000-4000-8000-000000000002",
      observationContentDigest: understandingTestDigest("observation-price"),
      trustAsOfReceiptId: understandingTestDigest("trust-receipt-price"),
      trustRevisionId: "00000000-0000-4000-8000-000000000003",
      trustRevisionContentDigest: understandingTestDigest("trust-revision-price"),
    });
    expect(Object.isFrozen(artifact)).toBe(true);
    expect(Object.isFrozen(artifact.claims)).toBe(true);
    expect(assertMarketUnderstandingArtifactV1(artifact, fixture.profile, fixture.receipt)).toBe(
      artifact,
    );

    const inheritedProfile = Object.assign(
      Object.create({ formula: "BUY", createsCapitalAuthority: true }),
      fixture.profile,
    ) as typeof fixture.profile;
    expect(() =>
      defineMarketUnderstandingArtifactV1({
        profile: inheritedProfile,
        receipt: fixture.receipt,
        evaluatedAt: fixture.receipt.pitAnchor,
        claims,
      }),
    ).toThrow(/runtimePrototype/);

    const hiddenReceipt = { ...fixture.receipt };
    Object.defineProperty(hiddenReceipt, "createsCapitalAuthority", {
      value: true,
      enumerable: false,
    });
    expect(() =>
      defineMarketUnderstandingArtifactV1({
        profile: fixture.profile,
        receipt: hiddenReceipt,
        evaluatedAt: fixture.receipt.pitAnchor,
        claims,
      }),
    ).toThrow(/runtimeFieldShape/);

    const symbolProfile = { ...fixture.profile };
    Object.defineProperty(symbolProfile, Symbol("formula"), {
      value: "BUY",
      enumerable: true,
    });
    expect(() =>
      defineMarketUnderstandingArtifactV1({
        profile: symbolProfile,
        receipt: fixture.receipt,
        evaluatedAt: fixture.receipt.pitAnchor,
        claims,
      }),
    ).toThrow(/runtimeFieldShape/);

    const accessorReceipt = { ...fixture.receipt };
    Object.defineProperty(accessorReceipt, "formula", {
      get: () => "BUY",
      enumerable: true,
    });
    expect(() =>
      defineMarketUnderstandingArtifactV1({
        profile: fixture.profile,
        receipt: accessorReceipt,
        evaluatedAt: fixture.receipt.pitAnchor,
        claims,
      }),
    ).toThrow(/runtimeFieldShape/);

    const sparseRequirements = new Array(2) as typeof fixture.profile.requirements;
    (sparseRequirements as typeof fixture.profile.requirements[number][])[0] =
      fixture.profile.requirements[0]!;
    const sparseProfile = { ...fixture.profile, requirements: sparseRequirements };
    expect(() =>
      defineMarketUnderstandingArtifactV1({
        profile: sparseProfile,
        receipt: fixture.receipt,
        evaluatedAt: fixture.receipt.pitAnchor,
        claims,
      }),
    ).toThrow(/runtimeArrayShape/);

    const cyclicReceipt = { ...fixture.receipt } as typeof fixture.receipt & {
      self?: unknown;
    };
    cyclicReceipt.self = cyclicReceipt;
    expect(() =>
      defineMarketUnderstandingArtifactV1({
        profile: fixture.profile,
        receipt: cyclicReceipt,
        evaluatedAt: fixture.receipt.pitAnchor,
        claims,
      }),
    ).toThrow(/cyclicRuntimeShape/);

    for (const hostileValue of [
      () => "BUY",
      undefined,
      Symbol("BUY"),
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      const hostileProfile = {
        ...fixture.profile,
        formula: hostileValue,
      } as typeof fixture.profile;
      expect(() =>
        defineMarketUnderstandingArtifactV1({
          profile: hostileProfile,
          receipt: fixture.receipt,
          evaluatedAt: fixture.receipt.pitAnchor,
          claims,
        }),
      ).toThrow(/runtimeValueShape/);
    }

    const accessorArtifact = JSON.parse(JSON.stringify(artifact)) as typeof artifact;
    const embeddedProfile = accessorArtifact.authenticatedProfile;
    let accessorCalls = 0;
    Object.defineProperty(accessorArtifact, "authenticatedProfile", {
      get: () => {
        accessorCalls += 1;
        return embeddedProfile;
      },
      enumerable: true,
    });
    expect(() => assertMarketUnderstandingArtifactV1(accessorArtifact)).toThrow(
      /artifactIdentity/,
    );
    expect(accessorCalls).toBe(0);

    const artifactInput = {
      profile: fixture.profile,
      receipt: fixture.receipt,
      evaluatedAt: fixture.receipt.pitAnchor,
      claims,
    };
    let artifactInputCalls = 0;
    Object.defineProperty(artifactInput, "profile", {
      get: () => {
        artifactInputCalls += 1;
        return fixture.profile;
      },
      enumerable: true,
    });
    expect(() => defineMarketUnderstandingArtifactV1(artifactInput)).toThrow(
      /runtimeFieldShape/,
    );
    expect(artifactInputCalls).toBe(0);

    const claimInput = {
      profile: fixture.profile,
      receipt: fixture.receipt,
      computationInputs: claim.computationInputs,
      marketQuestionId: claim.marketQuestionId,
      claimState: claim.claimState,
      claimKind: claim.claimKind,
      answerSummary: claim.answerSummary,
      consumedEvidence: claim.dependencies
        .filter((dependency) => dependency.disposition === "CONSUMED")
        .map((dependency) => ({
          evidenceId: dependency.evidence.evidenceId,
          role: dependency.role!,
          dependencyPaths: dependency.dependencyPaths,
        })),
      irrelevantEvidenceIds: ["unused-news"],
    };
    let claimInputCalls = 0;
    Object.defineProperty(claimInput, "profile", {
      get: () => {
        claimInputCalls += 1;
        return fixture.profile;
      },
      enumerable: true,
    });
    expect(() => defineUnderstandingClaimV1(claimInput)).toThrow(/runtimeFieldShape/);
    expect(claimInputCalls).toBe(0);
  });

  it("isolates causal lineage from unused revisions but binds consumed content and trust revisions", () => {
    const unused = makeUnderstandingEvidence({
      evidenceId: "unused-news",
      evidenceFamily: "news",
      providerId: "coindesk_rss",
      sourceId: "00000000-0000-4000-8000-000000000011",
      observationId: "00000000-0000-4000-8000-000000000012",
      observationKind: "news_headline",
      observationContentDigest: understandingTestDigest("unused-news-v1"),
      trustAsOfReceiptId: understandingTestDigest("unused-news-trust"),
      trustRevisionId: "00000000-0000-4000-8000-000000000013",
      trustRevisionContentDigest: understandingTestDigest("unused-news-trust-revision"),
      dependenceGroup: "news-group",
      epistemicRole: "CORROBORATING",
    });
    const firstFixture = makeUnderstandingProfileReceipt({
      evidence: [makeUnderstandingEvidence(), unused],
    });
    const unusedRevisionFixture = makeUnderstandingProfileReceipt({
      evidence: [
        { ...unused, observationContentDigest: understandingTestDigest("unused-news-v2") },
        makeUnderstandingEvidence(),
      ],
    });
    const consumedRevisionFixture = makeUnderstandingProfileReceipt({
      evidence: [
        makeUnderstandingEvidence({
          observationContentDigest: understandingTestDigest("observation-price-v2"),
        }),
        unused,
      ],
    });
    const trustRevisionFixture = makeUnderstandingProfileReceipt({
      evidence: [
        makeUnderstandingEvidence({
          trustRevisionContentDigest: understandingTestDigest("trust-revision-price-v2"),
        }),
        unused,
      ],
    });
    const acceptedButUnusedFixture = makeUnderstandingProfileReceipt({
      evidence: [
        makeUnderstandingEvidence(),
        makeUnderstandingEvidence({
          evidenceId: "accepted-but-unused-price",
          sourceId: "00000000-0000-4000-8000-000000000041",
          observationId: "00000000-0000-4000-8000-000000000042",
          observationContentDigest: understandingTestDigest("accepted-but-unused-price"),
          trustAsOfReceiptId: understandingTestDigest("accepted-but-unused-price-trust"),
          trustRevisionId: "00000000-0000-4000-8000-000000000043",
          trustRevisionContentDigest: understandingTestDigest(
            "accepted-but-unused-price-trust-revision",
          ),
          dependenceGroup: "accepted-but-unused-group",
        }),
        unused,
      ],
    });

    const first = whatClaim(firstFixture, { irrelevantEvidenceIds: ["unused-news"] });
    const unusedChanged = whatClaim(unusedRevisionFixture, {
      irrelevantEvidenceIds: ["unused-news"],
    });
    const consumedChanged = whatClaim(consumedRevisionFixture, {
      irrelevantEvidenceIds: ["unused-news"],
    });
    const trustChanged = whatClaim(trustRevisionFixture, {
      irrelevantEvidenceIds: ["unused-news"],
    });
    const acceptedButUnused = whatClaim(acceptedButUnusedFixture, {
      irrelevantEvidenceIds: ["unused-news"],
    });

    expect(unusedChanged.causalLineageDigest).toBe(first.causalLineageDigest);
    expect(unusedChanged.contentDigest).not.toBe(first.contentDigest);
    expect(consumedChanged.causalLineageDigest).not.toBe(first.causalLineageDigest);
    expect(trustChanged.causalLineageDigest).not.toBe(first.causalLineageDigest);
    expect(acceptedButUnused.causalLineageDigest).toBe(first.causalLineageDigest);
    expect(acceptedButUnused.contentDigest).not.toBe(first.contentDigest);

    const unrelatedQuestionInputChanged = defineUnderstandingClaimV1({
      profile: firstFixture.profile,
      receipt: firstFixture.receipt,
      computationInputs: [
        { path: "question.crowd", contentDigest: understandingTestDigest("crowd-input-v2") },
      ],
      marketQuestionId: "Q_CROWD",
      claimState: "UNAVAILABLE",
      claimKind: "UNRESOLVED",
      answerSummary: "question_receipt_unavailable",
      consumedEvidence: [],
    });
    expect(unrelatedQuestionInputChanged.causalLineageDigest).not.toBe(first.causalLineageDigest);
    expect(whatClaim(firstFixture, { irrelevantEvidenceIds: ["unused-news"] }).causalLineageDigest).toBe(
      first.causalLineageDigest,
    );
  });

  it("requires authenticated causal evidence for causal WHY claims", () => {
    const whyRequirement = makeUnderstandingRequirement({
      id: "why",
      questionId: "Q_WHY_HAPPENING",
      satisfiers: [
        { evidenceFamily: "news", providerIds: ["coindesk_rss"], substitutionRuleId: null },
      ],
      allowedObservationKinds: ["news_headline"],
    });
    const price = makeUnderstandingEvidence({
      evidenceId: "price-as-why",
      evidenceFamily: "news",
      providerId: "coindesk_rss",
    });
    const invalidFixture = makeUnderstandingProfileReceipt({
      requirements: [whyRequirement],
      evidence: [price],
    });
    expect(() =>
      defineUnderstandingClaimV1({
        profile: invalidFixture.profile,
        receipt: invalidFixture.receipt,
        computationInputs: [
          { path: "reconstruction.why", contentDigest: RECONSTRUCTION_DIGEST },
          { path: "features.why", contentDigest: FEATURE_DIGEST },
          { path: "question.why", contentDigest: understandingTestDigest("question.why") },
        ],
        marketQuestionId: "Q_WHY_HAPPENING",
        claimState: "SUPPORTED",
        claimKind: "EVIDENCE_SUPPORTED_CAUSAL_ATTRIBUTION",
        answerSummary: "price_timing_is_not_cause",
        consumedEvidence: [
          { evidenceId: "price-as-why", role: "SUPPORTING", dependencyPaths: ["question.why"] },
        ],
      }),
    ).toThrow(/consumedEvidenceClosure|whyRequiresCausalEvidence/);

    const contextualCausal = makeUnderstandingEvidence({
      evidenceId: "contextual-causal-as-why",
      evidenceFamily: "news",
      providerId: "coindesk_rss",
      observationKind: "news_headline",
      epistemicRole: "CAUSAL",
    });
    const contextualFixture = makeUnderstandingProfileReceipt({
      requirements: [whyRequirement],
      evidence: [contextualCausal],
    });
    expect(() =>
      defineUnderstandingClaimV1({
        profile: contextualFixture.profile,
        receipt: contextualFixture.receipt,
        computationInputs: [
          { path: "question.why", contentDigest: understandingTestDigest("question.why") },
        ],
        marketQuestionId: "Q_WHY_HAPPENING",
        claimState: "SUPPORTED",
        claimKind: "OBSERVED_FACT",
        answerSummary: "context_does_not_prove_cause",
        consumedEvidence: [
          {
            evidenceId: contextualCausal.evidenceId,
            role: "CONTEXTUAL",
            dependencyPaths: ["question.why"],
          },
        ],
      }),
    ).toThrow(/whyRequiresCausalClaim/);

    const causal = makeUnderstandingEvidence({
      evidenceId: "causal-news",
      evidenceFamily: "news",
      providerId: "coindesk_rss",
      sourceId: "00000000-0000-4000-8000-000000000021",
      observationId: "00000000-0000-4000-8000-000000000022",
      observationKind: "news_headline",
      observationContentDigest: understandingTestDigest("causal-news"),
      trustAsOfReceiptId: understandingTestDigest("causal-news-trust"),
      trustRevisionId: "00000000-0000-4000-8000-000000000023",
      trustRevisionContentDigest: understandingTestDigest("causal-news-trust-revision"),
      dependenceGroup: "causal-news-group",
      epistemicRole: "CAUSAL",
    });
    const fixture = makeUnderstandingProfileReceipt({
      requirements: [whyRequirement],
      evidence: [causal],
    });
    const claim = defineUnderstandingClaimV1({
      profile: fixture.profile,
      receipt: fixture.receipt,
      computationInputs: [
        { path: "reconstruction.why", contentDigest: RECONSTRUCTION_DIGEST },
        { path: "features.why", contentDigest: FEATURE_DIGEST },
        { path: "question.why", contentDigest: understandingTestDigest("question.why") },
      ],
      marketQuestionId: "Q_WHY_HAPPENING",
      claimState: "SUPPORTED",
      claimKind: "EVIDENCE_SUPPORTED_CAUSAL_ATTRIBUTION",
      answerSummary: "causal_news_supported",
      consumedEvidence: [
        { evidenceId: "causal-news", role: "SUPPORTING", dependencyPaths: ["question.why"] },
      ],
    });
    expect(claim.claimKind).toBe("EVIDENCE_SUPPORTED_CAUSAL_ATTRIBUTION");
  });

  it("derives typed missing expected evidence and cannot overwrite capital questions", () => {
    const missingFixture = makeUnderstandingProfileReceipt({ evidence: [] });
    const missing = defineUnderstandingClaimV1({
      profile: missingFixture.profile,
      receipt: missingFixture.receipt,
      computationInputs: [
        { path: "reconstruction.what", contentDigest: RECONSTRUCTION_DIGEST },
        { path: "features.what", contentDigest: FEATURE_DIGEST },
      ],
      marketQuestionId: "Q_WHAT_HAPPENING",
      claimState: "UNAVAILABLE",
      claimKind: "UNRESOLVED",
      answerSummary: "required_price_state_unavailable",
      consumedEvidence: [],
    });
    expect(missing.missingExpectedEvidence).toEqual([
      expect.objectContaining({
        requirementId: "price-state",
        informationQuestionId: "Q_WHAT_HAPPENING",
        terminalStatus: "UNAVAILABLE",
        blocking: true,
      }),
    ]);

    expect(() =>
      defineUnderstandingClaimV1({
        profile: missingFixture.profile,
        receipt: missingFixture.receipt,
        computationInputs: [
          { path: "authority.capital", contentDigest: FEATURE_DIGEST },
        ],
        marketQuestionId: "Q_DEPLOY_CAPITAL",
        claimState: "SUPPORTED",
        claimKind: "OBSERVED_FACT",
        answerSummary: "forbidden",
        consumedEvidence: [],
      }),
    ).toThrow(/capitalQuestionAuthority/);

    const notApplicable = defineUnderstandingClaimV1({
      profile: missingFixture.profile,
      receipt: missingFixture.receipt,
      computationInputs: [{ path: "authority.capital", contentDigest: FEATURE_DIGEST }],
      marketQuestionId: "Q_DEPLOY_CAPITAL",
      claimState: "NOT_APPLICABLE",
      claimKind: "UNRESOLVED",
      answerSummary: "outside_market_understanding_authority",
      consumedEvidence: [],
    });
    expect(notApplicable.authority.createsCapitalAuthority).toBe(false);
  });

  it("rejects receipt-less support, contradiction-as-support, incomplete coverage, and forged identities", () => {
    const optionalFixture = makeUnderstandingProfileReceipt({
      requirements: [
        makeUnderstandingRequirement({
          classification: "OPTIONAL_ENRICHMENT",
        }),
      ],
      evidence: [],
    });
    expect(() =>
      defineUnderstandingClaimV1({
        profile: optionalFixture.profile,
        receipt: optionalFixture.receipt,
        computationInputs: [{ path: "question.what", contentDigest: FEATURE_DIGEST }],
        marketQuestionId: "Q_WHAT_HAPPENING",
        claimState: "SUPPORTED",
        claimKind: "OBSERVED_FACT",
        answerSummary: "unsupported",
        consumedEvidence: [],
      }),
    ).toThrow(/blockingRequirementUnresolved/);

    const contradictory = makeUnderstandingEvidence({
      contradictionGroup: "price-conflict",
      contradiction: "CONTRADICTS",
    });
    const contradictionFixture = makeUnderstandingProfileReceipt({
      requirements: [makeUnderstandingRequirement({ contradictionPolicy: "RECORD_ONLY" })],
      evidence: [contradictory],
    });
    expect(() =>
      whatClaim(contradictionFixture, {
        consumedEvidence: [
          {
            evidenceId: contradictory.evidenceId,
            role: "CONTRADICTING",
            dependencyPaths: ["question.what"],
          },
        ],
      }),
    ).toThrow(/blockingRequirementUnresolved/);

    const fixture = makeUnderstandingProfileReceipt();
    const claim = whatClaim(fixture);
    expect(() =>
      defineMarketUnderstandingArtifactV1({
        ...fixture,
        evaluatedAt: fixture.receipt.pitAnchor,
        claims: [claim],
      }),
    ).toThrow(/questionClaimCoverage/);

    const forged = {
      ...claim,
      contentDigest: "1".repeat(64),
      authority: { ...claim.authority, createsCapitalAuthority: true },
    } as unknown as typeof claim;
    expect(() => assertUnderstandingClaimV1(forged, fixture.profile, fixture.receipt)).toThrow(
      /claimIdentity/,
    );
    expect(() =>
      defineMarketUnderstandingArtifactV1({
        ...fixture,
        evaluatedAt: fixture.receipt.pitAnchor,
        claims: completeClaimSet(fixture, forged),
      }),
    ).toThrow(/claimIdentity/);

    expect(() =>
      defineUnderstandingClaimV1({
        profile: fixture.profile,
        receipt: fixture.receipt,
        computationInputs: [{ path: "question.what", contentDigest: FEATURE_DIGEST }],
        marketQuestionId: "Q_WHAT_HAPPENING",
        claimState: "UNKNOWN",
        claimKind: "UNRESOLVED",
        answerSummary: "false_unknown_without_inspecting_accepted_evidence",
        consumedEvidence: [],
      }),
    ).toThrow(/unknownClaimEvidence/);

    const claims = completeClaimSet(fixture, claim);
    expect(() =>
      defineMarketUnderstandingArtifactV1({
        ...fixture,
        evaluatedAt: "2030-01-01T00:00:00.000Z",
        claims,
      }),
    ).toThrow(/evaluatedAtPitMismatch/);
  });

  it("preserves the receipt independence floor in consumed computation dependencies", () => {
    const first = makeUnderstandingEvidence();
    const second = makeUnderstandingEvidence({
      evidenceId: "evidence-price-2",
      sourceId: "00000000-0000-4000-8000-000000000031",
      observationId: "00000000-0000-4000-8000-000000000032",
      observationContentDigest: understandingTestDigest("observation-price-2"),
      trustAsOfReceiptId: understandingTestDigest("trust-receipt-price-2"),
      trustRevisionId: "00000000-0000-4000-8000-000000000033",
      trustRevisionContentDigest: understandingTestDigest("trust-revision-price-2"),
      dependenceGroup: "independent-price-2",
    });
    const fixture = makeUnderstandingProfileReceipt({
      requirements: [makeUnderstandingRequirement({ minimumIndependentGroups: 2 })],
      evidence: [first, second],
    });
    expect(() => whatClaim(fixture)).toThrow(/independenceFloor/);

    const accepted = whatClaim(fixture, {
      consumedEvidence: [
        {
          evidenceId: first.evidenceId,
          role: "SUPPORTING",
          dependencyPaths: ["question.what"],
        },
        {
          evidenceId: second.evidenceId,
          role: "SUPPORTING",
          dependencyPaths: ["question.what"],
        },
      ],
    });
    expect(accepted.effectiveDependenceGroups).toEqual([
      "htx-price",
      "independent-price-2",
    ]);
  });

  it("rejects partial claims without evidence and closes every consumed computation path", () => {
    const unavailableFixture = makeUnderstandingProfileReceipt({ evidence: [] });
    expect(() =>
      defineUnderstandingClaimV1({
        profile: unavailableFixture.profile,
        receipt: unavailableFixture.receipt,
        computationInputs: [{ path: "question.what", contentDigest: FEATURE_DIGEST }],
        marketQuestionId: "Q_WHAT_HAPPENING",
        claimState: "PARTIALLY_SUPPORTED",
        claimKind: "OBSERVED_FACT",
        answerSummary: "no_canonical_evidence_was_consumed",
        consumedEvidence: [],
      }),
    ).toThrow(/partialClaimUnsupported/);

    const fixture = makeUnderstandingProfileReceipt();
    expect(() =>
      whatClaim(fixture, {
        consumedEvidence: [
          {
            evidenceId: "evidence-price-1",
            role: "SUPPORTING",
            dependencyPaths: [],
          },
        ],
      }),
    ).toThrow(/computationDependencyClosure/);
    expect(() =>
      whatClaim(fixture, {
        consumedEvidence: [
          {
            evidenceId: "evidence-price-1",
            role: "SUPPORTING",
            dependencyPaths: ["unbound.feature.path"],
          },
        ],
      }),
    ).toThrow(/computationDependencyClosure/);
  });

  it("attributes a fail-unresolved contradiction instead of hiding it as ignored", () => {
    const contradiction = makeUnderstandingEvidence({
      contradictionGroup: "price-conflict",
      contradiction: "UNRESOLVED",
    });
    const fixture = makeUnderstandingProfileReceipt({ evidence: [contradiction] });

    expect(fixture.receipt.requirementReceipts[0]).toMatchObject({
      terminalStatus: "UNRESOLVED_CONTRADICTION",
      matchedEvidenceIds: [contradiction.evidenceId],
      acceptedEvidenceIds: [],
    });
    const claim = whatClaim(fixture, {
      claimState: "CONFLICTED",
      claimKind: "OBSERVED_FACT",
      answerSummary: "canonical_price_evidence_conflicts",
      consumedEvidence: [
        {
          evidenceId: contradiction.evidenceId,
          role: "CONTRADICTING",
          dependencyPaths: ["question.what"],
        },
      ],
    });

    expect(claim.dependencies).toEqual([
      expect.objectContaining({
        disposition: "CONSUMED",
        role: "CONTRADICTING",
        evidence: expect.objectContaining({ evidenceId: contradiction.evidenceId }),
      }),
    ]);
    expect(claim.missingExpectedEvidence).toEqual([
      expect.objectContaining({ terminalStatus: "UNRESOLVED_CONTRADICTION" }),
    ]);
    expect(claim.causalLineageDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never upgrades non-PIT or non-replay evidence into a supported understanding claim", () => {
    const fixture = makeUnderstandingProfileReceipt({
      requirements: [
        makeUnderstandingRequirement({
          requirePitQualified: false,
          requireReplayEligible: false,
        }),
      ],
      evidence: [makeUnderstandingEvidence({ pitQualified: false, replayEligible: false })],
    });
    expect(fixture.receipt.requirementReceipts[0]?.terminalStatus).toBe("ANSWERED_SUFFICIENTLY");

    expect(() => whatClaim(fixture)).toThrow(/canonicalPitReplayEvidence/);
  });
});
