import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildMsvEnvelope } from "@/lib/trader/intelligence/cde-v0";
import { computeFeatureSnapshot } from "@/lib/trader/intelligence/feature-engine-v0";
import { buildReconstructionSnapshot } from "@/lib/trader/intelligence/reconstruction/build-reconstruction-snapshot";
import { assembleReconstructionSnapshot } from "@/lib/trader/intelligence/reconstruction/reconstruction-assembly";
import {
  buildExactMarketUnderstandingArtifactV1,
  buildMarketUnderstandingBridge,
  buildResearchSignals,
} from "@/lib/trader/intelligence/market-understanding-bridge-v0";
import { bindInformationSufficiencyReceiptAuthorityV2 } from "@/lib/trader/intelligence/information-sufficiency";
import {
  CANONICAL_MARKET_QUESTION_IDS,
  MARKET_UNDERSTANDING_SCHEMA_VERSION,
  type MarketUnderstandingSnapshot,
} from "@/lib/trader/intelligence/market-understanding.types";
import { buildCrossVenueTriangulation } from "@/lib/trader/market-data/fusion/cross-venue-triangulation";
import { fuseContextV0 } from "@/lib/trader/market-data/fusion/context-fusion-v0";
import {
  buildProvenanceRef,
  normalizeCrossExchangeConfirmation,
  normalizeFearGreedObservation,
  normalizeOhlcvBarsObservation,
} from "@/lib/trader/market-data/normalization/normalize-observation";
import { buildReplayFusedContext } from "@/lib/trader/market-data/replay-fused-context-builder";
import { MTF_BAR_INTERVALS } from "@/lib/trader/market-data/observation-types";
import {
  makeUnderstandingEvidence,
  makeUnderstandingProfileReceipt,
  makeUnderstandingRequirement,
} from "@/tests/unit/helpers/market-understanding-evidence";

function loadFixtureBars() {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader/btcusdt-1m-mean-reversion.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as {
    bars: import("@/lib/trader/intelligence/types").Bar[];
    latestQuote: import("@/lib/trader/intelligence/types").Quote;
  };
}

