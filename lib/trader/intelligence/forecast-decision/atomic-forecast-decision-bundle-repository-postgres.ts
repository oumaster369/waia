import { runWaiaPostgresTransaction, type WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { createDecisionForecastLinkRepositoryPostgres } from "@/lib/trader/intelligence/forecast-decision/decision-forecast-link-repository-postgres";
import { createDecisionRecordRepositoryPostgres } from "@/lib/trader/intelligence/forecast-decision/decision-record-repository-postgres";
import { createEntryPurposeRecordRepositoryPostgres } from "@/lib/trader/intelligence/forecast-decision/entry-purpose-record-repository-postgres";
import { createForecastRecordRepositoryPostgres } from "@/lib/trader/intelligence/forecast-decision/forecast-record-repository-postgres";
import type { ForecastDecisionBundle } from "@/lib/trader/intelligence/forecast-decision/forecast-decision.types";
import type { ForecastDecisionBundleRepository } from "@/lib/trader/intelligence/forecast-decision/forecast-decision-repository-adapters";
import {
  sortDecisionForecastLinks,
  sortForecastsByKeyDigestCodePoint,
} from "@/lib/trader/intelligence/forecast-decision/serialize-forecast-decision";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export async function persistForecastDecisionBundle(
  context: OrgContext,
  bundle: ForecastDecisionBundle,
  db: WaiaPostgresDb,
): Promise<ForecastDecisionBundle> {
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
      await forecastRepo.insert(context, forecast);
    }

    await decisionRepo.insert(context, normalizedBundle.decision);

    for (const link of normalizedBundle.links) {
      await linkRepo.insert(context, link);
    }

    if (normalizedBundle.entryPurpose) {
      await entryPurposeRepo.insert(context, normalizedBundle.entryPurpose);
    }

    return normalizedBundle;
  });
}

export function createForecastDecisionBundleRepositoryPostgres(
  db: WaiaPostgresDb,
): ForecastDecisionBundleRepository {
  return {
    persist(context, bundle) {
      return persistForecastDecisionBundle(context, bundle, db);
    },
  };
}
