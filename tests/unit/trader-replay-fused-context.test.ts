import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildReplayFusedContext,
  buildReplayFusedContextFromSnapshot,
  type ReplayProviderSidecar,
} from "@/lib/trader/market-data/replay-fused-context-builder";
import type { ReplayProviderSidecarV1 } from "@/lib/trader/market-data/replay/provider-sidecar-types";
import { buildMarketSnapshot } from "@/lib/trader/market-data/market-snapshot";
import {
  defineMarketUnderstandingArtifactV1,
  defineUnderstandingClaimV1,
  type MarketUnderstandingArtifactV1,
} from "@/lib/trader/intelligence/market-understanding-evidence-attribution-v1";
import { CANONICAL_MARKET_QUESTION_IDS } from "@/lib/trader/intelligence/market-understanding.types";
import {
  buildMarketUnderstandingReplayIdentityV1,
  computeUnderstandingArtifactReproDigest,
  computeUnderstandingCausalReproDigest,
} from "@/lib/trader/research/replay-repro-digest";
import {
  makeUnderstandingEvidence,
  makeUnderstandingProfileReceipt,
  understandingTestDigest,
} from "@/tests/unit/helpers/market-understanding-evidence";
import { canonicalJsonString } from "@/lib/trader/research/digest";

function rehashArtifact<T extends { contentDigest: string }>(value: T): T {
  const body = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "contentDigest"),
  );
  return {
    ...value,
    contentDigest: createHash("sha256").update(canonicalJsonString(body), "utf8").digest("hex"),
  };
}

function exactHash(value: unknown): string {
  return createHash("sha256").update(canonicalJsonString(value), "utf8").digest("hex");
}

function rehashClaim(
  claim: MarketUnderstandingArtifactV1["claims"][number],
): MarketUnderstandingArtifactV1["claims"][number] {
  const lineageScope = {
    organizationId: claim.scope.organizationId,
    accountId: claim.scope.accountId,
    purpose: claim.scope.purpose,
    symbol: claim.scope.symbol,
    venue: claim.scope.venue,
    analyticalTimeframe: claim.scope.analyticalTimeframe,
    horizon: claim.scope.horizon,
    pitAnchor: claim.scope.pitAnchor,
  };
  const causalLineageDigest = exactHash({
    scope: lineageScope,
    marketQuestionId: claim.marketQuestionId,
    informationQuestionId: claim.informationQuestionId,
    claimState: claim.claimState,
    claimKind: claim.claimKind,
    answerSummary: claim.answerSummary,
    computationInputs: claim.computationInputs,
    dependencies: claim.dependencies.filter(
      (dependency) => dependency.disposition === "CONSUMED",
    ),
    effectiveDependenceGroups: claim.effectiveDependenceGroups,
    missingExpectedEvidence: claim.missingExpectedEvidence,
    questionProfileContentDigest: claim.questionProfileContentDigest,
    derivationDefinitionContentDigest: claim.derivationDefinitionContentDigest,
  });
  const withoutContentDigest = Object.fromEntries(
    Object.entries({ ...claim, causalLineageDigest }).filter(([key]) => key !== "contentDigest"),
  );
  return {
    ...claim,
    causalLineageDigest,
    contentDigest: exactHash(withoutContentDigest),
  };
}

function rehashFullArtifact(
  artifact: MarketUnderstandingArtifactV1,
): MarketUnderstandingArtifactV1 {
  return rehashArtifact({
    ...artifact,
    claims: artifact.claims.map(rehashClaim),
  });
}

