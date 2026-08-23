import { admitForecastDecisionConstruction } from "@/lib/trader/intelligence/forecast-decision/forecast-decision-construction-authority";
import { declareResearchNonCapitalInformationAuthorityV2 } from "@/lib/trader/intelligence/information-sufficiency";

export function admitResearchForecastDecisionConstruction(input: {
  organizationId: string;
  symbol: string;
  pitAnchor: string;
}) {
  return admitForecastDecisionConstruction({
    authority: declareResearchNonCapitalInformationAuthorityV2({
      organizationId: input.organizationId,
      reason: "FORECAST_DECISION_COMPONENT_UNIT_TEST",
    }),
    organizationId: input.organizationId,
    scope: {
      accountId: null,
      symbol: input.symbol,
      analyticalTimeframe: "1m",
      pitAnchor: input.pitAnchor,
    },
  });
}
