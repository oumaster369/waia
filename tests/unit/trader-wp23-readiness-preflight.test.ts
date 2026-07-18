import { describe, expect, it } from "vitest";

import {
  assertHtrReadinessPreflightPass,
  computeHtrReadinessPreflightDigest,
  runHtrReadinessPreflight,
} from "@/lib/trader/readiness/htr-readiness-preflight";
import { HTR_FHV_RUN_CONTRACT_V0 } from "@/lib/trader/readiness/htr-fhv-run-contract-v0";

describe("HTR-WP23 readiness preflight", () => {
  it("self-test passes with pinned contracts", () => {
    const result = runHtrReadinessPreflight({ mode: "self-test" });
    expect(result.terminalState).toBe("HTR_WP23_READINESS_PREFLIGHT_PASS");
    expect(result.failureCodes).toEqual([]);
    expect(result.gateGroupIds).toContain("CG-G");
    expect(result.holdoutNoReadAttestation).toBe(true);
    expect(result.noServerMutationAttestation).toBe(true);
    assertHtrReadinessPreflightPass(result);
  });

  it("candidate-run accepts exact FHV contract pins", () => {
    const result = runHtrReadinessPreflight({
      mode: "candidate-run",
      candidate: {
        venue: HTR_FHV_RUN_CONTRACT_V0.venue,
        venueScope: HTR_FHV_RUN_CONTRACT_V0.venueScope,
        marketType: HTR_FHV_RUN_CONTRACT_V0.marketType,
        symbols: HTR_FHV_RUN_CONTRACT_V0.symbols,
        cashUsdt: HTR_FHV_RUN_CONTRACT_V0.initialPortfolio.cashUsdt,
        costModelVersion: HTR_FHV_RUN_CONTRACT_V0.costModelVersion,
        costModelFeesBps: HTR_FHV_RUN_CONTRACT_V0.costModelFeesBps,
        costModelSlippageBps: HTR_FHV_RUN_CONTRACT_V0.costModelSlippageBps,
        drawdownPolicyVersion: HTR_FHV_RUN_CONTRACT_V0.drawdownPolicyVersion,
        maxAccountDrawdownPct: HTR_FHV_RUN_CONTRACT_V0.maxAccountDrawdownPct,
        maxMonthlyDrawdownPct: HTR_FHV_RUN_CONTRACT_V0.maxMonthlyDrawdownPct,
        maxStrategyDrawdownPct: HTR_FHV_RUN_CONTRACT_V0.maxStrategyDrawdownPct,
        breachAction: HTR_FHV_RUN_CONTRACT_V0.breachAction,
        datasetManifestSemanticDigest: HTR_FHV_RUN_CONTRACT_V0.datasetManifestSemanticDigestPin,
        blindHoldoutStatus: HTR_FHV_RUN_CONTRACT_V0.blindHoldout.status,
        datasetSourceClassification: HTR_FHV_RUN_CONTRACT_V0.datasetSourceClassification,
      },
    });
    expect(result.terminalState).toBe("HTR_WP23_READINESS_PREFLIGHT_PASS");
  });

  it("computes stable digest for identical results", () => {
    const first = runHtrReadinessPreflight({ mode: "self-test" });
    const second = runHtrReadinessPreflight({ mode: "self-test" });
    expect(computeHtrReadinessPreflightDigest(first)).toBe(
      computeHtrReadinessPreflightDigest(second),
    );
  });
});
