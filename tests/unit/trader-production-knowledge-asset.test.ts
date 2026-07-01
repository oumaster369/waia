import { describe, expect, it } from "vitest";

import {
  buildProductionKnowledgeAsset,
  resolveProductionKnowledgeAssetSealedAt,
} from "@/lib/trader/knowledge/build-production-knowledge-asset";
import {
  assertProductionKnowledgeAssetImmutability,
  computeProductionKnowledgeAssetDigest,
  serializeProductionKnowledgeAsset,
} from "@/lib/trader/knowledge/serialize-production-knowledge-asset";
import type { ProductionKnowledgeAsset } from "@/lib/trader/knowledge/production-knowledge-asset.types";
import { RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION } from "@/lib/trader/research/strategy-candidate.types";
import { buildValidResearchEvidenceDocument } from "@/tests/helpers/build-research-evidence-fixture";

const ORG = "00000000-0000-4000-8000-0000000272";

function sampleDataset() {
  return {
    id: "00000000-0000-4000-8000-0000000ds1",
    organizationId: ORG,
    name: "ri-p7-track-a",
    symbol: "BTC/USDT" as const,
    interval: "1m" as const,
    trainBarCount: 25920,
    validationBarCount: 8640,
    blindBarCount: 8640,
    trainDigest: "train-digest",
    validationDigest: "validation-digest",
    blindDigest: "blind-digest",
    metadataJson: "{}",
    sealedAt: new Date("2026-06-18T12:00:00.000Z"),
    createdAt: new Date("2026-06-18T12:00:00.000Z"),
  };
}

function sampleBlindMetrics() {
  return {
    schemaVersion: RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION,
    tradeCount: 3,
    periodRealizedPnl: "10",
    periodTotalFees: "1",
    byRegime: [
      {
        regimeLabel: "RANGE",
        tradeCount: 1,
        periodRealizedPnl: "5",
        periodTotalFees: "0.5",
      },
      {
        regimeLabel: "TREND_BEAR",
        tradeCount: 2,
        periodRealizedPnl: "5",
        periodTotalFees: "0.5",
      },
    ],
  };
}

describe("Production Knowledge Asset (RI-P7)", () => {
  it("builds deterministic knowledgeId and reproducibility digest", () => {
    const evidence = buildValidResearchEvidenceDocument(ORG);
    const input = {
      evidenceDocument: evidence,
      dataset: sampleDataset(),
      barSetDigest: "bar-set-digest",
      barCount: 43200,
      symbol: "BTC/USDT" as const,
      interval: "1m" as const,
      walkForwardWindowCount: 4,
      blindMetrics: sampleBlindMetrics(),
      mkbLinkage: {
        marketEventId: "event-1",
        knowledgeEdgeId: "edge-1",
      },
      edgeConfidence: "0.7500",
      edgeStrength: "0.5000",
      edgeVerified: true,
      builderGitSha: "abc123",
      sealedAt: new Date("2026-06-18T12:00:00.000Z"),
    };

    const first = buildProductionKnowledgeAsset(input);
    const second = buildProductionKnowledgeAsset(input);

    expect(first.knowledgeId).toBe(second.knowledgeId);
    expect(first.reproducibilityDigest).toBe(second.reproducibilityDigest);
    expect(first.knowledgeClass).toBe("regime_strategy_validation");
    expect(first.invalidationConditions.length).toBeGreaterThan(0);
    expect(first.evidenceRef.contentDigest).toBe(evidence.envelope.contentDigest);
  });

  it("preserves immutability across serialize round-trip", () => {
    const evidence = buildValidResearchEvidenceDocument(ORG);
    const asset = buildProductionKnowledgeAsset({
      evidenceDocument: evidence,
      dataset: sampleDataset(),
      barSetDigest: "bar-set-digest",
      barCount: 100,
      symbol: "BTC/USDT",
      interval: "1m",
      walkForwardWindowCount: 2,
      blindMetrics: sampleBlindMetrics(),
      mkbLinkage: {
        marketEventId: "event-1",
        knowledgeEdgeId: "edge-1",
      },
      edgeConfidence: "0.7500",
      edgeStrength: "0.5000",
      edgeVerified: true,
      sealedAt: new Date("2026-06-18T12:00:00.000Z"),
    });

    const serialized = serializeProductionKnowledgeAsset(asset);
    const parsed = JSON.parse(serialized) as ProductionKnowledgeAsset;
    const { reproducibilityDigest, ...bodyWithoutDigest } = parsed;
    void reproducibilityDigest;
    const roundTrip: ProductionKnowledgeAsset = {
      ...bodyWithoutDigest,
      reproducibilityDigest: computeProductionKnowledgeAssetDigest(bodyWithoutDigest),
    };

    assertProductionKnowledgeAssetImmutability(asset, roundTrip);
  });

  it("derives sealedAt from evidence exportedAt when not overridden", () => {
    const evidence = buildValidResearchEvidenceDocument(ORG, {
      exportedAt: new Date("2026-06-18T12:00:00.000Z"),
    });
    const baseInput = {
      evidenceDocument: evidence,
      dataset: sampleDataset(),
      barSetDigest: "bar-set-digest",
      barCount: 43200,
      symbol: "BTC/USDT" as const,
      interval: "1m" as const,
      walkForwardWindowCount: 4,
      blindMetrics: sampleBlindMetrics(),
      mkbLinkage: {
        marketEventId: "event-1",
        knowledgeEdgeId: "edge-1",
      },
      edgeConfidence: "0.7500",
      edgeStrength: "0.5000",
      edgeVerified: true,
    };

    const first = buildProductionKnowledgeAsset(baseInput);
    const second = buildProductionKnowledgeAsset(baseInput);

    expect(first.sealedAt).toBe("2026-06-18T12:00:00.000Z");
    expect(second.sealedAt).toBe(first.sealedAt);
    expect(
      resolveProductionKnowledgeAssetSealedAt({
        evidenceDocument: evidence,
        dataset: sampleDataset(),
      }),
    ).toBe("2026-06-18T12:00:00.000Z");
  });

  it("falls back to dataset sealedAt when evidence exportedAt is absent", () => {
    const evidence = buildValidResearchEvidenceDocument(ORG);
    const envelope = { ...evidence.envelope, exportedAt: "" };
    const evidenceWithoutExport = { ...evidence, envelope };

    expect(
      resolveProductionKnowledgeAssetSealedAt({
        evidenceDocument: evidenceWithoutExport,
        dataset: sampleDataset(),
      }),
    ).toBe("2026-06-18T12:00:00.000Z");
  });
});
