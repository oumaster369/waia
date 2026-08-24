import { deriveDecisionForecastLinkId } from "@/lib/trader/intelligence/forecast-decision/derive-forecast-decision-ids";
import { computeDecisionForecastLinkContentDigest } from "@/lib/trader/intelligence/forecast-decision/serialize-forecast-decision";
import {
  DECISION_FORECAST_LINK_SCHEMA_VERSION,
  type DecisionClass,
  type TraderIntelligenceDecisionForecastLink,
  type TraderIntelligenceDecisionRecord,
  type TraderIntelligenceForecastRecord,
} from "@/lib/trader/intelligence/forecast-decision/forecast-decision.types";
import type { IntelligenceCycleBundle } from "@/lib/trader/intelligence/records/intelligence-records.types";
import {
  assertForecastDecisionConstructionPermit,
  type ForecastDecisionConstructionPermit,
} from "@/lib/trader/intelligence/forecast-decision/forecast-decision-construction-authority";

export type BuildDecisionForecastLinksInput = Readonly<{
  decision: TraderIntelligenceDecisionRecord;
  forecasts: readonly TraderIntelligenceForecastRecord[];
  activeHypothesisRecordId: string | null;
}>;

function assertTradeLinksRequired(decisionClass: DecisionClass, linkCount: number): void {
  if ((decisionClass === "TRADE" || decisionClass === "REDUCED_RISK") && linkCount === 0) {
    throw new Error("TRADE/REDUCED_RISK decisions require at least one decision-forecast link");
  }
}

export function buildDecisionForecastLinks(
  input: BuildDecisionForecastLinksInput,
  constructionPermit: ForecastDecisionConstructionPermit,
  sourceBundle: IntelligenceCycleBundle,
): TraderIntelligenceDecisionForecastLink[] {
  assertForecastDecisionConstructionPermit(constructionPermit, sourceBundle);
  if (input.decision.cycleEnvelopeId !== sourceBundle.envelope.id) {
    throw new Error("INFORMATION_SUFFICIENCY_FORECAST_BLOCKED:BUNDLE_SCOPE_MISMATCH");
  }
  if (input.decision.decisionClass === "NO_TRADE") {
    return [];
  }

  if (input.forecasts.length === 0) {
    assertTradeLinksRequired(input.decision.decisionClass, 0);
    return [];
  }

  const primaryForecast =
    input.forecasts.find(
      (forecast) => forecast.hypothesisRecordId === input.activeHypothesisRecordId,
    ) ?? input.forecasts[0]!;

  const supporting = input.forecasts.filter((forecast) => forecast.id !== primaryForecast.id);
  const ordered = [primaryForecast, ...supporting];

  const links = ordered.map((forecast, index) => {
    const linkRole = index === 0 ? ("PRIMARY" as const) : ("SUPPORTING" as const);
    const base: TraderIntelligenceDecisionForecastLink = {
      id: deriveDecisionForecastLinkId({
        organizationId: input.decision.organizationId,
        decisionRecordId: input.decision.id,
        forecastRecordId: forecast.id,
      }),
      organizationId: input.decision.organizationId,
      decisionRecordId: input.decision.id,
      forecastRecordId: forecast.id,
      linkRole,
      ordinal: index,
      contentDigest: "",
      schemaVersion: DECISION_FORECAST_LINK_SCHEMA_VERSION,
    };
    return {
      ...base,
      contentDigest: computeDecisionForecastLinkContentDigest(base),
    };
  });

  assertTradeLinksRequired(input.decision.decisionClass, links.length);
  return links;
}
