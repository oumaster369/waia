import { describe, expect, it } from "vitest";

import {
  buildAdminTradeCausalLineageView,
  buildTenantTradeCausalLineageView,
} from "@/lib/trader/lifecycle/causal-lineage-observability";
import {
  buildOpeningCausalLineageV1,
  serializeOpeningCausalLineageV1,
} from "@/lib/trader/lifecycle/opening-causal-lineage-v1";
import type { TradeRow } from "@/lib/trader/lifecycle/trade-lifecycle.types";

const digest = (value: string) => value.repeat(64).slice(0, 64);

function trade(): TradeRow {
  const lineage = buildOpeningCausalLineageV1({
    organizationId: "org-a",
    symbol: "BTCUSDT",
    canonicalCausalLineageDigest: digest("a"),
    forecastId: "forecast-a",
    forecastContentDigest: digest("b"),
    decisionId: "decision-a",
    decisionContentDigest: digest("c"),
    riskVerdictId: "verdict-a",
    riskAllowanceId: "allowance-a",
    riskAllowanceContentDigest: digest("d"),
  });
  const at = new Date("2026-08-29T00:00:00.000Z");
  return {
    id: "trade-a",
    organizationId: "org-a",
    symbol: "BTCUSDT",
    venue: "HTX",
    accountKey: "spot-main",
    positionSide: "LONG",
    instrumentKind: "SPOT",
    strategySignalId: "signal-a",
    strategyId: "strategy-a",
    strategyVersion: "1",
    state: "CLOSED",
    semanticsVersion: "1",
    openedAt: at,
    closedAt: at,
    realizedPnl: "1",
    markedPnl: "0",
    hypothesisId: null,
    patternId: null,
    riskDecisionId: "verdict-a",
    allocationDecisionId: null,
    reasoningSessionId: null,
    signalConfidence: null,
    openingRegime: null,
    openingMsvId: null,
    openingFeatureSetId: null,
    openingCausalLineageJson: serializeOpeningCausalLineageV1(lineage),
    openingCausalLineageDigest: lineage.contentDigest,
    closingMsvId: null,
    closingFeatureSetId: null,
    closingRegime: null,
    frozenAt: at,
    createdAt: at,
    updatedAt: at,
  };
}

describe("DEE-635 causal lineage observability separation", () => {
  it("returns a tenant-safe scoped projection without upstream digests", () => {
    const view = buildTenantTradeCausalLineageView("org-a", trade());
    expect(view.forecastId).toBe("forecast-a");
    expect(view).not.toHaveProperty("canonicalCausalLineageDigest");
    expect(() => buildTenantTradeCausalLineageView("org-b", trade())).toThrow(/SCOPE_MISMATCH/);
  });

  it("returns the operator projection with exact immutable authority digests", () => {
    expect(buildAdminTradeCausalLineageView(trade())).toMatchObject({
      organizationId: "org-a",
      canonicalCausalLineageDigest: digest("a"),
      forecastContentDigest: digest("b"),
      decisionContentDigest: digest("c"),
      riskAllowanceContentDigest: digest("d"),
    });
  });
});
