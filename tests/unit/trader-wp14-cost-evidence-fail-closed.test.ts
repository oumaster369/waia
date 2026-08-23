import { describe, expect, it } from "vitest";
import {
  buildDecisionRecord,
  wp14DecisionReasonCodes,
} from "@/lib/trader/intelligence/forecast-decision/build-decision-record";
import { buildIntelligenceCycleBundle } from "@/lib/trader/intelligence/records/intelligence-records-service";
import { runWp14EvaluationCycle } from "./wp14-test-helpers";
import { admitResearchForecastDecisionConstruction } from "./forecast-decision-construction-test-helper";

describe("trader wp14 cost evidence fail closed", () => {
  it("forces NO_TRADE when cost evidence is unavailable", () => {
    const cycle = runWp14EvaluationCycle({ costModel: undefined });
    const bundle = buildIntelligenceCycleBundle({
      organizationId: "org-wp14",
      runId: "wp14-run",
      cycleId: "0",
      symbol: "BTC/USDT",
      marketStateSnapshot: cycle.marketStateSnapshot!,
      decisionChain: cycle.decisionChain!,
    });
    const decision = buildDecisionRecord(
      {
        intelligenceCycleBundle: bundle,
        decisionChain: cycle.decisionChain!,
        msv: cycle.msv,
        signal: cycle.signal,
        costModel: undefined,
      },
      admitResearchForecastDecisionConstruction({
        organizationId: bundle.envelope.organizationId,
        symbol: bundle.envelope.symbol,
        pitAnchor: bundle.envelope.evaluatedAt,
      }),
    );
    expect(decision.decisionClass).toBe("NO_TRADE");
    expect(decision.costEvidenceState).toBe("UNAVAILABLE");
    expect(decision.reasonCodesJson).toContain(wp14DecisionReasonCodes.costEvidenceUnavailable);
  });
});
