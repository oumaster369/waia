import { createHash } from "node:crypto";

import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  createStrategyTrialRepositoryPostgres,
  type StrategyTrialRepository,
} from "@/lib/trader/intelligence/strategies/strategy-trial-repository-postgres";
import type {
  StrategyTrialCounts,
  StrategyTrialEvent,
  StrategyTrialRegistrationInput,
} from "@/lib/trader/intelligence/strategies/strategy-trial.types";
import { canonicalJsonString } from "@/lib/trader/research/digest";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export class StrategyTrialIdempotencyConflictError extends Error {
  readonly code = "HTR_WP16_TRIAL_IDEMPOTENCY_CONFLICT";

  constructor(message: string) {
    super(message);
    this.name = "StrategyTrialIdempotencyConflictError";
  }
}

export class StrategyTrialPitViolationError extends Error {
  readonly code = "STRAT_TRIAL_PIT_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "StrategyTrialPitViolationError";
  }
}

export type StrategyTrialService = {
  registerStrategyTrial(
    context: OrgContext,
    input: StrategyTrialRegistrationInput,
  ): Promise<StrategyTrialEvent>;
  getStrategyTrialCounts(
    context: OrgContext,
    strategyId: string,
    strategyVersion: string,
    runId: string,
  ): Promise<StrategyTrialCounts>;
};

function buildTrialContentDigest(input: {
  organizationId: string;
  strategyId: string;
  strategyVersion: string;
  runId: string;
  cycleId: string;
  symbol: string;
  accountKey: string;
  portfolioId: string;
  seq: number;
  eventTime: string;
  registeredBy: string;
}): string {
  return createHash("sha256")
    .update(
      canonicalJsonString({
        organizationId: input.organizationId,
        strategyId: input.strategyId,
        strategyVersion: input.strategyVersion,
        runId: input.runId,
        cycleId: input.cycleId,
        symbol: input.symbol,
        accountKey: input.accountKey,
        portfolioId: input.portfolioId,
        seq: input.seq,
        eventTime: input.eventTime,
        registeredBy: input.registeredBy,
      }),
      "utf8",
    )
    .digest("hex");
}

export function createStrategyTrialService(
  repository: StrategyTrialRepository,
): StrategyTrialService {
  return {
    async registerStrategyTrial(context, input) {
      if (new Date(input.ingestTime).getTime() < new Date(input.eventTime).getTime()) {
        throw new StrategyTrialPitViolationError("ingest_time must be >= event_time");
      }

      const existing = await repository.findByBusinessKey(context, {
        strategyId: input.strategyId,
        strategyVersion: input.strategyVersion,
        runId: input.runId,
        cycleId: input.cycleId,
        symbol: input.symbol,
      });
      if (existing) {
        if (existing.id === input.deterministicId) {
          return existing;
        }
        throw new StrategyTrialIdempotencyConflictError(
          "trial business key conflict with mismatched id",
        );
      }

      const maxSeq = await repository.getMaxSeq(
        context,
        input.strategyId,
        input.strategyVersion,
        input.runId,
      );
      const seq = (maxSeq ?? 0) + 1;
      const contentDigest = buildTrialContentDigest({
        organizationId: context.organizationId,
        strategyId: input.strategyId,
        strategyVersion: input.strategyVersion,
        runId: input.runId,
        cycleId: input.cycleId,
        symbol: input.symbol,
        accountKey: input.accountKey,
        portfolioId: input.portfolioId,
        seq,
        eventTime: input.eventTime,
        registeredBy: input.registeredBy,
      });

      return repository.insert(context, {
        id: input.deterministicId,
        organizationId: context.organizationId,
        strategyId: input.strategyId,
        strategyVersion: input.strategyVersion,
        runId: input.runId,
        cycleId: input.cycleId,
        symbol: input.symbol,
        accountKey: input.accountKey,
        portfolioId: input.portfolioId,
        seq,
        eventTime: input.eventTime,
        ingestTime: input.ingestTime,
        registeredBy: input.registeredBy,
        contentDigest,
      });
    },

    async getStrategyTrialCounts(context, strategyId, strategyVersion, runId) {
      const total = await repository.countByRun(context, strategyId, strategyVersion, runId);
      return { strategyId, strategyVersion, runId, total };
    },
  };
}

export function createStrategyTrialServicePostgres(
  ex: Pick<WaiaPostgresDb, "select" | "insert">,
): StrategyTrialService {
  return createStrategyTrialService(createStrategyTrialRepositoryPostgres(ex));
}