describe("PR2.6 market understanding bridge", () => {
  it("produces deterministic snapshots for identical inputs", () => {
    const fixture = loadFixtureBars();
    const evaluatedAt = fixture.bars.at(-1)!.barCloseTime;
    const fusedContext = buildReplayFusedContext({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      instrumentId: "BTC/USDT",
    });
    const features = computeFeatureSnapshot({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
    });

    const first = buildMarketUnderstandingBridge({ fusedContext, features });
    const second = buildMarketUnderstandingBridge({ fusedContext, features });

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.schemaVersion).toBe("waia.trader.market_understanding.v0");
  });

  it("evaluates all 12 canonical questions", () => {
    const fixture = loadFixtureBars();
    const evaluatedAt = fixture.bars.at(-1)!.barCloseTime;
    const fusedContext = buildReplayFusedContext({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      instrumentId: "BTC/USDT",
    });
    const features = computeFeatureSnapshot({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
    });

    const understanding = buildMarketUnderstandingBridge({ fusedContext, features });
    expect(understanding.questionEvaluations).toHaveLength(12);
    expect(understanding.questionEvaluations.map((q) => q.questionId).sort()).toEqual(
      [...CANONICAL_MARKET_QUESTION_IDS].sort(),
    );
  });

  it("emits knowledge gaps when evidence incomplete", () => {
    const evaluatedAt = "2026-01-01T14:00:00.000Z";
    const fixture = loadFixtureBars();
    const fusedContext = fuseContextV0({
      instrumentId: "BTC/USDT",
      fusedAtUtc: evaluatedAt,
      mtfBars: {},
      crossVenueTriangulation: buildCrossVenueTriangulation({}),
      degradationReasons: ["cross_exchange_unavailable"],
    });
    const features = computeFeatureSnapshot({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
    });

    const understanding = buildMarketUnderstandingBridge({ fusedContext, features });
    expect(understanding.knowledgeGaps.length).toBeGreaterThan(0);
    expect(understanding.confidenceAttribution.contributors.length).toBeGreaterThan(0);
    expect(understanding.reasoningInputs.unknowns.length).toBeGreaterThanOrEqual(0);
  });

  it("downgrades CDE permission on cross-venue conflict", () => {
    const evaluatedAt = "2026-01-01T14:00:00.000Z";
    const fixture = loadFixtureBars();
    const mtfBars: Partial<
      Record<
        import("@/lib/trader/intelligence/types").BarInterval,
        ReturnType<typeof normalizeOhlcvBarsObservation>[]
      >
    > = {};

    for (const interval of MTF_BAR_INTERVALS) {
      mtfBars[interval] = [
        normalizeOhlcvBarsObservation({
          bars: fixture.bars.map((bar) => ({ ...bar, interval })),
          provenance: buildProvenanceRef({
            providerId: "htx_spot",
            venue: "htx",
            feedKind: "ohlcv_bar",
            symbol: "BTC/USDT",
            eventTimeUtc: evaluatedAt,
          }),
          latencyMs: 1,
          evaluatedAt,
        }),
      ];
    }

    const binance = normalizeCrossExchangeConfirmation({
      symbol: "BTC/USDT",
      primaryLast: fixture.latestQuote.last,
      confirmLast: "70000",
      confirmVenue: "binance",
      provenance: buildProvenanceRef({
        providerId: "binance_public",
        venue: "binance",
        feedKind: "cross_exchange_confirmation",
        symbol: "BTC/USDT",
        eventTimeUtc: evaluatedAt,
      }),
      latencyMs: 1,
      evaluatedAt,
    });
    const bybit = normalizeCrossExchangeConfirmation({
      symbol: "BTC/USDT",
      primaryLast: fixture.latestQuote.last,
      confirmLast: "60000",
      confirmVenue: "bybit",
      provenance: buildProvenanceRef({
        providerId: "bybit_public",
        venue: "bybit",
        feedKind: "cross_exchange_confirmation",
        symbol: "BTC/USDT",
        eventTimeUtc: evaluatedAt,
      }),
      latencyMs: 1,
      evaluatedAt,
    });

    const fusedContext = fuseContextV0({
      instrumentId: "BTC/USDT",
      fusedAtUtc: evaluatedAt,
      mtfBars,
      crossExchangeConfirmation: binance,
      crossVenueTriangulation: buildCrossVenueTriangulation({ binance, bybit }),
      fearGreed: normalizeFearGreedObservation({
        value: 85,
        classification: "Extreme Greed",
        provenance: buildProvenanceRef({
          providerId: "alternative_me",
          venue: "alternative_me",
          feedKind: "fear_greed_index",
          symbol: "GLOBAL",
          eventTimeUtc: evaluatedAt,
        }),
        latencyMs: 1,
        evaluatedAt,
        eventTimeUtc: evaluatedAt,
      }),
    });

    const features = computeFeatureSnapshot({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
    });
    const understanding = buildMarketUnderstandingBridge({ fusedContext, features });
    const msv = buildMsvEnvelope({ features, fusedContext, understanding });
    const withoutLegacyUnderstanding = buildMsvEnvelope({ features, fusedContext });

    expect(understanding.spotPosture).not.toBe("TRADE");
    expect(msv.derived).toEqual(withoutLegacyUnderstanding.derived);
    expect(msv.understanding?.spotPosture).toBe(understanding.spotPosture);
  });

  it("exports research signals from understanding", () => {
    const fixture = loadFixtureBars();
    const evaluatedAt = fixture.bars.at(-1)!.barCloseTime;
    const fusedContext = buildReplayFusedContext({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      instrumentId: "BTC/USDT",
    });
    const features = computeFeatureSnapshot({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
    });
    const understanding = buildMarketUnderstandingBridge({ fusedContext, features });
    const signals = buildResearchSignals(understanding);
    expect(Array.isArray(signals.unansweredQuestions)).toBe(true);
    expect(Array.isArray(signals.conflicts)).toBe(true);
    expect(Array.isArray(signals.anomalies)).toBe(true);
  });

  it("builds exact question-relative attribution only from a scope-matched profile receipt", () => {
    const fixture = loadFixtureBars();
    const evaluatedAt = fixture.bars.at(-1)!.barCloseTime;
    const fusedContext = buildReplayFusedContext({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      instrumentId: "BTC/USDT",
    });
    const features = computeFeatureSnapshot({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
    });
    const understanding = buildMarketUnderstandingBridge({ fusedContext, features });
    const profileReceipt = makeUnderstandingProfileReceipt({
      pitAnchor: evaluatedAt,
      evidence: [makeUnderstandingEvidence({ availableAt: "2026-01-01T00:24:30.000Z" })],
    });
    const authority = bindInformationSufficiencyReceiptAuthorityV2(
      profileReceipt.profile,
      profileReceipt.receipt,
    );
    if (authority.kind !== "PROFILE_RECEIPT") throw new Error("expected profile receipt");

    const artifact = buildExactMarketUnderstandingArtifactV1({
      authority,
      organizationId: "org-a",
      accountId: "account-a",
      symbol: "BTC/USDT",
      analyticalTimeframe: "1m",
      evaluatedAt,
      features,
      questionEvaluations: understanding.questionEvaluations,
    });

    expect(artifact.claims.find((claim) => claim.marketQuestionId === "Q_WHAT_HAPPENING"))
      .toMatchObject({
        claimState: "SUPPORTED",
        claimKind: "OBSERVED_FACT",
        dependencies: [
          expect.objectContaining({
            disposition: "CONSUMED",
            evidence: expect.objectContaining({ evidenceId: "evidence-price-1" }),
          }),
        ],
      });
    expect(artifact.claims.find((claim) => claim.marketQuestionId === "Q_DEPLOY_CAPITAL"))
      .toMatchObject({
        claimState: "NOT_APPLICABLE",
        claimKind: "UNRESOLVED",
        answerSummary: "outside_market_understanding_authority",
      });
    expect(artifact.authority.createsForecastAuthority).toBe(false);
    expect(artifact.authority.createsDecisionAuthority).toBe(false);
    expect(artifact.authority.createsExecutionAuthority).toBe(false);
    expect(artifact.authority.createsCapitalAuthority).toBe(false);

    expect(() =>
      buildExactMarketUnderstandingArtifactV1({
        authority,
        organizationId: "other-org",
        accountId: "account-a",
        symbol: "BTC/USDT",
        analyticalTimeframe: "1m",
        evaluatedAt,
        features,
        questionEvaluations: understanding.questionEvaluations,
      }),
    ).toThrow(/runtimeScope/);
  });

  it("preserves unavailable receipt evidence instead of forcing a question answer", () => {
    const fixture = loadFixtureBars();
    const evaluatedAt = fixture.bars.at(-1)!.barCloseTime;
    const fusedContext = buildReplayFusedContext({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      instrumentId: "BTC/USDT",
    });
    const features = computeFeatureSnapshot({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
    });
    const understanding = buildMarketUnderstandingBridge({ fusedContext, features });
    const profileReceipt = makeUnderstandingProfileReceipt({ pitAnchor: evaluatedAt, evidence: [] });
    const authority = bindInformationSufficiencyReceiptAuthorityV2(
      profileReceipt.profile,
      profileReceipt.receipt,
    );
    if (authority.kind !== "PROFILE_RECEIPT") throw new Error("expected profile receipt");
    const artifact = buildExactMarketUnderstandingArtifactV1({
      authority,
      organizationId: "org-a",
      accountId: "account-a",
      symbol: "BTC/USDT",
      analyticalTimeframe: "1m",
      evaluatedAt,
      features,
      questionEvaluations: understanding.questionEvaluations,
    });

    expect(artifact.claims.find((claim) => claim.marketQuestionId === "Q_WHAT_HAPPENING"))
      .toMatchObject({
        claimState: "UNAVAILABLE",
        claimKind: "UNRESOLVED",
        answerSummary: "question_evidence_unavailable",
        missingExpectedEvidence: [expect.objectContaining({ terminalStatus: "UNAVAILABLE" })],
      });
    expect(artifact.evidenceUsed).toEqual([]);
  });

  it("keeps unused accepted evidence and legacy caller summaries outside causal lineage", () => {
    const fixture = loadFixtureBars();
    const evaluatedAt = fixture.bars.at(-1)!.barCloseTime;
    const fusedContext = buildReplayFusedContext({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      instrumentId: "BTC/USDT",
    });
    const features = computeFeatureSnapshot({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
    });
    const understanding = buildMarketUnderstandingBridge({ fusedContext, features });
    const primary = makeUnderstandingEvidence({ availableAt: "2026-01-01T00:24:30.000Z" });
    const extra = makeUnderstandingEvidence({
      evidenceId: "evidence-price-2",
      sourceId: "00000000-0000-4000-8000-000000000051",
      observationId: "00000000-0000-4000-8000-000000000052",
      observationContentDigest: "5".repeat(64),
      trustAsOfReceiptId: "6".repeat(64),
      trustRevisionId: "00000000-0000-4000-8000-000000000053",
      trustRevisionContentDigest: "7".repeat(64),
      dependenceGroup: "unused-independent-price",
      availableAt: "2026-01-01T00:24:20.000Z",
    });
    const first = makeUnderstandingProfileReceipt({ pitAnchor: evaluatedAt, evidence: [primary] });
    const withUnused = makeUnderstandingProfileReceipt({
      pitAnchor: evaluatedAt,
      evidence: [primary, extra],
    });
    const build = (
      selected: ReturnType<typeof makeUnderstandingProfileReceipt>,
      questionEvaluations = understanding.questionEvaluations,
    ) => {
      const authority = bindInformationSufficiencyReceiptAuthorityV2(
        selected.profile,
        selected.receipt,
      );
      if (authority.kind !== "PROFILE_RECEIPT") throw new Error("expected profile receipt");
      return buildExactMarketUnderstandingArtifactV1({
        authority,
        organizationId: "org-a",
        accountId: "account-a",
        symbol: "BTC/USDT",
        analyticalTimeframe: "1m",
        evaluatedAt,
        features,
        questionEvaluations,
      });
    };
    const firstArtifact = build(first);
    const unusedArtifact = build(withUnused);
    const firstWhat = firstArtifact.claims.find(
      (claim) => claim.marketQuestionId === "Q_WHAT_HAPPENING",
    )!;
    const unusedWhat = unusedArtifact.claims.find(
      (claim) => claim.marketQuestionId === "Q_WHAT_HAPPENING",
    )!;

    expect(unusedWhat.dependencies.filter((entry) => entry.disposition === "CONSUMED"))
      .toHaveLength(1);
    expect(unusedWhat.dependencies.find((entry) => entry.evidence.evidenceId === extra.evidenceId))
      .toMatchObject({ disposition: "IGNORED" });
    expect(unusedWhat.causalLineageDigest).toBe(firstWhat.causalLineageDigest);
    expect(unusedWhat.contentDigest).not.toBe(firstWhat.contentDigest);

    const callerMutated = understanding.questionEvaluations.map((evaluation) =>
      evaluation.questionId === "Q_CROSS_VENUE"
        ? { ...evaluation, answerSummary: "caller_controlled_excluded_lane" }
        : evaluation,
    );
    const baselineCrossVenue = firstArtifact.claims.find(
      (claim) => claim.marketQuestionId === "Q_CROSS_VENUE",
    )!;
    const mutatedCrossVenue = build(first, callerMutated).claims.find(
      (claim) => claim.marketQuestionId === "Q_CROSS_VENUE",
    )!;
    expect(mutatedCrossVenue.causalLineageDigest).toBe(baselineCrossVenue.causalLineageDigest);
    expect(mutatedCrossVenue.answerSummary).toBe("question_requirement_not_declared");
  });

  it("binds computed answers and only their consumed feature and reconstruction inputs", () => {
    const fixture = loadFixtureBars();
    const evaluatedAt = fixture.bars.at(-1)!.barCloseTime;
    const fusedContext = buildReplayFusedContext({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      instrumentId: "BTC/USDT",
    });
    const features = computeFeatureSnapshot({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
    });
    const reconstruction = buildReconstructionSnapshot({
      bars1m: fixture.bars,
      evaluatedAt,
      fusedContext,
    });
    const understanding = buildMarketUnderstandingBridge({
      fusedContext,
      features,
      reconstruction,
    });
    const selected = makeUnderstandingProfileReceipt({
      pitAnchor: evaluatedAt,
      requirements: [
        makeUnderstandingRequirement(),
        makeUnderstandingRequirement({
          id: "liquidity-state",
          questionId: "Q_EXECUTION_LIQUIDITY",
        }),
      ],
      evidence: [makeUnderstandingEvidence({ availableAt: "2026-01-01T00:24:30.000Z" })],
    });
    const authority = bindInformationSufficiencyReceiptAuthorityV2(
      selected.profile,
      selected.receipt,
    );
    if (authority.kind !== "PROFILE_RECEIPT") throw new Error("expected profile receipt");
    const build = (input: {
      selectedFeatures?: typeof features;
      selectedReconstruction?: typeof reconstruction;
      questionEvaluations?: typeof understanding.questionEvaluations;
    }) =>
      buildExactMarketUnderstandingArtifactV1({
        authority,
        organizationId: "org-a",
        accountId: "account-a",
        symbol: "BTC/USDT",
        analyticalTimeframe: "1m",
        evaluatedAt,
        features: input.selectedFeatures ?? features,
        reconstruction: input.selectedReconstruction ?? reconstruction,
        questionEvaluations: input.questionEvaluations ?? understanding.questionEvaluations,
      });
    const digestFor = (
      artifact: ReturnType<typeof build>,
      questionId: (typeof CANONICAL_MARKET_QUESTION_IDS)[number],
    ) => artifact.claims.find((claim) => claim.marketQuestionId === questionId)!.causalLineageDigest;

    const baseline = build({});
    const independentlyComputedFeatures = computeFeatureSnapshot({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
    });
    expect(independentlyComputedFeatures.featureSetId).not.toBe(features.featureSetId);
    const independentlyComputed = build({ selectedFeatures: independentlyComputedFeatures });
    expect(digestFor(independentlyComputed, "Q_WHAT_HAPPENING")).toBe(
      digestFor(baseline, "Q_WHAT_HAPPENING"),
    );
    expect(digestFor(independentlyComputed, "Q_LIQUIDITY")).toBe(
      digestFor(baseline, "Q_LIQUIDITY"),
    );
    expect(digestFor(independentlyComputed, "Q_DATA_TRUST")).toBe(
      digestFor(baseline, "Q_DATA_TRUST"),
    );
    const answerMutated = build({
      questionEvaluations: understanding.questionEvaluations.map((evaluation) =>
        evaluation.questionId === "Q_WHAT_HAPPENING"
          ? { ...evaluation, answerSummary: `${evaluation.answerSummary}_mutated` }
          : evaluation,
      ),
    });
    expect(digestFor(answerMutated, "Q_WHAT_HAPPENING")).not.toBe(
      digestFor(baseline, "Q_WHAT_HAPPENING"),
    );
    expect(digestFor(answerMutated, "Q_LIQUIDITY")).toBe(digestFor(baseline, "Q_LIQUIDITY"));

    const spreadMutated = build({
      selectedFeatures: {
        ...features,
        features: { ...features.features, spreadBps: "49" },
      },
    });
    expect(digestFor(spreadMutated, "Q_LIQUIDITY")).not.toBe(
      digestFor(baseline, "Q_LIQUIDITY"),
    );
    expect(digestFor(spreadMutated, "Q_WHAT_HAPPENING")).toBe(
      digestFor(baseline, "Q_WHAT_HAPPENING"),
    );

    const reconstructionMutated = assembleReconstructionSnapshot({
      instrumentId: reconstruction.instrumentId,
      evaluatedAt: reconstruction.evaluatedAt,
      marketStructure: reconstruction.marketStructure,
      liquidityStructure: reconstruction.liquidityStructure,
      trendStructure: {
        ...reconstruction.trendStructure,
        regimeBias: reconstruction.trendStructure.regimeBias === "TREND" ? "RANGE" : "TREND",
      },
      volatilityStructure: reconstruction.volatilityStructure,
      participationStructure: reconstruction.participationStructure,
      contextStructure: reconstruction.contextStructure,
    });
    const reconstructionChanged = build({ selectedReconstruction: reconstructionMutated });
    expect(digestFor(reconstructionChanged, "Q_WHAT_HAPPENING")).not.toBe(
      digestFor(baseline, "Q_WHAT_HAPPENING"),
    );
    expect(digestFor(reconstructionChanged, "Q_LIQUIDITY")).toBe(
      digestFor(baseline, "Q_LIQUIDITY"),
    );

    expect(() =>
      build({
        selectedReconstruction: { ...reconstruction, contentDigest: "0".repeat(64) },
      }),
    ).toThrow(/reconstructionContentDigest/);
  });

  it("does not promote a rejected untrusted contradiction into causal conflict", () => {
    const fixture = loadFixtureBars();
    const evaluatedAt = fixture.bars.at(-1)!.barCloseTime;
    const fusedContext = buildReplayFusedContext({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      instrumentId: "BTC/USDT",
    });
    const features = computeFeatureSnapshot({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
    });
    const understanding = buildMarketUnderstandingBridge({ fusedContext, features });
    const rejected = makeUnderstandingEvidence({
      availableAt: "2026-01-01T00:24:30.000Z",
      contradiction: "UNRESOLVED",
      contradictionGroup: "untrusted-conflict",
      trust: "UNTRUSTED",
      trustScore: 0,
    });
    const selected = makeUnderstandingProfileReceipt({
      pitAnchor: evaluatedAt,
      evidence: [rejected],
    });
    const authority = bindInformationSufficiencyReceiptAuthorityV2(
      selected.profile,
      selected.receipt,
    );
    if (authority.kind !== "PROFILE_RECEIPT") throw new Error("expected profile receipt");
    const artifact = buildExactMarketUnderstandingArtifactV1({
      authority,
      organizationId: "org-a",
      accountId: "account-a",
      symbol: "BTC/USDT",
      analyticalTimeframe: "1m",
      evaluatedAt,
      features,
      questionEvaluations: understanding.questionEvaluations,
    });
    const claim = artifact.claims.find(
      (candidate) => candidate.marketQuestionId === "Q_WHAT_HAPPENING",
    )!;

    expect(claim.claimState).toBe("UNKNOWN");
    expect(claim.dependencies).toEqual([
      expect.objectContaining({
        disposition: "IGNORED",
        evidence: expect.objectContaining({ evidenceId: rejected.evidenceId }),
      }),
    ]);
    expect(artifact.evidenceUsed).toEqual([]);
  });

  it("retains below-floor accepted evidence as partial and makes record-only conflict order-independent", () => {
    const fixture = loadFixtureBars();
    const evaluatedAt = fixture.bars.at(-1)!.barCloseTime;
    const fusedContext = buildReplayFusedContext({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      instrumentId: "BTC/USDT",
    });
    const features = computeFeatureSnapshot({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
    });
    const understanding = buildMarketUnderstandingBridge({ fusedContext, features });
    const build = (selected: ReturnType<typeof makeUnderstandingProfileReceipt>) => {
      const authority = bindInformationSufficiencyReceiptAuthorityV2(
        selected.profile,
        selected.receipt,
      );
      if (authority.kind !== "PROFILE_RECEIPT") throw new Error("expected profile receipt");
      return buildExactMarketUnderstandingArtifactV1({
        authority,
        organizationId: "org-a",
        accountId: "account-a",
        symbol: "BTC/USDT",
        analyticalTimeframe: "1m",
        evaluatedAt,
        features,
        questionEvaluations: understanding.questionEvaluations,
      });
    };

    const partialFixture = makeUnderstandingProfileReceipt({
      pitAnchor: evaluatedAt,
      requirements: [makeUnderstandingRequirement({ minimumIndependentGroups: 2 })],
      evidence: [makeUnderstandingEvidence({ availableAt: "2026-01-01T00:24:30.000Z" })],
    });
    expect(partialFixture.receipt.requirementReceipts[0]).toMatchObject({
      terminalStatus: "INSUFFICIENT_BLOCKING",
      acceptedEvidenceIds: ["evidence-price-1"],
    });
    const partialClaim = build(partialFixture).claims.find(
      (claim) => claim.marketQuestionId === "Q_WHAT_HAPPENING",
    )!;
    expect(partialClaim).toMatchObject({
      claimState: "PARTIALLY_SUPPORTED",
      dependencies: [expect.objectContaining({ disposition: "CONSUMED" })],
    });

    const support = makeUnderstandingEvidence({
      evidenceId: "a-support",
      availableAt: "2026-01-01T00:24:30.000Z",
    });
    const conflict = makeUnderstandingEvidence({
      evidenceId: "z-conflict",
      sourceId: "00000000-0000-4000-8000-000000000061",
      observationId: "00000000-0000-4000-8000-000000000062",
      observationContentDigest: "8".repeat(64),
      trustAsOfReceiptId: "9".repeat(64),
      trustRevisionId: "00000000-0000-4000-8000-000000000063",
      trustRevisionContentDigest: "a".repeat(64),
      dependenceGroup: "record-only-conflict",
      contradiction: "CONTRADICTS",
      contradictionGroup: "record-only",
      availableAt: "2026-01-01T00:24:20.000Z",
    });
    const recordOnly = makeUnderstandingProfileReceipt({
      pitAnchor: evaluatedAt,
      requirements: [makeUnderstandingRequirement({ contradictionPolicy: "RECORD_ONLY" })],
      evidence: [support, conflict],
    });
    expect(recordOnly.receipt.requirementReceipts[0]?.terminalStatus).toBe(
      "ANSWERED_SUFFICIENTLY",
    );
    const conflictedClaim = build(recordOnly).claims.find(
      (claim) => claim.marketQuestionId === "Q_WHAT_HAPPENING",
    )!;
    expect(conflictedClaim.claimState).toBe("CONFLICTED");
    expect(
      conflictedClaim.dependencies
        .filter((entry) => entry.disposition === "CONSUMED")
        .map((entry) => [entry.evidence.evidenceId, entry.role]),
    ).toEqual([
      ["a-support", "SUPPORTING"],
      ["z-conflict", "CONTRADICTING"],
    ]);
  });
});

