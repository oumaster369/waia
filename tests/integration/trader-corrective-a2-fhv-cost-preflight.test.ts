import { describe, expect, it } from "vitest";

import {
  costModelV1FromAuthority,
  createHtrHistoricalCostModelAuthorityV1,
} from "@/lib/trader/execution/cost-model";
import { createHistoricalExecutionModelV1 } from "@/lib/trader/execution/historical-execution-model";
import {
  applyHistoricalExecutionEconomics,
  computeHistoricalExecutionAggregateDigest,
} from "@/lib/trader/execution/fill-economics";
import {
  HTR_FHV_RUN_CONTRACT_V0,
  computeHtrFhvRunContractDigest,
} from "@/lib/trader/readiness/htr-fhv-run-contract-v0";
import {
  buildHtrExecutionServerPackageManifest,
  computeHtrExecutionServerPackageDigest,
} from "@/lib/trader/readiness/htr-execution-server-package";
import { runHtrReadinessPreflight } from "@/lib/trader/readiness/htr-readiness-preflight";
import { makeWp17Bar } from "@/tests/unit/helpers/wp17-execution-fixtures";

describe("trader corrective A2 FHV cost preflight", () => {
  it("default research runtime digest matches FHV contract digest", () => {
    const authority = createHtrHistoricalCostModelAuthorityV1();
    const runtimeCostModel = costModelV1FromAuthority(authority);

    expect(runtimeCostModel.feesBps).toBe(HTR_FHV_RUN_CONTRACT_V0.feeBps);
    expect(runtimeCostModel.slippageBps).toBe("15");
    expect(authority.costModelDigest).toBe(HTR_FHV_RUN_CONTRACT_V0.costModelDigest);

    const preflight = runHtrReadinessPreflight({
      mode: "candidate-run",
      candidate: {
        costModelId: HTR_FHV_RUN_CONTRACT_V0.costModelId,
        costModelSchemaVersion: HTR_FHV_RUN_CONTRACT_V0.costModelSchemaVersion,
        feeBps: HTR_FHV_RUN_CONTRACT_V0.feeBps,
        halfSpreadBps: HTR_FHV_RUN_CONTRACT_V0.halfSpreadBps,
        marketImpactBps: HTR_FHV_RUN_CONTRACT_V0.marketImpactBps,
        slippageModel: HTR_FHV_RUN_CONTRACT_V0.slippageModel,
        costModelDigest: HTR_FHV_RUN_CONTRACT_V0.costModelDigest,
      },
    });
    expect(preflight.terminalState).toBe("HTR_WP23_READINESS_PREFLIGHT_PASS");
    expect(preflight.fhvRunContractDigest).toBe(computeHtrFhvRunContractDigest());
  });

  it("export provenance matches authority digest", () => {
    const authority = createHtrHistoricalCostModelAuthorityV1();
    const model = createHistoricalExecutionModelV1();
    const bar = makeWp17Bar(1);
    const event = {
      orderId: "a2-export-order",
      organizationId: "00000000-0000-4000-8000-0000000415a2",
      symbol: "BTCUSDT",
      side: "buy" as const,
      fillSequence: 1,
      sourceBarIndex: 1,
      sourceBar: bar,
      grossFillPrice: "25000",
      sliceQuantity: "0.01000000",
      remainingQuantityAfter: "0",
      acceptedAt: new Date("2026-01-01T00:01:00.000Z"),
      fillTimestamp: new Date("2026-01-01T00:01:59.999Z"),
      submitLatencyMs: 50,
      cancelLatencyMs: null,
    };
    const economics = applyHistoricalExecutionEconomics(event, model);

    expect(economics.executionModelId).toBe(HTR_FHV_RUN_CONTRACT_V0.costModelId);
    expect(model.takerFeeBps).toBe(HTR_FHV_RUN_CONTRACT_V0.feeBps);
    expect(buildHtrExecutionServerPackageManifest().costModelDigest).toBe(
      authority.costModelDigest,
    );
    expect(computeHtrExecutionServerPackageDigest()).toMatch(/^[0-9a-f]{64}$/);
    expect(computeHistoricalExecutionAggregateDigest([economics.economicsContentDigest])).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });

  it("rejects candidate cost-model digest mismatch", () => {
    const result = runHtrReadinessPreflight({
      mode: "candidate-run",
      candidate: {
        costModelId: HTR_FHV_RUN_CONTRACT_V0.costModelId,
        costModelSchemaVersion: HTR_FHV_RUN_CONTRACT_V0.costModelSchemaVersion,
        feeBps: HTR_FHV_RUN_CONTRACT_V0.feeBps,
        halfSpreadBps: HTR_FHV_RUN_CONTRACT_V0.halfSpreadBps,
        marketImpactBps: HTR_FHV_RUN_CONTRACT_V0.marketImpactBps,
        slippageModel: HTR_FHV_RUN_CONTRACT_V0.slippageModel,
        costModelDigest: "deadbeef".repeat(8),
      },
    });
    expect(result.terminalState).toBe("HTR_WP23_READINESS_PREFLIGHT_FAIL");
    expect(result.failureCodes.some((code) => code.includes("COST_MODEL_DIGEST_MISMATCH"))).toBe(
      true,
    );
  });
});