function makeReplayUnderstandingArtifact(unusedObservationDigest: string) {
  const unused = makeUnderstandingEvidence({
    evidenceId: "unused-news",
    evidenceFamily: "news",
    providerId: "coindesk_rss",
    sourceId: "00000000-0000-4000-8000-000000000011",
    observationId: "00000000-0000-4000-8000-000000000012",
    observationKind: "news_headline",
    observationContentDigest: unusedObservationDigest,
    trustAsOfReceiptId: understandingTestDigest("unused-trust-receipt"),
    trustRevisionId: "00000000-0000-4000-8000-000000000013",
    trustRevisionContentDigest: understandingTestDigest("unused-trust-revision"),
    dependenceGroup: "unused-news",
    epistemicRole: "CORROBORATING",
  });
  const fixture = makeUnderstandingProfileReceipt({
    evidence: [makeUnderstandingEvidence(), unused],
  });
  return defineMarketUnderstandingArtifactV1({
    ...fixture,
    evaluatedAt: fixture.receipt.pitAnchor,
    claims: CANONICAL_MARKET_QUESTION_IDS.map((marketQuestionId) => {
      const whatQuestion = marketQuestionId === "Q_WHAT_HAPPENING";
      const capitalQuestion =
        marketQuestionId === "Q_DEPLOY_CAPITAL" || marketQuestionId === "Q_PRESERVE_CAPITAL";
      return defineUnderstandingClaimV1({
        profile: fixture.profile,
        receipt: fixture.receipt,
        computationInputs: [
          {
            path: `question.${marketQuestionId.toLowerCase()}`,
            contentDigest: understandingTestDigest(`replay:${marketQuestionId}`),
          },
        ],
        marketQuestionId,
        claimState: whatQuestion
          ? "SUPPORTED"
          : capitalQuestion
            ? "NOT_APPLICABLE"
            : "UNAVAILABLE",
        claimKind: whatQuestion ? "OBSERVED_FACT" : "UNRESOLVED",
        answerSummary: whatQuestion
          ? "exact_price_state"
          : capitalQuestion
            ? "outside_market_understanding_authority"
            : "question_receipt_unavailable",
        consumedEvidence: whatQuestion
          ? [
              {
                evidenceId: "evidence-price-1",
                role: "SUPPORTING" as const,
                dependencyPaths: ["question.q_what_happening"],
              },
            ]
          : [],
        irrelevantEvidenceIds: ["unused-news"],
      });
    }),
  });
}

function loadFixtureBars() {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader/btcusdt-1m-mean-reversion.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as {
    bars: import("@/lib/trader/intelligence/types").Bar[];
    latestQuote: import("@/lib/trader/intelligence/types").Quote;
  };
}

function loadSidecar(): ReplayProviderSidecar {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader/m9-provider-sidecar.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as ReplayProviderSidecar;
}

