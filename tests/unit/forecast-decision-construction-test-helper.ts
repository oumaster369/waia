import { admitForecastDecisionConstruction } from "@/lib/trader/intelligence/forecast-decision/forecast-decision-construction-authority";
import { declareResearchNonCapitalInformationAuthorityV2 } from "@/lib/trader/intelligence/information-sufficiency";
import type { IntelligenceCycleBundle } from "@/lib/trader/intelligence/records/intelligence-records.types";

export function admitResearchForecastDecisionConstruction(sourceBundle: IntelligenceCycleBundle) {
  return admitForecastDecisionConstruction({
    authority: declareResearchNonCapitalInformationAuthorityV2({
      organizationId: sourceBundle.envelope.organizationId,
      reason: "FORECAST_DECISION_COMPONENT_UNIT_TEST",
    }),
    sourceBundle,
  });
}
