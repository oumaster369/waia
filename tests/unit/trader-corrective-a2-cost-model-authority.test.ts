import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { applyCostToFill } from "@/lib/trader/execution/cost-model";
import { applyHistoricalExecutionEconomics } from "@/lib/trader/execution/fill-economics";
import { createHistoricalExecutionModelV1 } from "@/lib/trader/execution/historical-execution-model";
import {
  assertHtrHistoricalCostModelMatch,
  computeHtrHistoricalCostModelDigest,
  costModelV1FromAuthority,
  createHtrHistoricalCostModelAuthorityV1,
  HTR_HISTORICAL_COST_MODEL_DIGEST,
  HTR_HISTORICAL_COST_MODEL_FEE_BPS,
  HTR_HISTORICAL_COST_MODEL_HALF_SPREAD_BPS,
  HTR_HISTORICAL_COST_MODEL_MARKET_IMPACT_BPS,
  HTR_HISTORICAL_COST_MODEL_SLIPPAGE_MODEL,
  HtrHistoricalCostModelMismatchError,
} from "@/lib/trader/execution/htr-historical-cost-model-authority";
import {
  assertHtrFhvRunContractMatch,
  computeHtrFhvRunContractDigest,
  HTR_FHV_RUN_CONTRACT_V0,
} from "@/lib/trader/readiness/htr-fhv-run-contract-v0";
import { runHtrReadinessPreflight } from "@/lib/trader/readiness/htr-readiness-preflight";
import { compareDecimal } from "@/lib/trader/risk/numeric";
import { makeWp17Bar } from "@/tests/unit/helpers/wp17-execution-fixtures";

const REPO_ROOT = process.cwd();

function listTypeScriptFiles(rootDir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(rootDir)) {
    const fullPath = join(rootDir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...listTypeScriptFiles(fullPath));
      continue;
    }
    if (fullPath.endsWith(".ts") || fullPath.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }
  return files;
}

