import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { MODEL_TRANSFORM_VERSION } from "@/lib/trader/intelligence/forecast-v2/constants";
import type { ReplicaRootFamilyInput } from "@/lib/trader/intelligence/forecast-v2/identity-digests";
import type { SourceAnchor } from "@/lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1";
import {
  KM_GLOBAL_ANCHOR_COUNT,
} from "@/lib/trader/research/execopp-qualification/km-convergence-gate-v1";
import {
  runKmConvergenceOrchestratorV1,
  type KmDevelopmentAnchorInput,
} from "@/lib/trader/research/execopp-qualification/km-convergence-orchestrator-v1";

function anchor(i: number, symbol: string, rv: number): SourceAnchor {
  return {
    venue: "htx",
    market: "spot",
    symbol,
    closedBarEpochMs: 1_700_000_000_000 + i * 60_000,
    barContentDigest: createHash("sha256").update(`${symbol}:${i}`).digest("hex"),
    realizedVol20m_1m: rv,
    outcome13d: [0, 0, 0, -0.002 + (i % 7) * 0.0004, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  };
}

function buildCorpus(symbol: string): SourceAnchor[] {
  return Array.from({ length: 120 }, (_, i) => anchor(i, symbol, 0.01 + (i % 12) * 0.0015));
}

function buildFamily(symbol: string): ReplicaRootFamilyInput {
  return {
    organizationId: "00000000-0000-4000-8000-000000000001",
    venue: "htx",
    market: "spot",
    symbol,
    primaryHorizonMinutes: 30,
    executionHorizonMinutes: 33,
    packageSubjectVersion: "pkg-subject/v1",
    terminalTargetDefinitionDigestHex: "a".repeat(64),
    executionOpportunityTargetDefinitionDigestHex: "b".repeat(64),
    modelTransformVersion: MODEL_TRANSFORM_VERSION,
    developmentDatasetDigestHex: createHash("sha256").update(`dev-${symbol}`).digest("hex"),
    featureVersion: "feature-engine/rv/v2",
    normalizationVersionDigestHex: "c".repeat(64),
    codeReleaseSha: "d".repeat(40),
  };
}

function buildDevelopmentAnchors(countPerSurface: number): KmDevelopmentAnchorInput[] {
  const surfaces: Array<{ symbol: string; h: 30 | 60 }> = [
    { symbol: "BTCUSDT", h: 30 },
    { symbol: "BTCUSDT", h: 60 },
    { symbol: "ETHUSDT", h: 30 },
    { symbol: "ETHUSDT", h: 60 },
  ];
  const out: KmDevelopmentAnchorInput[] = [];
  for (const surface of surfaces) {
    const corpus = buildCorpus(surface.symbol);
    const family = buildFamily(surface.symbol);
    for (let i = 0; i < countPerSurface; i += 1) {
      out.push({
        symbol: surface.symbol,
        primaryHorizonMinutes: surface.h,
        anchorEpochMin: 2_820_000 + i,
        anchorClosedBarEpochMs: 1_700_000_000_000 + i * 60_000,
        anchorRealizedVol20m_1m: 0.012 + (i % 11) * 0.0007,
        sourceCorpus: corpus,
        executionHorizonMinutes: family.executionHorizonMinutes,
      });
    }
  }
  return out;
}

describe("DEE-532 km-convergence orchestrator/v1", () => {
  it("rejects zero notional reference", () => {
    expect(() =>
      runKmConvergenceOrchestratorV1({
        developmentDatasetDigestRaw32: createHash("sha256").update("dev").digest(),
        family: buildFamily("BTCUSDT"),
        developmentAnchors: buildDevelopmentAnchors(100),
        notionalUsdt: 10_000,
        costRate: 0.001,
        slippageBufferUsdt: 5,
        normalizationVersionDigestHex: "c".repeat(64),
        nRefUsdt: 0,
      }),
    ).toThrow("KM_GATE_INVALID_ZERO_NOTIONAL");
  });

  it("requires sufficient eligible anchors for global 16384 set", () => {
    const singleSurface = buildDevelopmentAnchors(100).filter((value) =>
      value.symbol === "BTCUSDT" && value.primaryHorizonMinutes === 30);
    expect(() =>
      runKmConvergenceOrchestratorV1({
        developmentDatasetDigestRaw32: createHash("sha256").update("dev").digest(),
        family: buildFamily("BTCUSDT"),
        developmentAnchors: singleSurface,
        notionalUsdt: 10_000,
        costRate: 0.001,
        slippageBufferUsdt: 5,
        normalizationVersionDigestHex: "c".repeat(64),
        nRefUsdt: 10_000,
      }),
    ).toThrow(/KM_GATE_INSUFFICIENT_ELIGIBLE_ANCHORS|KM_GATE_INCOMPLETE_GLOBAL_ANCHOR_SET/);
  });

  it("refuses to emit one-family authority for four distinct market surfaces", () => {
    expect(() => runKmConvergenceOrchestratorV1({
      developmentDatasetDigestRaw32: createHash("sha256").update("dev-global").digest(),
      family: buildFamily("BTCUSDT"), developmentAnchors: buildDevelopmentAnchors(4096),
      notionalUsdt: 10_000, costRate: 0.001, slippageBufferUsdt: 5,
      normalizationVersionDigestHex: "c".repeat(64), nRefUsdt: 10_000,
    })).toThrow("KM_GATE_SURFACE_FAMILY_IDENTITY_UNREPRESENTABLE");
  });

  const fullGridEnabled = process.env.WAIA_KM_ORCHESTRATOR_FULL === "1";

  it.skipIf(!fullGridEnabled)(
    "evaluates all 15 cells on 16384 selected anchors and binds winner digests",
    () => {
      const developmentAnchors = buildDevelopmentAnchors(4096);
      expect(developmentAnchors.length).toBe(KM_GLOBAL_ANCHOR_COUNT);

      expect(() => runKmConvergenceOrchestratorV1({
        developmentDatasetDigestRaw32: createHash("sha256").update("dev-global").digest(),
        family: buildFamily("BTCUSDT"),
        developmentAnchors,
        notionalUsdt: 10_000,
        costRate: 0.001,
        slippageBufferUsdt: 5,
        normalizationVersionDigestHex: "c".repeat(64),
        nRefUsdt: 10_000,
      })).toThrow("KM_GATE_SURFACE_FAMILY_IDENTITY_UNREPRESENTABLE");
    },
    900_000,
  );
});
