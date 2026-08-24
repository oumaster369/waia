import { runWaiaPostgresTransaction, type WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { createConvictionRecordRepositoryPostgres } from "@/lib/trader/intelligence/records/conviction-record-repository-postgres";
import { createCycleEnvelopeRepositoryPostgres } from "@/lib/trader/intelligence/records/cycle-envelope-repository-postgres";
import { createHypothesisRecordRepositoryPostgres } from "@/lib/trader/intelligence/records/hypothesis-record-repository-postgres";
import type { IntelligenceCycleBundle } from "@/lib/trader/intelligence/records/intelligence-records.types";
import type { IntelligenceCycleBundleRepository } from "@/lib/trader/intelligence/records/repository-adapters";
import { sortHypothesesByTypeCodePoint } from "@/lib/trader/intelligence/records/serialize-intelligence-records";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export async function persistIntelligenceCycleBundle(
  context: OrgContext,
  bundle: IntelligenceCycleBundle,
  db: WaiaPostgresDb,
): Promise<IntelligenceCycleBundle> {
  const sortedHypotheses = sortHypothesesByTypeCodePoint(bundle.hypotheses);
  const normalizedBundle: IntelligenceCycleBundle = {
    envelope: bundle.envelope,
    hypotheses: sortedHypotheses,
    conviction: bundle.conviction,
    informationSufficiencyProvenance: bundle.informationSufficiencyProvenance,
  };

  return runWaiaPostgresTransaction(db, async (tx) => {
    const envelopeRepo = createCycleEnvelopeRepositoryPostgres(tx);
    const hypothesisRepo = createHypothesisRecordRepositoryPostgres(tx);
    const convictionRepo = createConvictionRecordRepositoryPostgres(tx);

    await envelopeRepo.insert(context, normalizedBundle.envelope);

    for (const hypothesis of normalizedBundle.hypotheses) {
      await hypothesisRepo.insert(context, hypothesis);
    }

    await convictionRepo.insert(context, normalizedBundle.conviction);

    return normalizedBundle;
  });
}

export function createIntelligenceCycleBundleRepositoryPostgres(
  db: WaiaPostgresDb,
): IntelligenceCycleBundleRepository {
  return {
    persist(context, bundle) {
      return persistIntelligenceCycleBundle(context, bundle, db);
    },
  };
}
