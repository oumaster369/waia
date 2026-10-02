import { describe, expect, it } from "vitest";

import {
  OBSERVATION_SCHEMA_VERSION,
  type ObservationRecord,
} from "@/lib/trader/discovery/observation.types";
import { clusterStructureSignatures } from "@/lib/trader/discovery/structure-clusterer";
import {
  assertStructureClusterV2AppendRow,
  buildStructureSignatureKeyV2,
  readStoredStructureClusterPayload,
  StructureClusterContractError,
  tradeReferenceCountBandForCount,
} from "@/lib/trader/discovery/structure-cluster-contract";
import { buildResearchQuestion } from "@/lib/trader/discovery/research-question-builder";
import { ResearchQuestionKind } from "@/lib/trader/discovery/research-question.types";
import {
  buildResearchQuestionContentDigest,
  buildStructureClusterContentDigest,
  buildStructureClusterV2ContentDigest,
  serializeStructureClusterV1,
  serializeStructureClusterV2,
} from "@/lib/trader/discovery/serialize-discovery";
import {
  MEASURED_VOLATILITY_UNAVAILABLE,
  STRUCTURE_CLUSTER_SCHEMA_VERSION_V1,
  TRADE_REFERENCE_COUNT_BAND,
  TRADE_REFERENCE_COUNT_METRIC,
  type StructureClusterV1,
  type StructureClusterV2,
} from "@/lib/trader/discovery/structure.types";
import { RESEARCH_PROGRAM_BY_STRATEGY } from "@/lib/trader/research/evolution-cycle-mvp.types";
import type { ResearchRejectionRecord } from "@/lib/trader/research/research-rejection-record.types";
import { NoReinforcementGuardError } from "@/lib/trader/discovery/no-reinforcement-guard";
import type { ResearchCampaignRef } from "@/lib/trader/discovery/discovery.types";

const campaign: ResearchCampaignRef = {
  campaignId: "camp-1",
  campaignDigest: "digest-1",
  state: "ACTIVE",
};

const V1_DIGEST = "d92006f9107c1e053151d9f7bce0819f2de38291e823bded16108e389462eb02";
const V1_CANONICAL =
  '{"campaignRef":{"campaignDigest":"digest-1","campaignId":"camp-1","state":"ACTIVE"},"clusterId":"cluster-v1-fixture","contentDigest":"d92006f9107c1e053151d9f7bce0819f2de38291e823bded16108e389462eb02","createdAt":"2026-10-02T00:00:00.000Z","memberObservationRefs":["obs-1"],"schemaVersion":"waia.trader.discovery-structure-cluster.v1","signature":{"observationCount":1,"regimeLabel":"TREND_BULL","signatureKey":"TREND_BULL::low","tradeCount":1,"volBucket":"low"}}';

