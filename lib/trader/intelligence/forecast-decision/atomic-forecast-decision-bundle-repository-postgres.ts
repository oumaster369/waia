import { runWaiaPostgresTransaction, type WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { createDecisionForecastLinkRepositoryPostgres } from "@/lib/trader/intelligence/forecast-decision/decision-forecast-link-repository-postgres";
import { createDecisionRecordRepositoryPostgres } from "@/lib/trader/intelligence/forecast-decision/decision-record-repository-postgres";
import { createEntryPurposeRecordRepositoryPostgres } from "@/lib/trader/intelligence/forecast-decision/entry-purpose-record-repository-postgres";
import { createForecastRecordRepositoryPostgres } from "@/lib/trader/intelligence/forecast-decision/forecast-record-repository-postgres";
import type { ForecastDecisionBundle } from "@/lib/trader/intelligence/forecast-decision/forecast-decision.types";
import type {
  ForecastDecisionBundleRepository,
  ForecastDecisionPersistenceAuthorizationV2,
} from "@/lib/trader/intelligence/forecast-decision/forecast-decision-repository-adapters";
import { admitForecastDecisionPersistence } from "@/lib/trader/intelligence/forecast-decision/forecast-decision-construction-authority";
import {
  sortDecisionForecastLinks,
  sortForecastsByKeyDigestCodePoint,
} from "@/lib/trader/intelligence/forecast-decision/serialize-forecast-decision";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export async function persistForecastDecisionBundle(
  context: OrgContext,
  bundle: ForecastDecisionBundle,
  db: WaiaPostgresDb,
  authorization: ForecastDecisionPersistenceAuthorizationV2,
): Promise<ForecastDecisionBundle> {
  const persistencePermit = admitForecastDecisionPersistence({
    authority: authorization.authority,
    organizationId: context.organizationId,
    bundle,
    syntheticResearchBinding: authorization.syntheticResearchBinding,
  });
  const normalizedBundle: ForecastDecisionBundle = {
    forecasts: sortForecastsByKeyDigestCodePoint(bundle.forecasts),
    decision: bundle.decision,
    links: sortDecisionForecastLinks(bundle.links),
    entryPurpose: bundle.entryPurpose,
  };

  return runWaiaPostgresTransaction(db, async (tx) => {
    const forecastRepo = createForecastRecordRepositoryPostgres(tx);
    const decisionRepo = createDecisionRecordRepositoryPostgres(tx);
    const linkRepo = createDecisionForecastLinkRepositoryPostgres(tx);
    const entryPurposeRepo = createEntryPurposeRecordRepositoryPostgres(tx);

    for (const forecast of normalizedBundle.forecasts) {
      await forecastRepo.insert(context, forecast, persistencePermit);
    }

    await decisionRepo.insert(context, normalizedBundle.decision, persistencePermit);

    for (const link of normalizedBundle.links) {
      await linkRepo.insert(context, link, persistencePermit);
    }

    if (normalizedBundle.entryPurpose) {
      await entryPurposeRepo.insert(context, normalizedBundle.entryPurpose, persistencePermit);
    }

    return normalizedBundle;
  });
}

export function createForecastDecisionBundleRepositoryPostgres(
  db: WaiaPostgresDb,
): ForecastDecisionBundleRepository {
  return {
    persist(context, bundle, authorization) {
      return persistForecastDecisionBundle(context, bundle, db, authorization);
    },
  };
}
