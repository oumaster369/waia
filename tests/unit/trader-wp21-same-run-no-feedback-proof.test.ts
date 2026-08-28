import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  WP21_PROHIBITED_SAME_RUN_CONSUMER_SURFACES,
  buildWp21SameRunConsumerGraph,
} from "@/lib/trader/intelligence/epistemic/wp21-same-run-consumer-graph";
import type { ForecastV2CalibrationObservation } from "@/lib/trader/intelligence/calibration/calibration-scorer";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { computeForecastV2EvidenceOnlyKnowledgeUpdate } from "@/lib/trader/knowledge/knowledge-confidence-update";

const hex = (char: string) => char.repeat(64);

function forecastV2Observation(): ForecastV2CalibrationObservation {
  const base: Omit<ForecastV2CalibrationObservation, "contentDigest"> = {
    schemaVersion: "waia.trader.forecast_v2_multiclass_scoring.v1",
    organizationId: "11111111-1111-4111-8111-111111111111",
    symbol: "BTCUSDT",
    primaryHorizonMinutes: 30,
    anchorClosedBarEpochMs: 1_700_000_000_000,
    resolvedAt: "2023-11-14T23:00:00.000Z",
    pitEvidenceBoundary: "2023-11-14T23:00:00.000Z",
    observedBucketOrdinal: 3,
    probabilities: [0.1, 0.1, 0.1, 0.4, 0.1, 0.1, 0.1],
    normalizedBrierScore: "0.21000000000000002",
    logLossScore: "0.916290731874155",
    forecastRuntimeAuthorityContentDigestHex: hex("1"),
    predictivePackageContentDigestHex: hex("2"),
    terminalTargetDefinitionDigestHex: hex("3"),
    terminalDistributionSemanticDigestHex: hex("4"),
    terminalForecastContentDigestHex: hex("5"),
    observedOutcomeDigestHex: hex("6"),
    pitMeasurementIdentityDigestHex: hex("7"),
    knowledgeEdgeId: "knowledge-edge-1",
    knowledgeContentDigestHex: hex("8"),
    scoringEligible: true,
    capitalAuthority: "NONE",
    idempotencyKey: "forecast-v2-observation",
  };
  return { ...base, contentDigest: computeSemanticSha256Hex(base) };
}

function listSourceFiles(root: string): string[] {
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    return [];
  }
  const entries = readdirSync(root);
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(root, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...listSourceFiles(full));
      continue;
    }
    if (full.endsWith(".ts") || full.endsWith(".tsx")) {
      files.push(full);
    }
  }
  return files;
}

describe("trader wp21 same-run no-feedback proof", () => {
  it("exports a machine-readable consumer graph with zero capital-path consumers", () => {
    const graph = buildWp21SameRunConsumerGraph();
    expect(graph.capitalPathConsumers).toEqual([]);
    expect(graph.prohibitedSameRunConsumers.length).toBeGreaterThan(0);
  });

  it("does not import WP21 epistemic outputs into prohibited same-run decision surfaces", () => {
    const repoRoot = process.cwd();
    const offenders: string[] = [];

    for (const surface of WP21_PROHIBITED_SAME_RUN_CONSUMER_SURFACES) {
      const abs = path.join(repoRoot, surface);
      for (const file of listSourceFiles(abs)) {
        const content = readFileSync(file, "utf8");
        if (
          content.includes("knowledge-confidence-update") ||
          content.includes("outcome-resolution-read-port") ||
          content.includes("runWp21TerminalSeam") ||
          content.includes("runWp21CycleSeam")
        ) {
          offenders.push(path.relative(repoRoot, file));
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("makes Forecast-V2 feedback deterministic, zero-delta and future-cycle only", () => {
    const observation = forecastV2Observation();
    const input = {
      organizationId: observation.organizationId,
      futureRunId: "future-run",
      futureCycleId: "future-cycle",
      futureCyclePitAnchor: "2023-11-14T23:01:00.000Z",
      priorMachineRecommendedConfidence: "0.5000",
      calibrationObservation: observation,
      provenance: {
        codeSha: "a".repeat(40),
        datasetContentDigest: hex("a"),
        profileDigest: hex("b"),
        canonicalizer: "HTR_SEMANTIC_CANONICAL_JSON_V1" as const,
      },
      sequence: 1,
    };
    const first = computeForecastV2EvidenceOnlyKnowledgeUpdate(input);
    expect(computeForecastV2EvidenceOnlyKnowledgeUpdate(input)).toEqual(first);
    expect(first.machineRecommendedDelta).toBe("0.0000");
    expect(first.machineRecommendedConfidence).toBe(first.priorMachineRecommendedConfidence);
    expect(first.capitalAuthority).toBe("NONE");
    expect(first.strategyAuthority).toBe("NONE");
    expect(first.tradeEligibilityAuthority).toBe("NONE");
    expect(first.guardianAuthority).toBe("NONE");
    expect(() =>
      computeForecastV2EvidenceOnlyKnowledgeUpdate({
        ...input,
        futureCyclePitAnchor: observation.resolvedAt,
      }),
    ).toThrow(/future-cycle only/);
  });
});