function minimalUnderstanding(
  overrides: Partial<MarketUnderstandingSnapshot> = {},
): MarketUnderstandingSnapshot {
  return {
    schemaVersion: MARKET_UNDERSTANDING_SCHEMA_VERSION,
    instrumentId: "BTC/USDT",
    evaluatedAt: "2026-01-01T00:25:00.000Z",
    questionEvaluations: [],
    knowledgeGaps: [],
    confidenceAttribution: {
      priorConfidence: 0.8,
      finalConfidence: 0.8,
      confidenceDelta: 0,
      contributors: [],
    },
    reasoningInputs: {
      evidenceUsed: [],
      evidenceIgnored: [],
      conflicts: [],
      unknowns: [],
    },
    mtfBackdrop: {},
    mtfAlignment: "ALIGNED",
    regimeHint: "TRENDING",
    crossVenue: {
      agreement: "AGREE",
      binanceDeltaBps: 0,
      bybitDeltaBps: 0,
      triangulationConfidence: 0.9,
      reasonCodes: [],
    },
    globalContext: "NEUTRAL",
    crowdPsychology: "NEUTRAL",
    liquiditySufficiency: "SUFFICIENT",
    dataQualitySufficient: true,
    dataQualityReasonCodes: [],
    asianCorridorPresent: false,
    spotPosture: "TRADE",
    postureRationale: [],
    understandingConfidence: 0.8,
    ...overrides,
  };
}

