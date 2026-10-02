import { describe, expect, it } from "vitest";

import { buildResearchQuestion } from "@/lib/trader/discovery/research-question-builder";
import {
  buildStructureClusterContentDigest,
  buildStructureClusterV2ContentDigest,
  buildResearchQuestionContentDigest,
} from "@/lib/trader/discovery/serialize-discovery";
import { assertValidStructureClusterV2 } from "@/lib/trader/discovery/structure-cluster-v2";
import { clusterStructureSignatures } from "@/lib/trader/discovery/structure-clusterer";
import {
  STRUCTURE_CLUSTER_SCHEMA_VERSION,
  type StructureCluster,
  type StructureClusterV2,
} from "@/lib/trader/discovery/structure.types";
import type { ObservationRecord } from "@/lib/trader/discovery/observation.types";
import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";

const CAMPAIGN = {
  campaignId: "campaign-1210",
  campaignDigest: "a".repeat(64),
  state: "ACTIVE" as const,
};
const CREATED_AT = "2026-01-01T00:03:00.000Z";

function observation(
  observationId: string,
  tradeCount: number,
  regimeLabel = "TREND",
): ObservationRecord {
  return {
    schemaVersion: "waia.trader.discovery-observation.v1",
    observationId,
    campaignRef: CAMPAIGN,
    barWindow: {
      symbol: "BTCUSDT",
      interval: "1m",
      start: "2026-01-01T00:00:00.000Z",
      end: "2026-01-01T00:02:00.000Z",
      barCount: 2,
    },
    observedRegimes: [regimeLabel],
    tradeRefs: Array.from({ length: tradeCount }, (_, index) => ({
      fillId: `${observationId}-fill-${index + 1}`,
      symbol: "BTCUSDT",
      executedAt: `2026-01-01T00:0${index + 1}:00.000Z`,
      regimeLabel,
    })),
    patternRefs: [],
    eventRefs: [],
    contentDigest: `observation-digest-${observationId}`,
    createdAt: "2026-01-01T00:02:00.000Z",
  };
}

function clusters(observations: readonly ObservationRecord[]) {
  let nextId = 0;
  return clusterStructureSignatures(
    { campaignRef: CAMPAIGN, observations },
    () => `cluster-${++nextId}`,
    CREATED_AT,
  );
}

function asRecord(value: unknown): StructureClusterV2 {
  return value as StructureClusterV2;
}

const LEGACY_V1_FIXTURE: StructureCluster = {
  schemaVersion: STRUCTURE_CLUSTER_SCHEMA_VERSION,
  clusterId: "cluster-v1-fixed",
  campaignRef: CAMPAIGN,
  signature: {
    signatureKey: "TREND::medium",
    regimeLabel: "TREND",
    volBucket: "medium",
    tradeCount: 2,
    observationCount: 1,
  },
  memberObservationRefs: ["obs-legacy-1210"],
  contentDigest: "35f80329f1d154ffc1a9d7aa8ac4fc9847253ba21ee59bb5ffd15edf38d7ea99",
  createdAt: CREATED_AT,
};

