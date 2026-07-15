import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { HtrWp14DecisionChainIncompleteError } from "@/lib/trader/intelligence/forecast-decision/errors";
import { createDecisionRecordRepositoryPostgres } from "@/lib/trader/intelligence/forecast-decision/decision-record-repository-postgres";
import { createCycleEnvelopeRepositoryPostgres } from "@/lib/trader/intelligence/records/cycle-envelope-repository-postgres";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type AssertForecastDecisionChainCompleteInput = Readonly<{
  organizationId: string;
  runId: string;
  cycleId: string;
  symbol: string;
  wp13Persisted?: boolean;
}>;

export type AssertForecastDecisionChainCompleteDeps = Readonly<{
  db?: WaiaPostgresDb;
}>;

export async function assertForecastDecisionChainComplete(
  context: OrgContext,
  input: AssertForecastDecisionChainCompleteInput,
  deps: AssertForecastDecisionChainCompleteDeps = {},
): Promise<void> {
  if (!deps.db) {
    return;
  }

  const envelopeRepo = createCycleEnvelopeRepositoryPostgres(deps.db);
  const decisionRepo = createDecisionRecordRepositoryPostgres(deps.db);

  const envelope = await envelopeRepo.findByBusinessKey(context, {
    runId: input.runId,
    cycleId: input.cycleId,
    symbol: input.symbol,
  });

  if (!envelope) {
    if (input.wp13Persisted) {
      throw new HtrWp14DecisionChainIncompleteError(
        "WP13 cycle envelope persisted but WP14 decision record missing",
      );
    }
    return;
  }

  const decision = await decisionRepo.findByBusinessKey(context, {
    runId: input.runId,
    cycleId: input.cycleId,
    symbol: input.symbol,
  });

  if (!decision) {
    throw new HtrWp14DecisionChainIncompleteError(
      "WP13 cycle envelope exists but authoritative LD-7 decision record is missing",
    );
  }
}