function observation(
  id: string,
  regimes: readonly string[],
  tradeCount: number,
): ObservationRecord {
  return {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    observationId: id,
    campaignRef: campaign,
    barWindow: {
      symbol: "BTCUSDT",
      interval: "1h",
      start: "2026-01-01T00:00:00.000Z",
      end: "2026-01-02T00:00:00.000Z",
      barCount: 20,
    },
    observedRegimes: regimes,
    tradeRefs: Array.from({ length: tradeCount }, (_, index) => ({
      fillId: `${id}-fill-${index}`,
      symbol: "BTCUSDT",
      executedAt: "2026-01-01T01:00:00.000Z",
      regimeLabel: null,
    })),
    patternRefs: [],
    eventRefs: [],
    contentDigest: `digest-${id}`,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function clusterFor(regime: string, tradeCount: number, id = "cluster-1"): StructureClusterV2 {
  const [cluster] = clusterStructureSignatures(
    { campaignRef: campaign, observations: [observation("obs-a", [regime], tradeCount)] },
    () => id,
    "2026-10-02T00:00:00.000Z",
  );
  if (!cluster) {
    throw new Error("expected a structure cluster");
  }
  return cluster;
}

function rejection(): ResearchRejectionRecord {
  return {
    recordBody: { strategyId: "desk-alpha", strategyVersion: "3" },
  } as ResearchRejectionRecord;
}

describe("discovery trade-reference count bands", () => {
  it("keeps the original count cutpoints", () => {
    expect(tradeReferenceCountBandForCount(0)).toBe(TRADE_REFERENCE_COUNT_BAND.le1);
    expect(tradeReferenceCountBandForCount(1)).toBe(TRADE_REFERENCE_COUNT_BAND.le1);
    expect(tradeReferenceCountBandForCount(2)).toBe(TRADE_REFERENCE_COUNT_BAND.from2To5);
    expect(tradeReferenceCountBandForCount(5)).toBe(TRADE_REFERENCE_COUNT_BAND.from2To5);
    expect(tradeReferenceCountBandForCount(6)).toBe(TRADE_REFERENCE_COUNT_BAND.gt5);
  });

  it("groups counts 0, 1, 2, 5, and 6 without inventing volatility", () => {
    let n = 0;
    const clusters = clusterStructureSignatures(
      {
        campaignRef: campaign,
        observations: [
          observation("obs-0", ["RANGE"], 0),
          observation("obs-1", ["RANGE"], 1),
          observation("obs-2", ["RANGE"], 2),
          observation("obs-5", ["RANGE"], 5),
          observation("obs-6", ["RANGE"], 6),
          observation("obs-empty", [], 4),
        ],
      },
      () => `cluster-${n++}`,
      "2026-10-02T00:00:00.000Z",
    );

    expect(clusters.map((cluster) => cluster.signature.tradeReferenceCountBand)).toEqual([
      TRADE_REFERENCE_COUNT_BAND.from2To5,
      TRADE_REFERENCE_COUNT_BAND.gt5,
      TRADE_REFERENCE_COUNT_BAND.le1,
    ]);
    expect(clusters.map((cluster) => cluster.signature.tradeCount)).toEqual([7, 6, 1]);
    expect(clusters.map((cluster) => cluster.signature.observationCount)).toEqual([2, 1, 2]);
    expect(clusters[2]?.memberObservationRefs).toEqual(["obs-0", "obs-1"]);
    expect(clusters[0]?.memberObservationRefs).toEqual(["obs-2", "obs-5"]);
    expect(clusters[1]?.memberObservationRefs).toEqual(["obs-6"]);
    for (const cluster of clusters) {
      expect(cluster.schemaVersion).toBe("waia.trader.discovery-structure-cluster.v2");
      expect(cluster.signature.metric).toBe(TRADE_REFERENCE_COUNT_METRIC);
      expect(cluster.signature.measuredVolatility).toBe(MEASURED_VOLATILITY_UNAVAILABLE);
      expect(JSON.stringify(cluster)).not.toContain("volBucket");
      expect(JSON.stringify(cluster)).not.toMatch(/pnl|fitness/i);
      expect(cluster.signature.signatureKey.startsWith("discovery-structure-v2::")).toBe(true);
    }
  });

  it("keeps a zero-trade observation when the regime is known and preserves multi-regime membership", () => {
    const [cluster] = clusterStructureSignatures(
      { campaignRef: campaign, observations: [observation("obs-zero", ["RANGE"], 0)] },
      () => "cluster-zero",
      "2026-10-02T00:00:00.000Z",
    );
    expect(cluster?.signature.tradeReferenceCountBand).toBe(TRADE_REFERENCE_COUNT_BAND.le1);
    expect(cluster?.signature.tradeCount).toBe(0);
    expect(cluster?.memberObservationRefs).toEqual(["obs-zero"]);

    const split = clusterStructureSignatures(
      {
        campaignRef: campaign,
        observations: [observation("obs-both", ["RANGE", "TREND_BULL"], 3)],
      },
      () => "cluster-split",
      "2026-10-02T00:00:00.000Z",
    );
    expect(split).toHaveLength(2);
    expect(split.every((entry) => entry.signature.tradeCount === 3)).toBe(true);
    expect(split.every((entry) => entry.memberObservationRefs.includes("obs-both"))).toBe(true);
  });

  it("freezes legacy V1 bytes and refuses them as new V2 input", () => {
    const parsed = JSON.parse(V1_CANONICAL) as StructureClusterV1;
    expect(parsed.schemaVersion).toBe(STRUCTURE_CLUSTER_SCHEMA_VERSION_V1);
    expect(serializeStructureClusterV1(parsed)).toBe(V1_CANONICAL);
    expect(buildStructureClusterContentDigest(parsed)).toBe(V1_DIGEST);

    const stored = readStoredStructureClusterPayload(V1_CANONICAL);
    expect(stored.kind).toBe("v1");
    if (stored.kind === "v1") {
      expect(stored.cluster.signature.volBucket).toBe("low");
      expect("tradeReferenceCountBand" in stored.cluster.signature).toBe(false);
      expect(serializeStructureClusterV1(stored.cluster)).toBe(V1_CANONICAL);
    }

    const relabeledKey = "TREND_BULL::trade_ref_count_le_1";
    expect(relabeledKey).not.toBe(
      buildStructureSignatureKeyV2("TREND_BULL", TRADE_REFERENCE_COUNT_BAND.le1),
    );
    const v2 = clusterFor("TREND_BULL", 1, "cluster-v1-fixture");
    expect(v2.contentDigest).not.toBe(V1_DIGEST);
    expect(v2.signature.signatureKey).not.toBe(parsed.signature.signatureKey);

    expect(() =>
      buildResearchQuestion({
        campaignRef: campaign,
        cluster: parsed as unknown as StructureClusterV2,
        questionId: "q-v1",
        createdAt: "2026-10-02T00:00:00.000Z",
      }),
    ).toThrow(StructureClusterContractError);
    expect(parsed.signature.volBucket).toBe("low");
    try {
      buildResearchQuestion({
        campaignRef: campaign,
        cluster: parsed as unknown as StructureClusterV2,
        questionId: "q-v1",
        createdAt: "2026-10-02T00:00:00.000Z",
      });
    } catch (error) {
      expect(error).toBeInstanceOf(StructureClusterContractError);
      expect((error as StructureClusterContractError).code).toBe("LEGACY_V1_NOT_ACCEPTED");
    }
  });

  it("rejects forged metric, inconsistent band, wrong version, and wrong digest before a question exists", () => {
    const cluster = clusterFor("RANGE", 1);
    const forgedBand = {
      ...cluster,
      signature: {
        ...cluster.signature,
        tradeReferenceCountBand: TRADE_REFERENCE_COUNT_BAND.gt5,
        signatureKey: buildStructureSignatureKeyV2("RANGE", TRADE_REFERENCE_COUNT_BAND.gt5),
      },
    };
    forgedBand.contentDigest = buildStructureClusterV2ContentDigest(forgedBand);
    expect(() =>
      buildResearchQuestion({
        campaignRef: campaign,
        cluster: forgedBand,
        questionId: "q-band",
        createdAt: "2026-10-02T00:00:00.000Z",
      }),
    ).toThrowError(expect.objectContaining({ code: "COUNT_BAND_INCONSISTENT" }));

    const forgedMetric = {
      ...cluster,
      signature: { ...cluster.signature, metric: "volatility" },
    } as unknown as StructureClusterV2;
    forgedMetric.contentDigest = buildStructureClusterV2ContentDigest(forgedMetric);
    expect(() =>
      buildResearchQuestion({
        campaignRef: campaign,
        cluster: forgedMetric,
        questionId: "q-metric",
        createdAt: "2026-10-02T00:00:00.000Z",
      }),
    ).toThrowError(expect.objectContaining({ code: "MALFORMED_METRIC" }));

    const wrongVersion = {
      ...cluster,
      schemaVersion: "waia.trader.discovery-structure-cluster.v9",
    } as unknown as StructureClusterV2;
    expect(() =>
      buildResearchQuestion({
        campaignRef: campaign,
        cluster: wrongVersion,
        questionId: "q-version",
        createdAt: "2026-10-02T00:00:00.000Z",
      }),
    ).toThrowError(expect.objectContaining({ code: "WRONG_VERSION" }));

    const wrongKey = {
      ...cluster,
      signature: { ...cluster.signature, signatureKey: "RANGE::low" },
    };
    wrongKey.contentDigest = buildStructureClusterV2ContentDigest(wrongKey);
    expect(() =>
      buildResearchQuestion({
        campaignRef: campaign,
        cluster: wrongKey,
        questionId: "q-key",
        createdAt: "2026-10-02T00:00:00.000Z",
      }),
    ).toThrowError(expect.objectContaining({ code: "WRONG_VERSION" }));

    const wrongDigest = { ...cluster, contentDigest: "0".repeat(64) };
    expect(() =>
      buildResearchQuestion({
        campaignRef: campaign,
        cluster: wrongDigest,
        questionId: "q-digest",
        createdAt: "2026-10-02T00:00:00.000Z",
      }),
    ).toThrowError(expect.objectContaining({ code: "DIGEST_MISMATCH" }));

    const withPnl = { ...cluster, tradePnl: "1" } as unknown as StructureClusterV2;
    expect(() =>
      buildResearchQuestion({
        campaignRef: campaign,
        cluster: withPnl,
        questionId: "q-pnl",
        createdAt: "2026-10-02T00:00:00.000Z",
      }),
    ).toThrow(NoReinforcementGuardError);
  });

  it("names the count in new questions and uses the observed regime label", () => {
    const zero = clusterFor("RANGE", 0, "cluster-zero");
    const descriptive = buildResearchQuestion({
      campaignRef: campaign,
      cluster: zero,
      questionId: "q-count",
      createdAt: "2026-10-02T00:00:00.000Z",
    });
    expect(descriptive.kind).toBe(ResearchQuestionKind.Anomaly);
    expect(descriptive.questionText).toBe(
      "What explains recurring structure signature discovery-structure-v2::RANGE::trade_ref_count_le_1 " +
        "(regime=RANGE, trade_reference_count_band=trade_ref_count_le_1, trade_reference_count=0) " +
        "across the pinned observation window?",
    );
    expect(descriptive.questionText).not.toMatch(/vol/i);
    expect(descriptive.researchProgram).toBe("general_market_research_program");
    const { contentDigest: descriptiveDigest, ...descriptiveDraft } = descriptive;
    expect(buildResearchQuestionContentDigest(descriptiveDraft)).toBe(descriptiveDigest);

    const labels = ["TREND_BULL", "TREND_BEAR", "STRESS"] as const;
    const questions = Object.fromEntries(
      labels.map((label) => {
        const question = buildResearchQuestion({
          campaignRef: campaign,
          cluster: clusterFor(label, 1, `cluster-${label}`),
          rejectionContext: rejection(),
          questionId: `q-${label}`,
          createdAt: "2026-10-02T00:00:00.000Z",
        });
        return [label, question];
      }),
    );

    expect(questions.TREND_BULL?.questionText).toBe(
      "Under what market conditions does desk-alpha@3 generate trade-attributed activity in TREND_BULL, and when does signal generation fail to produce closed trades?",
    );
    expect(questions.TREND_BULL?.questionText).not.toContain("TREND_BEAR");
    expect(questions.TREND_BULL?.questionText).not.toContain("STRESS");
    expect(questions.TREND_BEAR?.questionText).toContain("TREND_BEAR");
    expect(questions.TREND_BEAR?.questionText).not.toContain("or STRESS");
    expect(questions.STRESS?.questionText).toContain("in STRESS");
    expect(questions.STRESS?.questionText).not.toContain("TREND_BEAR");
    for (const question of Object.values(questions)) {
      expect(question.kind).toBe(ResearchQuestionKind.UnexplainedObservation);
      expect(question.questionText).not.toMatch(/vol/i);
      expect(question.researchProgram).toBe(
        RESEARCH_PROGRAM_BY_STRATEGY["desk-alpha"] ?? "desk-alpha_research_program",
      );
      const { contentDigest, ...draft } = question;
      expect(buildResearchQuestionContentDigest(draft)).toBe(contentDigest);
    }
    expect(questions.TREND_BULL?.contentDigest).not.toBe(questions.TREND_BEAR?.contentDigest);
    expect(questions.TREND_BEAR?.contentDigest).not.toBe(questions.STRESS?.contentDigest);
  });

  it("appends only a validated V2 payload and still reads legacy bytes", () => {
    const cluster = clusterFor("RANGE", 2, "cluster-append");
    const payloadJson = serializeStructureClusterV2(cluster);
    const appended = assertStructureClusterV2AppendRow({
      id: cluster.clusterId,
      organizationId: "org-1",
      campaignId: campaign.campaignId,
      signatureKey: cluster.signature.signatureKey,
      payloadJson,
      contentDigest: cluster.contentDigest,
    });
    expect(appended).toEqual(cluster);

    expect(() =>
      assertStructureClusterV2AppendRow({
        id: "cluster-v1-fixture",
        organizationId: "org-1",
        campaignId: "camp-1",
        signatureKey: "TREND_BULL::low",
        payloadJson: V1_CANONICAL,
        contentDigest: V1_DIGEST,
      }),
    ).toThrowError(expect.objectContaining({ code: "LEGACY_V1_NOT_ACCEPTED" }));

    expect(() =>
      assertStructureClusterV2AppendRow({
        id: cluster.clusterId,
        organizationId: "org-1",
        campaignId: "other-campaign",
        signatureKey: cluster.signature.signatureKey,
        payloadJson,
        contentDigest: cluster.contentDigest,
      }),
    ).toThrowError(expect.objectContaining({ code: "MALFORMED_CLUSTER" }));

    expect(() =>
      assertStructureClusterV2AppendRow({
        id: cluster.clusterId,
        organizationId: "org-1",
        campaignId: campaign.campaignId,
        signatureKey: cluster.signature.signatureKey,
        payloadJson,
        contentDigest: `${cluster.contentDigest.slice(0, -1)}a`,
      }),
    ).toThrowError(expect.objectContaining({ code: "DIGEST_MISMATCH" }));
  });
});