describe("PR2.6 replay fused context builder", () => {
  it("builds deterministic fused context from replay bars", () => {
    const fixture = loadFixtureBars();
    const evaluatedAt = fixture.bars.at(-1)!.barCloseTime;

    const first = buildReplayFusedContext({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      instrumentId: "BTC/USDT",
    });
    const second = buildReplayFusedContext({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      instrumentId: "BTC/USDT",
    });

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.mtfBars["1m"]).toBeDefined();
    expect(first.mtfBars["15m"]).toBeDefined();
    expect(first.crossVenueTriangulation).toBeDefined();
  });

  it("merges provider sidecar entries by evaluatedAt", () => {
    const fixture = loadFixtureBars();
    const sidecar = loadSidecar() as ReplayProviderSidecarV1;
    const evaluatedAt = sidecar.entries[0]!.evaluatedAt;

    const fused = buildReplayFusedContext({
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt,
      instrumentId: "BTC/USDT",
      providerSidecar: sidecar,
    });

    expect(fused.fearGreed).toBeDefined();
    expect(fused.globalMarket).toBeDefined();
    expect(fused.crossVenueTriangulation?.binanceDeltaBps).not.toBeNull();
    expect(fused.crossVenueTriangulation?.bybitDeltaBps).not.toBeNull();
  });

  it("builds from market snapshot helper", () => {
    const fixture = loadFixtureBars();
    const snapshot = buildMarketSnapshot(fixture.bars, fixture.latestQuote, 0, "replay-test");
    const fused = buildReplayFusedContextFromSnapshot(snapshot);
    expect(fused.instrumentId).toBe("BTC/USDT");
    expect(fused.schemaVersion).toBe("waia.trader.fused_context.v2");
  });

  it("reproduces exact question lineage while isolating unused evidence revisions", () => {
    const first = makeReplayUnderstandingArtifact(understandingTestDigest("unused-v1"));
    const unusedRevision = makeReplayUnderstandingArtifact(understandingTestDigest("unused-v2"));

    expect(computeUnderstandingArtifactReproDigest(first)).toBe(first.contentDigest);
    expect(computeUnderstandingArtifactReproDigest(unusedRevision)).not.toBe(first.contentDigest);
    expect(computeUnderstandingCausalReproDigest(unusedRevision)).toBe(
      computeUnderstandingCausalReproDigest(first),
    );

    const identity = buildMarketUnderstandingReplayIdentityV1(first);
    expect(identity.understandingContentDigest).toBe(first.contentDigest);
    expect(identity.causalReproDigest).toBe(computeUnderstandingCausalReproDigest(first));
    expect(identity.questionLineage).toHaveLength(12);
    expect(
      identity.questionLineage.find(
        (claim) => claim.marketQuestionId === "Q_WHAT_HAPPENING",
      ),
    ).toMatchObject({
      claimContentDigest: first.claims.find(
        (claim) => claim.marketQuestionId === "Q_WHAT_HAPPENING",
      )?.contentDigest,
      causalLineageDigest: first.claims.find(
        (claim) => claim.marketQuestionId === "Q_WHAT_HAPPENING",
      )?.causalLineageDigest,
    });

    expect(() =>
      buildMarketUnderstandingReplayIdentityV1({
        ...first,
        contentDigest: "0".repeat(64),
      }),
    ).toThrow(/artifactContent/);

    expect(() =>
      buildMarketUnderstandingReplayIdentityV1(
        rehashArtifact({
          ...first,
          evaluatedAt: "2030-01-01T00:00:00.000Z",
        }),
      ),
    ).toThrow(/artifactContract/);
    expect(() =>
      buildMarketUnderstandingReplayIdentityV1(
        rehashArtifact({
          ...first,
          schemaVersion: "forged-artifact-v9",
        }) as unknown as typeof first,
      ),
    ).toThrow(/artifactContract/);

    const ignoredEvidence = first.evidenceIgnored[0]!;
    const invalidIgnoredEvidence = {
      ...ignoredEvidence,
      trustRevisionContentDigest: "not-a-digest",
    };
    expect(() =>
      buildMarketUnderstandingReplayIdentityV1(
        rehashFullArtifact({
          ...first,
          evidenceIgnored: [invalidIgnoredEvidence],
          claims: first.claims.map((claim) => ({
            ...claim,
            dependencies: claim.dependencies.map((dependency) =>
              dependency.evidence.evidenceId === ignoredEvidence.evidenceId
                ? { ...dependency, evidence: invalidIgnoredEvidence }
                : dependency,
            ),
          })),
        }),
      ),
    ).toThrow(/evidenceIdentity/);

    expect(() =>
      buildMarketUnderstandingReplayIdentityV1(
        rehashFullArtifact({
          ...first,
          claims: first.claims.map((claim) => ({
            ...claim,
            dependencies: claim.dependencies.map((dependency) =>
              dependency.disposition === "IGNORED"
                ? { ...dependency, disposition: "FORGED" }
                : dependency,
            ) as typeof claim.dependencies,
          })),
        }),
      ),
    ).toThrow(/questionLineage/);

    expect(() =>
      buildMarketUnderstandingReplayIdentityV1(
        rehashFullArtifact({
          ...first,
          claims: first.claims.map((claim) => ({
            ...claim,
            dependencies: [...claim.dependencies].reverse(),
          })),
        }),
      ),
    ).toThrow(/questionLineage/);

    expect(() =>
      buildMarketUnderstandingReplayIdentityV1(
        rehashFullArtifact({
          ...first,
          claims: first.claims.map((claim) => ({
            ...claim,
            dependencies: claim.dependencies.map((dependency) =>
              dependency.disposition === "CONSUMED"
                ? { ...dependency, role: "FORGED_ROLE" }
                : dependency,
            ) as typeof claim.dependencies,
          })),
        }),
      ),
    ).toThrow(/questionLineage/);

    const consumedPriceDependency = first.claims
      .find((claim) => claim.marketQuestionId === "Q_WHAT_HAPPENING")!
      .dependencies.find((dependency) => dependency.disposition === "CONSUMED")!;
    expect(() =>
      buildMarketUnderstandingReplayIdentityV1(
        rehashFullArtifact({
          ...first,
          claims: first.claims.map((claim) =>
            claim.marketQuestionId === "Q_DEPLOY_CAPITAL"
              ? {
                  ...claim,
                  claimState: "SUPPORTED",
                  claimKind: "OBSERVED_FACT",
                  effectiveDependenceGroups: [consumedPriceDependency.evidence.dependenceGroup],
                  dependencies: claim.dependencies.map((dependency) =>
                    dependency.evidence.evidenceId ===
                    consumedPriceDependency.evidence.evidenceId
                      ? consumedPriceDependency
                      : dependency,
                  ),
                }
              : claim,
          ) as typeof first.claims,
        }),
      ),
    ).toThrow(/questionLineage/);

    const malformedScope = {
      ...first.scope,
      organizationId: "",
      profileContentDigest: "bad-digest",
      pitAnchor: "not-a-date",
    };
    expect(() =>
      buildMarketUnderstandingReplayIdentityV1(
        rehashFullArtifact({
          ...first,
          scope: malformedScope,
          evaluatedAt: "not-a-date",
          claims: first.claims.map((claim) => ({ ...claim, scope: malformedScope })),
        }),
      ),
    ).toThrow(/artifactContract/);

    expect(() =>
      buildMarketUnderstandingReplayIdentityV1(
        rehashFullArtifact({
          ...first,
          claims: first.claims.map((claim) =>
            claim.marketQuestionId === "Q_WHAT_HAPPENING"
              ? {
                  ...claim,
                  missingExpectedEvidence: [
                    {
                      requirementId: "forged",
                      informationQuestionId: "FORGED",
                      classification: "FORGED",
                      terminalStatus: "FORGED",
                      blocking: "yes",
                      matchedEvidenceIds: [],
                      acceptedEvidenceIds: [],
                      reasonCodes: ["FORGED"],
                    },
                  ],
                }
              : claim,
          ) as typeof first.claims,
        }),
      ),
    ).toThrow(/questionLineage/);

    const blankTrustRevision = { ...ignoredEvidence, trustRevisionId: "" };
    expect(() =>
      buildMarketUnderstandingReplayIdentityV1(
        rehashFullArtifact({
          ...first,
          evidenceIgnored: [blankTrustRevision],
          claims: first.claims.map((claim) => ({
            ...claim,
            dependencies: claim.dependencies.map((dependency) =>
              dependency.evidence.evidenceId === ignoredEvidence.evidenceId
                ? { ...dependency, evidence: blankTrustRevision }
                : dependency,
            ),
          })),
        }),
      ),
    ).toThrow(/evidenceIdentity/);

    const forgedProfileScope = {
      ...first.scope,
      profileId: "forged-profile-id",
    };
    expect(() =>
      buildMarketUnderstandingReplayIdentityV1(
        rehashFullArtifact({
          ...first,
          scope: forgedProfileScope,
          claims: first.claims.map((claim) => ({
            ...claim,
            scope: forgedProfileScope,
          })),
        }),
      ),
    ).toThrow(/artifactContract/);

    expect(() =>
      buildMarketUnderstandingReplayIdentityV1(
        rehashFullArtifact({
          ...first,
          claims: first.claims.map((claim) =>
            claim.marketQuestionId === "Q_WHAT_HAPPENING"
              ? { ...claim, claimKind: "EVIDENCE_SUPPORTED_CAUSAL_ATTRIBUTION" }
              : claim,
          ),
        }),
      ),
    ).toThrow(/questionLineage/);

    expect(() =>
      buildMarketUnderstandingReplayIdentityV1(
        rehashFullArtifact({
          ...first,
          claims: first.claims.map((claim) =>
            claim.marketQuestionId === "Q_WHAT_HAPPENING"
              ? {
                  ...claim,
                  missingExpectedEvidence: [
                    {
                      requirementId: "missing-price-state",
                      informationQuestionId: "Q_WHAT_HAPPENING",
                      classification: "MANDATORY",
                      terminalStatus: "UNAVAILABLE",
                      blocking: true,
                      matchedEvidenceIds: [],
                      acceptedEvidenceIds: [],
                      reasonCodes: ["NO_MATCHING_EVIDENCE"],
                    },
                  ],
                }
              : claim,
          ),
        }),
      ),
    ).toThrow(/questionLineage/);

    expect(() =>
      buildMarketUnderstandingReplayIdentityV1(
        rehashFullArtifact({
          ...first,
          claims: first.claims.map((claim) =>
            claim.marketQuestionId === "Q_WHY_HAPPENING"
              ? {
                  ...claim,
                  claimState: "SUPPORTED",
                  claimKind: "OBSERVED_FACT",
                  dependencies: claim.dependencies.map((dependency) =>
                    dependency.evidence.evidenceId ===
                    consumedPriceDependency.evidence.evidenceId
                      ? consumedPriceDependency
                      : dependency,
                  ),
                  effectiveDependenceGroups: [
                    consumedPriceDependency.evidence.dependenceGroup,
                  ],
                }
              : claim,
          ),
        }),
      ),
    ).toThrow(/questionLineage/);

    const duplicateObservationEvidence = {
      ...consumedPriceDependency.evidence,
      evidenceId: "evidence-price-2",
    };
    expect(() =>
      buildMarketUnderstandingReplayIdentityV1(
        rehashFullArtifact({
          ...first,
          evidenceUsed: [...first.evidenceUsed, duplicateObservationEvidence],
          claims: first.claims.map((claim) => ({
            ...claim,
            dependencies: [
              ...claim.dependencies,
              claim.marketQuestionId === "Q_WHAT_HAPPENING"
                ? {
                    disposition: "CONSUMED" as const,
                    role: "SUPPORTING" as const,
                    dependencyPaths: ["question.q_what_happening"],
                    evidence: duplicateObservationEvidence,
                  }
                : {
                    disposition: "IGNORED" as const,
                    role: null,
                    dependencyPaths: [],
                    evidence: duplicateObservationEvidence,
                  },
            ].sort((left, right) =>
              left.evidence.evidenceId.localeCompare(right.evidence.evidenceId),
            ),
          })),
        }),
      ),
    ).toThrow(/questionLineage/);

    const untrustedConsumedEvidence = {
      ...consumedPriceDependency.evidence,
      trust: "UNTRUSTED" as const,
      trustScore: 0,
      degradationReasonCodes: ["SOURCE_REVISION_MISMATCH"],
    };
    expect(() =>
      buildMarketUnderstandingReplayIdentityV1(
        rehashFullArtifact({
          ...first,
          evidenceUsed: first.evidenceUsed.map((evidence) =>
            evidence.evidenceId === untrustedConsumedEvidence.evidenceId
              ? untrustedConsumedEvidence
              : evidence,
          ),
          claims: first.claims.map((claim) => ({
            ...claim,
            dependencies: claim.dependencies.map((dependency) =>
              dependency.evidence.evidenceId === untrustedConsumedEvidence.evidenceId
                ? { ...dependency, evidence: untrustedConsumedEvidence }
                : dependency,
            ),
          })),
        }),
      ),
    ).toThrow(/artifactIdentity/);

    expect(() =>
      buildMarketUnderstandingReplayIdentityV1(
        rehashFullArtifact({
          ...first,
          claims: first.claims.map((claim) =>
            claim.marketQuestionId === "Q_WHAT_HAPPENING"
              ? ({
                  ...claim,
                  formula: "BUY_IF_PRICE",
                  createsCapitalAuthority: true,
                } as typeof claim)
              : claim,
          ),
        }),
      ),
    ).toThrow(/artifactIdentity/);

    const inheritedClaim = Object.assign(
      Object.create({ formula: "BUY_IF_PRICE", createsCapitalAuthority: true }),
      first.claims.find((claim) => claim.marketQuestionId === "Q_WHAT_HAPPENING")!,
    ) as MarketUnderstandingArtifactV1["claims"][number];
    expect(() =>
      buildMarketUnderstandingReplayIdentityV1(
        rehashArtifact({
          ...first,
          claims: first.claims.map((claim) =>
            claim.marketQuestionId === "Q_WHAT_HAPPENING" ? inheritedClaim : claim,
          ),
        }),
      ),
    ).toThrow(/runtimePrototype/);

    const hiddenAuthorityClaim = {
      ...first.claims.find((claim) => claim.marketQuestionId === "Q_WHAT_HAPPENING")!,
    };
    Object.defineProperty(hiddenAuthorityClaim, "createsCapitalAuthority", {
      value: true,
      enumerable: false,
    });
    expect(() =>
      buildMarketUnderstandingReplayIdentityV1(
        rehashArtifact({
          ...first,
          claims: first.claims.map((claim) =>
            claim.marketQuestionId === "Q_WHAT_HAPPENING" ? hiddenAuthorityClaim : claim,
          ),
        }),
      ),
    ).toThrow(/runtimeFieldShape/);

    const inheritedProfile = Object.assign(
      Object.create({ formula: "BUY_IF_PRICE", createsCapitalAuthority: true }),
      first.authenticatedProfile,
    );
    expect(() =>
      buildMarketUnderstandingReplayIdentityV1(
        rehashArtifact({
          ...first,
          authenticatedProfile: inheritedProfile,
        }),
      ),
    ).toThrow(/runtimePrototype/);

    const nonJsonClaim = {
      ...first.claims.find((claim) => claim.marketQuestionId === "Q_WHAT_HAPPENING")!,
      formula: () => "BUY_IF_PRICE",
      createsCapitalAuthority: undefined,
    } as MarketUnderstandingArtifactV1["claims"][number];
    expect(() =>
      buildMarketUnderstandingReplayIdentityV1(
        rehashArtifact({
          ...first,
          claims: first.claims.map((claim) =>
            claim.marketQuestionId === "Q_WHAT_HAPPENING" ? nonJsonClaim : claim,
          ),
        }),
      ),
    ).toThrow(/runtimeValueShape/);

    const accessorArtifact = JSON.parse(
      JSON.stringify(first),
    ) as MarketUnderstandingArtifactV1;
    const accessorClaim = accessorArtifact.claims.find(
      (claim) => claim.marketQuestionId === "Q_WHAT_HAPPENING",
    )!;
    const originalAnswerSummary = accessorClaim.answerSummary;
    let accessorCalls = 0;
    Object.defineProperty(accessorClaim, "answerSummary", {
      get: () => {
        accessorCalls += 1;
        return originalAnswerSummary;
      },
      enumerable: true,
    });
    expect(() => buildMarketUnderstandingReplayIdentityV1(accessorArtifact)).toThrow(
      /runtimeFieldShape/,
    );
    expect(accessorCalls).toBe(0);
  });
});
