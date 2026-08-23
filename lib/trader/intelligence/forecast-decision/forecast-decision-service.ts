import type { CostModelV1 } from "@/lib/trader/execution/cost-model";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { DecisionChain } from "@/lib/trader/intelligence/mi-core.types";
import { buildDecisionForecastLinks } from "@/lib/trader/intelligence/forecast-decision/build-decision-forecast-links";
import { buildDecisionRecord } from "@/lib/trader/intelligence/forecast-decision/build-decision-record";
import { buildEntryPurposeRecord } from "@/lib/trader/intelligence/forecast-decision/build-entry-purpose-record";
import { buildForecastRecords } from "@/lib/trader/intelligence/forecast-decision/build-forecast-records";
import { persistForecastDecisionBundle } from "@/lib/trader/intelligence/forecast-decision/atomic-forecast-decision-bundle-repository-postgres";
import { assertForecastDecisionChainComplete } from "@/lib/trader/intelligence/forecast-decision/forecast-decision-completeness";
import type { ForecastDecisionBundle } from "@/lib/trader/intelligence/forecast-decision/forecast-decision.types";
import type { ForecastDecisionBundleRepository } from "@/lib/trader/intelligence/forecast-decision/forecast-decision-repository-adapters";
import { admitForecastDecisionConstruction } from "@/lib/trader/intelligence/forecast-decision/forecast-decision-construction-authority";
import type { HypothesisSet } from "@/lib/trader/intelligence/hypothesis/hypothesis.types";
import type {
  InformationSufficiencyRuntimeAuthorityV2,
  InformationSufficiencyRuntimeScopeV2,
} from "@/lib/trader/intelligence/information-sufficiency";
import type { IntelligenceCycleBundle } from "@/lib/trader/intelligence/records/intelligence-records.types";
import type { MsvEnvelope, StrategySignal } from "@/lib/trader/intelligence/types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type BuildForecastDecisionBundleInput = Readonly<{
  intelligenceCycleBundle: IntelligenceCycleBundle;
  hypothesisSet: HypothesisSet;
  decisionChain: DecisionChain;
  msv: MsvEnvelope;
  signal: StrategySignal;
  costModel?: CostModelV1;
  informationSufficiencyAuthority: InformationSufficiencyRuntimeAuthorityV2;
  informationSufficiencyScope: InformationSufficiencyRuntimeScopeV2;
}>;

export function buildForecastDecisionBundle(
  input: BuildForecastDecisionBundleInput,
): ForecastDecisionBundle {
  const constructionPermit = admitForecastDecisionConstruction({
    authority: input.informationSufficiencyAuthority,
    organizationId: input.intelligenceCycleBundle.envelope.organizationId,
    scope: input.informationSufficiencyScope,
  });
  if (
    input.informationSufficiencyScope.symbol !== input.intelligenceCycleBundle.envelope.symbol ||
    input.informationSufficiencyScope.pitAnchor !==
      input.intelligenceCycleBundle.envelope.evaluatedAt
  ) {
    throw new Error("INFORMATION_SUFFICIENCY_FORECAST_BLOCKED:BUNDLE_SCOPE_MISMATCH");
  }

  const hypothesesByType = Object.fromEntries(
    input.hypothesisSet.hypotheses.map((hypothesis) => [hypothesis.hypothesisType, hypothesis]),
  );

  const forecasts = buildForecastRecords(
    {
      intelligenceCycleBundle: input.intelligenceCycleBundle,
      hypothesesByType,
    },
    constructionPermit,
  );

  const decision = buildDecisionRecord(
    {
      intelligenceCycleBundle: input.intelligenceCycleBundle,
      decisionChain: input.decisionChain,
      msv: input.msv,
      signal: input.signal,
      costModel: input.costModel,
    },
    constructionPermit,
  );

  const links = buildDecisionForecastLinks(
    {
      decision,
      forecasts,
      activeHypothesisRecordId: input.intelligenceCycleBundle.conviction.activeHypothesisRecordId,
    },
    constructionPermit,
  );

  const entryPurpose = buildEntryPurposeRecord(
    {
      decision,
      forecasts,
      links,
      activeHypothesis: input.hypothesisSet.activeHypothesis,
    },
    constructionPermit,
  );

  return {
    forecasts,
    decision,
    links,
    entryPurpose,
  };
}

export type PersistForecastDecisionBundleInput = BuildForecastDecisionBundleInput & {
  wp13Persisted?: boolean;
};

export type PersistForecastDecisionBundleDeps = Readonly<{
  db?: WaiaPostgresDb;
  bundleRepository?: ForecastDecisionBundleRepository;
}>;

export async function persistForecastDecisionBundleForCycle(
  context: OrgContext,
  input: PersistForecastDecisionBundleInput,
  deps: PersistForecastDecisionBundleDeps = {},
): Promise<ForecastDecisionBundle> {
  const bundle = buildForecastDecisionBundle(input);

  if (deps.bundleRepository) {
    const persisted = await deps.bundleRepository.persist(context, bundle, {
      authority: input.informationSufficiencyAuthority,
      scope: input.informationSufficiencyScope,
    });
    await assertForecastDecisionChainComplete(
      context,
      {
        organizationId: context.organizationId,
        runId: input.intelligenceCycleBundle.envelope.runId,
        cycleId: input.intelligenceCycleBundle.envelope.cycleId,
        symbol: input.intelligenceCycleBundle.envelope.symbol,
        wp13Persisted: input.wp13Persisted,
      },
      deps,
    );
    return persisted;
  }

  if (!deps.db) {
    return bundle;
  }

  const persisted = await persistForecastDecisionBundle(context, bundle, deps.db, {
    authority: input.informationSufficiencyAuthority,
    scope: input.informationSufficiencyScope,
  });
  await assertForecastDecisionChainComplete(
    context,
    {
      organizationId: context.organizationId,
      runId: input.intelligenceCycleBundle.envelope.runId,
      cycleId: input.intelligenceCycleBundle.envelope.cycleId,
      symbol: input.intelligenceCycleBundle.envelope.symbol,
      wp13Persisted: input.wp13Persisted,
    },
    deps,
  );
  return persisted;
}
