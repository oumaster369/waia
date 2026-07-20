import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { getLatestCandidateForStrategyPostgres } from "@/lib/trader/research/strategy-candidate-repository-postgres";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export class M9CandidateConflictError extends Error {
  readonly code = "M9_CANDIDATE_CONFLICT";
  readonly existingCandidateId: string;
  readonly existingStatus: string;

  constructor(input: {
    strategyId: string;
    strategyVersion: string;
    candidateId: string;
    status: string;
  }) {
    super(
      `[m9] strategy candidate already exists for ${input.strategyId}@${input.strategyVersion} ` +
        `(id=${input.candidateId}, status=${input.status}) — bump --strategy-version or use --campaign-suffix`,
    );
    this.name = "M9CandidateConflictError";
    this.existingCandidateId = input.candidateId;
    this.existingStatus = input.status;
  }
}

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;

/**
 * Preflight guard against Postgres duplicate-key on trader_strategy_candidates
 * (see replay-runs/RI-P7/dee-371-artifact-check/run.log).
 */
export async function assertStrategyCandidateSlotAvailablePostgres(
  ex: PgReadExecutor,
  context: OrgContext,
  strategyId: string,
  strategyVersion: string,
): Promise<void> {
  const existing = await getLatestCandidateForStrategyPostgres(
    ex,
    context,
    strategyId,
    strategyVersion,
  );
  if (existing) {
    throw new M9CandidateConflictError({
      strategyId,
      strategyVersion,
      candidateId: existing.id,
      status: existing.status,
    });
  }
}

export function applyCampaignSuffixToStrategyVersion(
  strategyVersion: string,
  campaignSuffix: string | undefined,
): string {
  const suffix = campaignSuffix?.trim();
  if (!suffix) {
    return strategyVersion;
  }
  return `${strategyVersion}+${suffix}`;
}