describe("discovery structure cluster versioned count bands", () => {
  it("keeps the exact immutable legacy V1 bytes and digest fixture", () => {
    expect(buildStructureClusterContentDigest(LEGACY_V1_FIXTURE)).toBe(
      LEGACY_V1_FIXTURE.contentDigest,
    );
    expect(canonicalJsonString(LEGACY_V1_FIXTURE)).toBe(
      '{"campaignRef":{"campaignDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","campaignId":"campaign-1210","state":"ACTIVE"},"clusterId":"cluster-v1-fixed","contentDigest":"35f80329f1d154ffc1a9d7aa8ac4fc9847253ba21ee59bb5ffd15edf38d7ea99","createdAt":"2026-01-01T00:03:00.000Z","memberObservationRefs":["obs-legacy-1210"],"schemaVersion":"waia.trader.discovery-structure-cluster.v1","signature":{"observationCount":1,"regimeLabel":"TREND","signatureKey":"TREND::medium","tradeCount":2,"volBucket":"medium"}}',
    );
  });

  it("emits V2 with explicit trade-reference count semantics and unavailable volatility", () => {
    const [cluster] = clusters([observation("obs-two", 2)]);
    const record = asRecord(cluster);

    expect(record.schemaVersion).toBe("waia.trader.discovery-structure-cluster.v2");
    expect(record.signature).toMatchObject({
      signatureKey: "v2::TREND::trade-reference-count-band::medium",
      metricKind: "TRADE_REFERENCE_COUNT_BAND",
      tradeReferenceCountBand: "medium",
      measuredVolatilityStatus: "UNAVAILABLE",
      tradeCount: 2,
      observationCount: 1,
    });
    expect(record.signature).not.toHaveProperty("volBucket");
    expect(record.memberTradeReferenceCounts).toEqual([
      { observationRef: "obs-two", tradeReferenceCount: 2 },
    ]);
  });

  it.each([
    [0, "low"],
    [1, "low"],
    [2, "medium"],
    [5, "medium"],
    [6, "high"],
  ] as const)("labels %i trade references as count band %s", (count, band) => {
    const [cluster] = clusters([observation(`obs-${count}`, count, `REGIME_${count}`)]);
    const signature = asRecord(cluster).signature;

    expect(signature.metricKind).toBe("TRADE_REFERENCE_COUNT_BAND");
    expect(signature.tradeReferenceCountBand).toBe(band);
    expect(signature.measuredVolatilityStatus).toBe("UNAVAILABLE");
  });

  it("keeps each member's band when aggregate trade count crosses a band boundary", () => {
    const [cluster] = clusters([observation("obs-a", 2), observation("obs-b", 2)]);
    const record = asRecord(cluster);

    expect(record.signature.tradeCount).toBe(4);
    expect(record.signature.observationCount).toBe(2);
    expect(record.signature.tradeReferenceCountBand).toBe("medium");
    expect(record.memberTradeReferenceCounts).toEqual([
      { observationRef: "obs-a", tradeReferenceCount: 2 },
      { observationRef: "obs-b", tradeReferenceCount: 2 },
    ]);
    expect(record.memberObservationRefs).toEqual(["obs-a", "obs-b"]);
  });

  it("does not infer each member's band from an aggregate above the high cutoff", () => {
    const [cluster] = clusters([observation("obs-a", 3), observation("obs-b", 3)]);
    const record = asRecord(cluster);

    expect(record.signature.tradeCount).toBe(6);
    expect(record.signature.tradeReferenceCountBand).toBe("medium");
    expect(record.memberTradeReferenceCounts).toEqual([
      { observationRef: "obs-a", tradeReferenceCount: 3 },
      { observationRef: "obs-b", tradeReferenceCount: 3 },
    ]);
  });

  it("retains a known-regime zero-trade observation in the low count band", () => {
    const [cluster] = clusters([observation("obs-zero", 0, "KNOWN")]);
    const record = asRecord(cluster);

    expect(record.signature.regimeLabel).toBe("KNOWN");
    expect(record.signature.tradeReferenceCountBand).toBe("low");
    expect(record.signature.tradeCount).toBe(0);
    expect(record.memberObservationRefs).toEqual(["obs-zero"]);
  });

  it("preserves the existing empty-regime behavior", () => {
    const source = observation("obs-no-regime", 2);
    source.observedRegimes = [];

    expect(clusters([source])).toEqual([]);
  });

  it("copies caller-owned nested inputs for both emitted clusters and questions", () => {
    const source = observation("obs-detached", 2);
    const inputCampaign = { ...CAMPAIGN };
    source.campaignRef = inputCampaign;
    const [cluster] = clusterStructureSignatures(
      { campaignRef: inputCampaign, observations: [source] },
      () => "cluster-detached",
      CREATED_AT,
    );
    const clusterDigest = cluster.contentDigest;

    inputCampaign.campaignId = "mutated-campaign";
    (source.tradeRefs as Array<ObservationRecord["tradeRefs"][number]>).push({
      fillId: "late-fill",
      symbol: "BTCUSDT",
      executedAt: "2026-01-01T00:03:00.000Z",
      regimeLabel: "TREND",
    });
    (source.observedRegimes as string[]).push("LATE_REGIME");

    expect(cluster.campaignRef.campaignId).toBe(CAMPAIGN.campaignId);
    expect(cluster.signature.observationCount).toBe(1);
    expect(cluster.signature.tradeCount).toBe(2);
    expect(buildStructureClusterV2ContentDigest(cluster)).toBe(clusterDigest);

    const questionCampaign = { ...CAMPAIGN };
    const questionCluster = structuredClone(cluster);
    const question = buildResearchQuestion({
      campaignRef: questionCampaign,
      cluster: questionCluster,
      questionId: "question-detached",
      createdAt: CREATED_AT,
    });
    const questionDigest = question.contentDigest;

    questionCampaign.campaignId = "mutated-question-campaign";
    (questionCluster.memberObservationRefs as string[]).push("late-member");
    expect(question.campaignRef.campaignId).toBe(CAMPAIGN.campaignId);
    expect(question.observationRefs).toEqual(["obs-detached"]);
    expect(buildResearchQuestionContentDigest(question)).toBe(questionDigest);
  });

  it("refuses observations outside the target campaign scope", () => {
    const source = observation("obs-other-campaign", 2);
    source.campaignRef = { ...CAMPAIGN, campaignId: "other-campaign" };

    expect(() => clusters([source])).toThrow(/STRUCTURE_CLUSTER_V2_INVALID:OBSERVATION_SCOPE/);
  });

  it.each(["", "duplicate"])(
    "refuses invalid generated cluster identifiers (%s)",
    (generatedId) => {
      const source = observation("obs-id-check", 2);
      source.observedRegimes = ["TREND", "RANGE"];
      let calls = 0;

      expect(() =>
        clusterStructureSignatures(
          { campaignRef: CAMPAIGN, observations: [source] },
          () => {
            calls += 1;
            return generatedId === "duplicate" ? "same-cluster-id" : "";
          },
          CREATED_AT,
        ),
      ).toThrow(/STRUCTURE_CLUSTER_V2_INVALID:CLUSTER_ID/);
      expect(calls).toBe(generatedId === "duplicate" ? 2 : 1);
    },
  );

  it("versions the key and content identity separately from legacy V1", () => {
    const [cluster] = clusters([observation("obs-two", 2)]);
    const record = asRecord(cluster);

    expect(record.schemaVersion).toBe("waia.trader.discovery-structure-cluster.v2");
    expect(record.signature.signatureKey).not.toBe(LEGACY_V1_FIXTURE.signature.signatureKey);
    expect(record.contentDigest).not.toBe(LEGACY_V1_FIXTURE.contentDigest);
  });

  it("renders a new count-band question without calling it volatility", () => {
    const [cluster] = clusters([observation("obs-two", 2)]);
    const question = buildResearchQuestion({
      campaignRef: CAMPAIGN,
      cluster: cluster as never,
      questionId: "question-v2",
      createdAt: CREATED_AT,
    });

    expect(question.questionText).toContain("trade-reference count band=medium");
    expect(question.questionText).toContain("measured volatility unavailable");
    expect(question.questionText).not.toMatch(/\bvol=/i);
  });

  it("keeps the count-band disclosure in rejection-context questions", () => {
    const [cluster] = clusters([observation("obs-two", 2)]);
    const question = buildResearchQuestion({
      campaignRef: CAMPAIGN,
      cluster: cluster as never,
      rejectionContext: {
        recordBody: { strategyId: "candidate", strategyVersion: "1.0.0" },
      } as never,
      questionId: "question-rejection-context",
      createdAt: CREATED_AT,
    });

    expect(question.questionText).toContain("trade-reference count band=medium");
    expect(question.questionText).toContain("measured volatility unavailable");
    expect(question.questionText).not.toMatch(/\bvol=/i);
  });

  it.each(["CHOP", "RANGE", "TREND_BEAR", "STRESS"] as const)(
    "uses the validated %s label in rejection-context question text and digest",
    (regimeLabel) => {
      const [cluster] = clusters([observation(`obs-rejection-${regimeLabel}`, 2, regimeLabel)]);
      const question = buildResearchQuestion({
        campaignRef: CAMPAIGN,
        cluster: cluster as never,
        rejectionContext: {
          recordBody: { strategyId: "candidate", strategyVersion: "1.0.0" },
        } as never,
        questionId: `question-rejection-${regimeLabel}`,
        createdAt: CREATED_AT,
      });

      expect(question.questionText).toContain(`observed regime=${regimeLabel}`);
      expect(question.questionText).toContain("trade-reference count band=medium");
      expect(question.questionText).toContain("measured volatility unavailable");
      expect(question.questionText).not.toContain("TREND_BEAR or STRESS");
      const { contentDigest, ...unsignedQuestion } = question;
      expect(buildResearchQuestionContentDigest(unsignedQuestion)).toBe(contentDigest);
    },
  );

  it("refuses immutable V1 input for new question generation", () => {
    expect(() =>
      buildResearchQuestion({
        campaignRef: CAMPAIGN,
        cluster: LEGACY_V1_FIXTURE as never,
        questionId: "question-from-v1",
        createdAt: CREATED_AT,
      }),
    ).toThrow(/STRUCTURE_CLUSTER_V2_INVALID/);
  });

  it("rejects forged count-band consistency even when the altered V2 digest is recomputed", () => {
    const [cluster] = clusters([observation("obs-two", 2)]);
    const forged = structuredClone(asRecord(cluster));
    forged.signature.tradeReferenceCountBand = "low";
    forged.signature.signatureKey = "v2::TREND::trade-reference-count-band::low";
    const { contentDigest: oldDigest, ...draft } = forged;
    expect(oldDigest).toMatch(/^[a-f0-9]{64}$/);
    forged.contentDigest = buildStructureClusterV2ContentDigest(
      draft as Omit<StructureClusterV2, "contentDigest">,
    );

    expect(() =>
      buildResearchQuestion({
        campaignRef: CAMPAIGN,
        cluster: forged as never,
        questionId: "question-forged-band",
        createdAt: CREATED_AT,
      }),
    ).toThrow(/STRUCTURE_CLUSTER_V2_INVALID/);
  });

  it("rejects a mismatched V2 digest before creating a question", () => {
    const [cluster] = clusters([observation("obs-two", 2)]);
    const forged = { ...asRecord(cluster), contentDigest: "0".repeat(64) };

    expect(() =>
      buildResearchQuestion({
        campaignRef: CAMPAIGN,
        cluster: forged as never,
        questionId: "question-bad-digest",
        createdAt: CREATED_AT,
      }),
    ).toThrow(/STRUCTURE_CLUSTER_V2_INVALID:CONTENT_DIGEST/);
  });

  it("binds createdAt into the V2 digest and refuses a timestamp changed with the old digest", () => {
    const [cluster] = clusters([observation("obs-created-at", 2)]);
    const tampered = { ...cluster, createdAt: "2026-01-02T00:00:00.000Z" };

    expect(() => assertValidStructureClusterV2(tampered)).toThrow(
      /STRUCTURE_CLUSTER_V2_INVALID:CONTENT_DIGEST/,
    );
  });

  it.each([
    "",
    "not-a-date",
    "2026-02-30T00:00:00.000Z",
    "2026-01-01T24:00:00.000Z",
    "2026-01-01T00:00:00",
    "2026-01-01T03:00:00.000+03:00",
  ])("refuses noncanonical V2 createdAt timestamps (%s)", (createdAt) => {
    const [cluster] = clusters([observation("obs-bad-created-at", 2)]);
    const { contentDigest: oldDigest, ...clusterDraft } = cluster;
    expect(oldDigest).toMatch(/^[a-f0-9]{64}$/);
    const draft = { ...clusterDraft, createdAt };
    const forged = {
      ...draft,
      contentDigest: buildStructureClusterV2ContentDigest(
        draft as Omit<StructureClusterV2, "contentDigest">,
      ),
    };

    expect(() => assertValidStructureClusterV2(forged)).toThrow(
      /STRUCTURE_CLUSTER_V2_INVALID:CREATED_AT/,
    );
  });

  it("refuses a question whose campaign scope differs from its V2 cluster", () => {
    const [cluster] = clusters([observation("obs-two", 2)]);

    expect(() =>
      buildResearchQuestion({
        campaignRef: { ...CAMPAIGN, campaignId: "other-campaign" },
        cluster: cluster as never,
        questionId: "question-wrong-campaign",
        createdAt: CREATED_AT,
      }),
    ).toThrow(/STRUCTURE_CLUSTER_V2_INVALID:CAMPAIGN_SCOPE/);
  });

  it("refuses extra nested caller data in the supplied question campaign reference", () => {
    const [cluster] = clusters([observation("obs-two", 2)]);
    const unsafeCampaign = { ...CAMPAIGN, unexpected: { mutable: true } };

    expect(() =>
      buildResearchQuestion({
        campaignRef: unsafeCampaign as never,
        cluster,
        questionId: "question-extra-campaign-field",
        createdAt: CREATED_AT,
      }),
    ).toThrow(/STRUCTURE_CLUSTER_V2_INVALID:CAMPAIGN_REF/);
  });
});
