import { describe, expect, it } from "vitest";

import { HTR_FHV_RUN_CONTRACT_V0 } from "@/lib/trader/readiness/htr-fhv-run-contract-v0";
import { runHtrReadinessPreflight } from "@/lib/trader/readiness/htr-readiness-preflight";

const exactCandidate = {
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
};

describe("HTR-WP23 negative preflight matrix", () => {
  it("passes exact candidate baseline", () => {
    const result = runHtrReadinessPreflight({
      mode: "candidate-run",
      candidate: exactCandidate,
    });
    expect(result.terminalState).toBe("HTR_WP23_READINESS_PREFLIGHT_PASS");
  });

  it.each([
    ["venue", { venue: "BINANCE" }],
    ["symbols", { symbols: ["BTCUSDT"] as const }],
    ["initial cash", { cashUsdt: "50000" }],
    ["cost model version", { costModelVersion: "waia.trader.cost-model.v2" }],
    ["account drawdown", { maxAccountDrawdownPct: 30 }],
    ["manifest digest", { datasetManifestSemanticDigest: "deadbeef".repeat(8) }],
    ["holdout access", { holdoutAccessRequested: true }],
    ["D11B substitution", { d11bDatasetAsFhvSubstitute: true }],
  ] as const)("rejects %s mismatch", (_label, mutation) => {
    const result = runHtrReadinessPreflight({
      mode: "candidate-run",
      candidate: { ...exactCandidate, ...mutation },
    });
    expect(result.terminalState).toBe("HTR_WP23_READINESS_PREFLIGHT_FAIL");
    expect(result.failureCodes.length).toBeGreaterThan(0);
  });

  it("rejects candidate-run without candidate payload", () => {
    const result = runHtrReadinessPreflight({ mode: "candidate-run" });
    expect(result.terminalState).toBe("HTR_WP23_READINESS_PREFLIGHT_FAIL");
    expect(result.failureCodes).toContain("HTR_WP23_PREFLIGHT:CANDIDATE_REQUIRED");
  });
});
