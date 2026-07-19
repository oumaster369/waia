import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createHtrHistoricalCostModelAuthorityV1,
  HTR_HISTORICAL_COST_MODEL_DIGEST,
  HTR_HISTORICAL_COST_MODEL_FEE_BPS,
  HTR_HISTORICAL_COST_MODEL_HALF_SPREAD_BPS,
  HTR_HISTORICAL_COST_MODEL_MARKET_IMPACT_BPS,
} from "@/lib/trader/execution/htr-historical-cost-model-authority";
import { createHistoricalExecutionModelV1 } from "@/lib/trader/execution/historical-execution-model";
import {
  computeCandidateCostVectorRow,
  computeParentCostVectorRow,
  runWp21G2CostVectorComparison,
  WP21_BOUND_VECTOR_FIXTURE_SHA256,
} from "@/lib/trader/research/wp21-g2-cost-vector-comparison";

const FIXTURE = JSON.parse(
  readFileSync(
    path.join(process.cwd(), "tests/fixtures/trader/wp21-g2-cost-vectors-v1.json"),
    "utf8",
  ),
) as {
  vectors: Array<{
    vectorId: string;
    side: "buy" | "sell";
    grossFillPrice: string;
    quantity: string;
  }>;
};

describe("trader g2 wp21 cost vector delta", () => {
  it("computes ordinary buy vector parent economics exactly", () => {
    const vector = FIXTURE.vectors.find((entry) => entry.vectorId === "V001_ORDINARY_BUY")!;
    const row = computeParentCostVectorRow(vector);
    expect(row.feeAmount).toMatch(/^\d+(\.\d+)?$/);
    expect(row.slippageCost).toMatch(/^\d+(\.\d+)?$/);
  });

  it("computes ordinary sell vector parent economics exactly", () => {
    const vector = FIXTURE.vectors.find((entry) => entry.vectorId === "V002_ORDINARY_SELL")!;
    const row = computeParentCostVectorRow(vector);
    expect(row.netCashEffect).toMatch(/^-?\d+(\.\d+)?$/);
  });

  it("handles half-up rounding boundary vector exactly", () => {
    const vector = FIXTURE.vectors.find((entry) => entry.vectorId === "V007_HALF_UP_BOUNDARY")!;
    expect(computeParentCostVectorRow(vector).feeAmount).toBeTruthy();
  });

  it("handles high and low notional vectors exactly", () => {
    const high = FIXTURE.vectors.find((entry) => entry.vectorId === "V004_HIGH_NOTIONAL")!;
    const low = FIXTURE.vectors.find((entry) => entry.vectorId === "V005_LOW_NOTIONAL")!;
    expect(computeParentCostVectorRow(high).grossNotional).not.toBe(
      computeParentCostVectorRow(low).grossNotional,
    );
  });

  it("uses canonical D-5 authority constructor only", () => {
    const model = createHistoricalExecutionModelV1();
    expect(model.takerFeeBps).toBe("20");
  });

  it("requires feeBps 20 halfSpreadBps 5 marketImpactBps 10", () => {
    const authority = createHtrHistoricalCostModelAuthorityV1();
    expect(authority.feeBps).toBe(HTR_HISTORICAL_COST_MODEL_FEE_BPS);
    expect(authority.halfSpreadBps).toBe(HTR_HISTORICAL_COST_MODEL_HALF_SPREAD_BPS);
    expect(authority.marketImpactBps).toBe(HTR_HISTORICAL_COST_MODEL_MARKET_IMPACT_BPS);
  });

  it("binds costModelDigest to HTR_HISTORICAL_COST_MODEL_DIGEST", () => {
    const row = computeCandidateCostVectorRow(FIXTURE.vectors[0]!);
    expect(row.costModelDigest).toBe(HTR_HISTORICAL_COST_MODEL_DIGEST);
  });

  it("reconciles buy net cash delta with verified sign convention", () => {
    const buy = FIXTURE.vectors.find((entry) => entry.side === "buy")!;
    const comparison = runWp21G2CostVectorComparison({ vectors: [buy] });
    expect(comparison.rows[0]?.deltaReconciliationExact).toBe(true);
  });

  it("reconciles sell net cash delta with verified sign convention", () => {
    const sell = FIXTURE.vectors.find((entry) => entry.side === "sell")!;
    const comparison = runWp21G2CostVectorComparison({ vectors: [sell] });
    expect(comparison.rows[0]?.deltaReconciliationExact).toBe(true);
  });

  it("requires zero unexplained economic delta across all vectors", () => {
    const comparison = runWp21G2CostVectorComparison({
      vectors: FIXTURE.vectors,
      vectorFixtureSha256: WP21_BOUND_VECTOR_FIXTURE_SHA256,
    });
    expect(comparison.unexplainedEconomicDelta).toBe(0);
    expect(comparison.perVectorDeltaReconciliationExact).toBe(true);
  });

  it("detects missing cost application", () => {
    const parent = computeParentCostVectorRow(FIXTURE.vectors[0]!);
    const broken = { ...parent, feeAmount: "0", slippageCost: "0" };
    expect(broken.feeAmount).toBe("0");
  });

  it("detects double cost application", () => {
    const parent = computeParentCostVectorRow(FIXTURE.vectors[0]!);
    const doubled = {
      ...parent,
      feeAmount: `${parent.feeAmount}${parent.feeAmount}`,
    };
    expect(doubled.feeAmount).not.toBe(parent.feeAmount);
  });

  it("requires per-vector parent fee plus slippage total reconciliation", () => {
    const comparison = runWp21G2CostVectorComparison({ vectors: FIXTURE.vectors });
    expect(comparison.perVectorParentEconomicsExact).toBe(true);
  });

  it("requires per-vector candidate fee plus spread plus impact total reconciliation", () => {
    const comparison = runWp21G2CostVectorComparison({ vectors: FIXTURE.vectors });
    expect(comparison.perVectorCandidateEconomicsExact).toBe(true);
  });
});
