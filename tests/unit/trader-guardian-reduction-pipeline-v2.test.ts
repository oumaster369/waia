import { describe, expect, it, vi } from "vitest";

import {
  buildGuardianAssessmentV2,
  runGuardianOrdinaryReductionPipelineV2,
  type GuardianReductionPipelinePortsV2,
} from "@/lib/trader/guardian/v2";
import { buildOpeningCausalLineageV1 } from "@/lib/trader/lifecycle/opening-causal-lineage-v1";
import type { PositionLotRow } from "@/lib/trader/lifecycle/trade-lifecycle.types";

const ORG = "3ca6ea6d-a049-4c1d-a694-77a417536f52";
const hex = (value: string) => value.repeat(64);
const lineage = buildOpeningCausalLineageV1({
  organizationId: ORG, symbol: "BTCUSDT", canonicalCausalLineageDigest: hex("1"),
  forecastId: "forecast-a", forecastContentDigest: hex("2"), decisionId: "decision-a",
  decisionContentDigest: hex("3"), riskVerdictId: "verdict-a", riskAllowanceId: "allowance-a",
  riskAllowanceContentDigest: hex("4"),
});
const now = new Date("2026-08-30T00:00:00.000Z");
const lot: PositionLotRow = {
  id: "lot-a", organizationId: ORG, symbol: "BTCUSDT", venue: "HTX", accountKey: "account-a",
  positionSide: "LONG", instrumentKind: "SPOT", strategySignalId: "signal-a", state: "OPEN",
  openQty: "1", remainingQty: "0.5", avgCost: "60000", openedAt: now, closedAt: null,
  tradeId: "trade-a", hedgeGroupId: null, targetLotId: null, createdAt: now, updatedAt: now,
};
const assessment = (recommendation: "HOLD" | "REDUCE_PARTIAL" = "REDUCE_PARTIAL") =>
  buildGuardianAssessmentV2({
    organizationId: ORG, positionId: "trade-a", lotId: "lot-a", symbol: "BTCUSDT",
    openingCausalLineageDigest: lineage.contentDigest, realityFrontierId: "reality-a",
    realityContentDigest: hex("5"), qualifiedEvidenceBundleId: "evidence-a",
    qualifiedEvidenceContentDigest: hex("6"), informationSufficiencyProfile: "OPEN_POSITION_REASSESSMENT",
    openPositionSufficiency: "SUFFICIENT", newOpportunitySufficiency: "INSUFFICIENT", recommendation,
    targetReductionBps: recommendation === "HOLD" ? 0 : 2_500, reasonCodes: ["THESIS_WEAKENED"],
  });

function ports(decideReduction: GuardianReductionPipelinePortsV2["decision"]["decideReduction"]) {
  return {
    decision: { decideReduction: vi.fn(decideReduction) },
    risk: { authorizeReduction: vi.fn() },
    execution: { executeReduction: vi.fn() },
    reality: { ingestExecutionReports: vi.fn() },
  } as unknown as GuardianReductionPipelinePortsV2;
}

describe("Guardian V2 ordinary reduction pipeline", () => {
  it("does not let HOLD reach Decision, Risk, Execution or Reality", async () => {
    const chain = ports(vi.fn());
    await expect(runGuardianOrdinaryReductionPipelineV2({ assessment: assessment("HOLD"), lot, openingLineage: lineage, ports: chain }))
      .rejects.toThrow("GUARDIAN_PIPELINE_HOLD_HAS_NO_ACTION");
    expect(chain.decision.decideReduction).not.toHaveBeenCalled();
    expect(chain.risk.authorizeReduction).not.toHaveBeenCalled();
  });

  it.each([
    ["forged assessment", { guardianAssessmentContentDigest: hex("f"), approvedQuantity: "0.1" }, "GUARDIAN_PIPELINE_DECISION_BINDING_MISMATCH"],
    ["increase/reversal quantity", { approvedQuantity: "0.6" }, "GUARDIAN_PIPELINE_DECISION_WOULD_INCREASE_OR_REVERSE"],
    ["wrong action", { action: "CLOSE" }, "GUARDIAN_PIPELINE_DECISION_ACTION_MISMATCH"],
  ] as const)("fails closed before Risk for %s", async (_label, override, error) => {
    const value = assessment();
    const chain = ports(async () => ({
      organizationId: ORG, guardianAssessmentId: value.assessmentId,
      guardianAssessmentContentDigest: value.contentDigest, decisionId: "decision-reduce",
      decisionContentDigest: hex("7"), action: "REDUCE", approvedQuantity: "0.1", ...override,
    } as never));
    await expect(runGuardianOrdinaryReductionPipelineV2({ assessment: value, lot, openingLineage: lineage, ports: chain }))
      .rejects.toThrow(error);
    expect(chain.risk.authorizeReduction).not.toHaveBeenCalled();
    expect(chain.execution.executeReduction).not.toHaveBeenCalled();
    expect(chain.reality.ingestExecutionReports).not.toHaveBeenCalled();
  });

  it("rejects stale opening lineage before any authority is consulted", async () => {
    const chain = ports(vi.fn());
    await expect(runGuardianOrdinaryReductionPipelineV2({
      assessment: assessment(), lot, openingLineage: { ...lineage, contentDigest: hex("f") }, ports: chain,
    })).rejects.toThrow("GUARDIAN_PIPELINE_OPENING_LINEAGE_MISMATCH");
    expect(chain.decision.decideReduction).not.toHaveBeenCalled();
  });
});