describe("DEE-622 legacy Understanding telemetry boundary", () => {
  function buildMsvForPosture(understanding?: MarketUnderstandingSnapshot) {
    const fixture = loadFixtureBars();
    const evaluatedAt = fixture.bars.at(-1)!.barCloseTime;
    const fusedContext = buildReplayFusedContext({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      instrumentId: "BTC/USDT",
    });
    const features = computeFeatureSnapshot({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
    });
    return buildMsvEnvelope({ features, fusedContext, understanding });
  }

  it("does not let STRESSED/REDUCE_RISK posture affect CDE authority", () => {
    const baseline = buildMsvForPosture(minimalUnderstanding());
    const msv = buildMsvForPosture(
      minimalUnderstanding({
        regimeHint: "STRESSED",
        spotPosture: "REDUCE_RISK",
      }),
    );

    expect(msv.derived).toEqual(baseline.derived);
    expect(msv.understanding?.spotPosture).toBe("REDUCE_RISK");
  });

  it("does not let PRESERVE_CAPITAL posture affect CDE authority", () => {
    const baseline = buildMsvForPosture(minimalUnderstanding());
    const msv = buildMsvForPosture(
      minimalUnderstanding({
        regimeHint: "STRESSED",
        spotPosture: "PRESERVE_CAPITAL",
        postureRationale: ["POSTURE_PRESERVE_CAPITAL"],
      }),
    );

    expect(msv.derived).toEqual(baseline.derived);
    expect(msv.understanding?.spotPosture).toBe("PRESERVE_CAPITAL");
  });

  it("does not let NO_TRADE or aggregate data-quality posture affect CDE authority", () => {
    const baseline = buildMsvForPosture(minimalUnderstanding());
    const msv = buildMsvForPosture(
      minimalUnderstanding({
        dataQualitySufficient: false,
        spotPosture: "NO_TRADE",
        postureRationale: ["POSTURE_DATA_QUALITY_INSUFFICIENT"],
      }),
    );

    expect(msv.derived).toEqual(baseline.derived);
    expect(msv.understanding?.spotPosture).toBe("NO_TRADE");
  });
});
