import {
  evaluateInformationSufficiencyRuntimeAdmissionV2,
  type InformationSufficiencyRuntimeAuthorityV2,
  type InformationSufficiencyRuntimeScopeV2,
} from "@/lib/trader/intelligence/information-sufficiency";

declare const constructionPermitBrand: unique symbol;

export type ForecastDecisionConstructionPermit = Readonly<{
  [constructionPermitBrand]: true;
}>;

const admittedPermits = new WeakSet<object>();

function requireNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new Error(`INFORMATION_SUFFICIENCY_FORECAST_BLOCKED:INVALID_RUNTIME_SCOPE:${field}`);
  }
}

export function admitForecastDecisionConstruction(input: {
  authority: InformationSufficiencyRuntimeAuthorityV2;
  organizationId: string;
  scope: InformationSufficiencyRuntimeScopeV2;
}): ForecastDecisionConstructionPermit {
  requireNonEmpty(input.organizationId, "organizationId");
  requireNonEmpty(input.scope.symbol, "symbol");
  requireNonEmpty(input.scope.analyticalTimeframe, "analyticalTimeframe");
  requireNonEmpty(input.scope.pitAnchor, "pitAnchor");

  const admission = evaluateInformationSufficiencyRuntimeAdmissionV2({
    authority: input.authority,
    organizationId: input.organizationId,
    requiredPurpose: "NEW_OPPORTUNITY",
    allowResearchNonCapital: true,
    expectedScope: input.scope,
  });
  if (admission.status === "BLOCKED") {
    throw new Error(`INFORMATION_SUFFICIENCY_FORECAST_BLOCKED:${admission.reasonCode}`);
  }

  const permit = Object.freeze({});
  admittedPermits.add(permit);
  return permit as ForecastDecisionConstructionPermit;
}

export function assertForecastDecisionConstructionPermit(
  permit: ForecastDecisionConstructionPermit | null | undefined,
): asserts permit is ForecastDecisionConstructionPermit {
  if (!permit || !admittedPermits.has(permit)) {
    throw new Error("INFORMATION_SUFFICIENCY_FORECAST_BLOCKED:INVALID_CONSTRUCTION_PERMIT");
  }
}
