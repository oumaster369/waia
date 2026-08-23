import type { ForecastDecisionBundle } from "@/lib/trader/intelligence/forecast-decision/forecast-decision.types";
import {
  evaluateInformationSufficiencyRuntimeAdmissionV2,
  type InformationSufficiencyRuntimeAuthorityV2,
  type InformationSufficiencyRuntimeScopeV2,
} from "@/lib/trader/intelligence/information-sufficiency";
import type { IntelligenceCycleBundle } from "@/lib/trader/intelligence/records/intelligence-records.types";

declare const constructionPermitBrand: unique symbol;
declare const persistencePermitBrand: unique symbol;

export type ForecastDecisionConstructionPermit = Readonly<{
  [constructionPermitBrand]: true;
}>;

export type ForecastDecisionPersistencePermit = Readonly<{
  [persistencePermitBrand]: true;
}>;

type ConstructionMetadata = Readonly<{
  sourceBundle: IntelligenceCycleBundle;
  organizationId: string;
  scope: InformationSufficiencyRuntimeScopeV2;
}>;

type PersistenceMetadata = Readonly<{
  bundle: ForecastDecisionBundle;
  forecasts: ReadonlySet<object>;
  decision: object;
  links: ReadonlySet<object>;
  entryPurpose: object | null;
}>;

const constructionPermits = new WeakMap<object, ConstructionMetadata>();
const sealedBundles = new WeakMap<ForecastDecisionBundle, ConstructionMetadata>();
const persistencePermits = new WeakMap<object, PersistenceMetadata>();

function scopeForBundle(bundle: IntelligenceCycleBundle): InformationSufficiencyRuntimeScopeV2 {
  return {
    accountId: bundle.informationSufficiencyProvenance.accountId,
    symbol: bundle.envelope.symbol,
    analyticalTimeframe: bundle.informationSufficiencyProvenance.analyticalTimeframe,
    pitAnchor: bundle.envelope.evaluatedAt,
  };
}

function admitAuthority(input: {
  authority: InformationSufficiencyRuntimeAuthorityV2;
  organizationId: string;
  scope: InformationSufficiencyRuntimeScopeV2;
}): void {
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
}

export function admitForecastDecisionConstruction(input: {
  authority: InformationSufficiencyRuntimeAuthorityV2;
  sourceBundle: IntelligenceCycleBundle;
}): ForecastDecisionConstructionPermit {
  const organizationId = input.sourceBundle.envelope.organizationId;
  const scope = scopeForBundle(input.sourceBundle);
  admitAuthority({ authority: input.authority, organizationId, scope });

  const permit = Object.freeze({});
  constructionPermits.set(permit, { sourceBundle: input.sourceBundle, organizationId, scope });
  return permit as ForecastDecisionConstructionPermit;
}

export function assertForecastDecisionConstructionPermit(
  permit: ForecastDecisionConstructionPermit | null | undefined,
  sourceBundle: IntelligenceCycleBundle,
): asserts permit is ForecastDecisionConstructionPermit {
  const metadata = permit ? constructionPermits.get(permit) : undefined;
  if (!metadata || metadata.sourceBundle !== sourceBundle) {
    throw new Error("INFORMATION_SUFFICIENCY_FORECAST_BLOCKED:INVALID_CONSTRUCTION_PERMIT");
  }
}

export function sealForecastDecisionBundleConstruction(
  bundle: ForecastDecisionBundle,
  permit: ForecastDecisionConstructionPermit,
  sourceBundle: IntelligenceCycleBundle,
): ForecastDecisionBundle {
  assertForecastDecisionConstructionPermit(permit, sourceBundle);
  const metadata = constructionPermits.get(permit)!;
  const records = [
    ...bundle.forecasts,
    bundle.decision,
    ...bundle.links,
    ...(bundle.entryPurpose ? [bundle.entryPurpose] : []),
  ];
  if (
    bundle.decision.cycleEnvelopeId !== sourceBundle.envelope.id ||
    records.some((record) => record.organizationId !== metadata.organizationId)
  ) {
    throw new Error("INFORMATION_SUFFICIENCY_FORECAST_BLOCKED:BUNDLE_SCOPE_MISMATCH");
  }
  for (const forecast of bundle.forecasts) Object.freeze(forecast);
  for (const link of bundle.links) Object.freeze(link);
  Object.freeze(bundle.forecasts);
  Object.freeze(bundle.decision);
  Object.freeze(bundle.links);
  if (bundle.entryPurpose) Object.freeze(bundle.entryPurpose);
  Object.freeze(bundle);
  sealedBundles.set(bundle, metadata);
  return bundle;
}

export function admitForecastDecisionPersistence(input: {
  authority: InformationSufficiencyRuntimeAuthorityV2;
  organizationId: string;
  bundle: ForecastDecisionBundle;
}): ForecastDecisionPersistencePermit {
  const construction = sealedBundles.get(input.bundle);
  if (!construction || construction.organizationId !== input.organizationId) {
    throw new Error("INFORMATION_SUFFICIENCY_PERSISTENCE_BLOCKED:UNSEALED_BUNDLE");
  }
  admitAuthority({
    authority: input.authority,
    organizationId: construction.organizationId,
    scope: construction.scope,
  });

  const permit = Object.freeze({});
  persistencePermits.set(permit, {
    bundle: input.bundle,
    forecasts: new Set(input.bundle.forecasts),
    decision: input.bundle.decision,
    links: new Set(input.bundle.links),
    entryPurpose: input.bundle.entryPurpose,
  });
  return permit as ForecastDecisionPersistencePermit;
}

export function assertForecastDecisionPersistencePermit(
  permit: ForecastDecisionPersistencePermit | null | undefined,
  kind: "FORECAST" | "DECISION" | "LINK" | "ENTRY_PURPOSE",
  record: object,
): asserts permit is ForecastDecisionPersistencePermit {
  const metadata = permit ? persistencePermits.get(permit) : undefined;
  const admitted =
    metadata &&
    ((kind === "FORECAST" && metadata.forecasts.has(record)) ||
      (kind === "DECISION" && metadata.decision === record) ||
      (kind === "LINK" && metadata.links.has(record)) ||
      (kind === "ENTRY_PURPOSE" && metadata.entryPurpose === record));
  if (!admitted) {
    throw new Error("INFORMATION_SUFFICIENCY_PERSISTENCE_BLOCKED:INVALID_PERSISTENCE_PERMIT");
  }
}