function scanProductionCostModelSites(): {
  executableCostModel10_5Sites: string[];
  executableCostModel20_10Sites: string[];
  adHocCreateCostModelSites: string[];
  adHocLiteralCostModelSites: string[];
  conditionalAuthorityBypassSites: string[];
} {
  const roots = [join(REPO_ROOT, "lib"), join(REPO_ROOT, "scripts")];
  const executableCostModel10_5Sites: string[] = [];
  const executableCostModel20_10Sites: string[] = [];
  const adHocCreateCostModelSites: string[] = [];
  const adHocLiteralCostModelSites: string[] = [];
  const conditionalAuthorityBypassSites: string[] = [];

  for (const root of roots) {
    for (const filePath of listTypeScriptFiles(root)) {
      if (filePath.endsWith("lib/trader/execution/cost-model.ts")) {
        continue;
      }
      const source = readFileSync(filePath, "utf8");
      const relPath = relative(REPO_ROOT, filePath);
      if (/createCostModelV1\s*\(\s*["']10["']\s*,\s*["']5["']\s*\)/.test(source)) {
        executableCostModel10_5Sites.push(relPath);
      }
      if (/createCostModelV1\s*\(\s*["']20["']\s*,\s*["']10["']\s*\)/.test(source)) {
        executableCostModel20_10Sites.push(relPath);
      }
      if (/createCostModelV1\s*\(/.test(source)) {
        adHocCreateCostModelSites.push(relPath);
      }
      if (
        /feesBps\s*:\s*["']10["'][\s\S]{0,120}slippageBps\s*:\s*["']5["']/.test(source) ||
        /slippageBps\s*:\s*["']5["'][\s\S]{0,120}feesBps\s*:\s*["']10["']/.test(source)
      ) {
        adHocLiteralCostModelSites.push(relPath);
      }
      if (/usesCanonicalD5Economics/.test(source) || /if\s*\(\s*usesCanonical/.test(source)) {
        conditionalAuthorityBypassSites.push(relPath);
      }
    }
  }

  return {
    executableCostModel10_5Sites,
    executableCostModel20_10Sites,
    adHocCreateCostModelSites,
    adHocLiteralCostModelSites,
    conditionalAuthorityBypassSites,
  };
}

describe("trader corrective A2 cost model authority", () => {
  it("binds authority to approved D-5 20/5/10 economics", () => {
    const authority = createHtrHistoricalCostModelAuthorityV1();
    const model = createHistoricalExecutionModelV1();

    expect(authority.feeBps).toBe("20");
    expect(authority.halfSpreadBps).toBe("5");
    expect(authority.marketImpactBps).toBe("10");
    expect(authority.slippageModel).toBe(HTR_HISTORICAL_COST_MODEL_SLIPPAGE_MODEL);
    expect(model.takerFeeBps).toBe(HTR_HISTORICAL_COST_MODEL_FEE_BPS);
    expect(model.halfSpreadBpsPerSide).toBe(HTR_HISTORICAL_COST_MODEL_HALF_SPREAD_BPS);
    expect(model.impactValueBps).toBe(HTR_HISTORICAL_COST_MODEL_MARKET_IMPACT_BPS);

    const costModel = costModelV1FromAuthority(authority);
    expect(costModel.feesBps).toBe("20");
    expect(costModel.slippageBps).toBe("15");
  });

  it("digest stable cross-process", () => {
    const first = createHtrHistoricalCostModelAuthorityV1();
    const second = createHtrHistoricalCostModelAuthorityV1();
    expect(first.costModelDigest).toBe(second.costModelDigest);
    expect(first.costModelDigest).toBe(HTR_HISTORICAL_COST_MODEL_DIGEST);
    expect(computeHtrHistoricalCostModelDigest()).toBe(HTR_HISTORICAL_COST_MODEL_DIGEST);
  });

  it("preflight rejects wrong fee/spread/impact", () => {
    const result = runHtrReadinessPreflight({
      mode: "candidate-run",
      candidate: {
        feeBps: "21",
        halfSpreadBps: HTR_FHV_RUN_CONTRACT_V0.halfSpreadBps,
        marketImpactBps: HTR_FHV_RUN_CONTRACT_V0.marketImpactBps,
        costModelDigest: HTR_FHV_RUN_CONTRACT_V0.costModelDigest,
      },
    });
    expect(result.terminalState).toBe("HTR_WP23_READINESS_PREFLIGHT_FAIL");
    expect(result.failureCodes.some((code) => code.includes("FEE_BPS_MISMATCH"))).toBe(true);

    const spreadMismatch = runHtrReadinessPreflight({
      mode: "candidate-run",
      candidate: {
        feeBps: HTR_FHV_RUN_CONTRACT_V0.feeBps,
        halfSpreadBps: "6",
        marketImpactBps: HTR_FHV_RUN_CONTRACT_V0.marketImpactBps,
        costModelDigest: HTR_FHV_RUN_CONTRACT_V0.costModelDigest,
      },
    });
    expect(spreadMismatch.failureCodes.some((code) => code.includes("HALF_SPREAD"))).toBe(true);

    const impactMismatch = runHtrReadinessPreflight({
      mode: "candidate-run",
      candidate: {
        feeBps: HTR_FHV_RUN_CONTRACT_V0.feeBps,
        halfSpreadBps: HTR_FHV_RUN_CONTRACT_V0.halfSpreadBps,
        marketImpactBps: "11",
        costModelDigest: HTR_FHV_RUN_CONTRACT_V0.costModelDigest,
      },
    });
    expect(impactMismatch.failureCodes.some((code) => code.includes("MARKET_IMPACT"))).toBe(true);
  });

  it("does not double-apply slippage on historical economics path", () => {
    const bar = makeWp17Bar(1);
    const event = {
      orderId: "order-a2-no-double-slippage",
      organizationId: "org-a2",
      symbol: "BTCUSDT",
      side: "buy" as const,
      fillSequence: 1,
      sourceBarIndex: 1,
      sourceBar: bar,
      grossFillPrice: "25000",
      sliceQuantity: "0.04000000",
      remainingQuantityAfter: "0",
      acceptedAt: new Date("2026-01-01T00:01:00.000Z"),
      fillTimestamp: new Date("2026-01-01T00:01:59.999Z"),
      submitLatencyMs: 50,
      cancelLatencyMs: null,
    };
    const economics = applyHistoricalExecutionEconomics(event, createHistoricalExecutionModelV1());
    const authorityCostModel = costModelV1FromAuthority(createHtrHistoricalCostModelAuthorityV1());
    const doubleAdjusted = applyCostToFill(
      economics.netFillPrice,
      event.sliceQuantity,
      event.side,
      authorityCostModel,
    );

    expect(doubleAdjusted.adjustedPrice).not.toBe(economics.netFillPrice);
    expect(compareDecimal(economics.netFillPrice, event.grossFillPrice)).toBe(1);
  });

  it("production constructor rejects tampered authority", () => {
    const authority = createHtrHistoricalCostModelAuthorityV1();
    expect(() =>
      costModelV1FromAuthority({ ...authority, feeBps: "21" as typeof authority.feeBps }),
    ).toThrow(HtrHistoricalCostModelMismatchError);
    expect(() => assertHtrHistoricalCostModelMatch({ feeBps: "21" })).toThrow(
      HtrHistoricalCostModelMismatchError,
    );
  });

  it("static guard: zero production ad-hoc cost model sites", () => {
    const scan = scanProductionCostModelSites();
    expect(scan.executableCostModel10_5Sites).toEqual([]);
    expect(scan.executableCostModel20_10Sites).toEqual([]);
    expect(scan.adHocCreateCostModelSites).toEqual([]);
    expect(scan.adHocLiteralCostModelSites).toEqual([]);
    expect(scan.conditionalAuthorityBypassSites).toEqual([]);
  });

  it("fhv-contract digest matches authority", () => {
    const authority = createHtrHistoricalCostModelAuthorityV1();
    expect(HTR_FHV_RUN_CONTRACT_V0.costModelDigest).toBe(authority.costModelDigest);
    expect(() =>
      assertHtrFhvRunContractMatch({
        costModelId: HTR_FHV_RUN_CONTRACT_V0.costModelId,
        costModelSchemaVersion: HTR_FHV_RUN_CONTRACT_V0.costModelSchemaVersion,
        feeBps: HTR_FHV_RUN_CONTRACT_V0.feeBps,
        halfSpreadBps: HTR_FHV_RUN_CONTRACT_V0.halfSpreadBps,
        marketImpactBps: HTR_FHV_RUN_CONTRACT_V0.marketImpactBps,
        slippageModel: HTR_FHV_RUN_CONTRACT_V0.slippageModel,
        costModelDigest: HTR_FHV_RUN_CONTRACT_V0.costModelDigest,
      }),
    ).not.toThrow();
    expect(computeHtrFhvRunContractDigest()).toMatch(/^[0-9a-f]{64}$/);
  });
});
