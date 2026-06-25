import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  FeeComputationHwmNotBootstrappedError,
  FeeComputationPeriodNotClosedError,
  FeeComputationPeriodNotFoundError,
  FeeComputationPriorPeriodRealizedPnlMissingError,
  FeeComputationRealizedPnlMissingError,
} from "@/lib/trader/billing/fee-computation.errors";
import {
  computeFeeComputation,
  foldCumulativeRealizedStrategyProfit,
  selectClosedPeriodsUpToTarget,
} from "@/lib/trader/billing/fee-computation";
import type { FeeComputationArtifact } from "@/lib/trader/billing/fee-computation.types";
import type { HwmLedgerService } from "@/lib/trader/billing/hwm-ledger-service";
import {
  createPostgresHwmLedgerService,
  createSqliteHwmLedgerService,
} from "@/lib/trader/billing/hwm-ledger-service";
import type { ReportingPeriodRepository } from "@/lib/trader/billing/reporting-period-repository.types";
import { MAX_REPORTING_PERIODS_LIST_LIMIT } from "@/lib/trader/billing/reporting-period-repository.types";
import {
  createPostgresReportingPeriodRepository,
  createSqliteReportingPeriodRepository,
} from "@/lib/trader/billing/repository-adapters";
import {
  assertOrgMembershipPostgres,
  assertOrgMembershipSqlite,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgFeeComputationExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

export type ComputeFeeForPeriodInput = {
  periodId: string;
  realizedFillFinality?: boolean;
  computedAt?: Date;
};

export type FeeComputationServiceDeps = {
  reportingPeriodRepository: ReportingPeriodRepository;
  hwmLedgerService: Pick<HwmLedgerService, "getCurrentHwm">;
  assertMembership?: (context: OrgContext & { userId: string }) => void | Promise<void>;
};

export type FeeComputationService = {
  computeFeeForPeriod(
    context: OrgContext,
    input: ComputeFeeForPeriodInput,
  ): Promise<FeeComputationArtifact>;
};

async function assertMembershipIfNeeded(
  context: OrgContext,
  assertMembership: FeeComputationServiceDeps["assertMembership"],
): Promise<void> {
  if (context.userId && assertMembership) {
    await assertMembership({ organizationId: context.organizationId, userId: context.userId });
  }
}

function assertClosedPeriodRealizedPnl(
  periodId: string,
  realizedPnl: string | null,
): asserts realizedPnl is string {
  if (realizedPnl === null) {
    throw new FeeComputationRealizedPnlMissingError(periodId);
  }
}

export function createFeeComputationService(
  deps: FeeComputationServiceDeps,
): FeeComputationService {
  return {
    async computeFeeForPeriod(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);

      const period = await deps.reportingPeriodRepository.getById(scoped, input.periodId);
      if (!period) {
        throw new FeeComputationPeriodNotFoundError(input.periodId);
      }

      if (period.status !== "CLOSED") {
        throw new FeeComputationPeriodNotClosedError(input.periodId, period.status);
      }

      assertClosedPeriodRealizedPnl(period.id, period.realizedPnl);

      const currentHwm = await deps.hwmLedgerService.getCurrentHwm(
        scoped,
        period.exchangeAccountId,
      );
      if (!currentHwm) {
        throw new FeeComputationHwmNotBootstrappedError(period.exchangeAccountId);
      }

      const closedPeriods = await deps.reportingPeriodRepository.listClosedPeriods(scoped, {
        exchangeAccountId: period.exchangeAccountId,
        limit: MAX_REPORTING_PERIODS_LIST_LIMIT,
      });

      const periodsForFold = selectClosedPeriodsUpToTarget(closedPeriods, period.id);
      if (periodsForFold.length === 0 || periodsForFold.at(-1)?.id !== period.id) {
        throw new FeeComputationPeriodNotFoundError(input.periodId);
      }

      for (const closedPeriod of periodsForFold) {
        if (closedPeriod.realizedPnl === null) {
          throw new FeeComputationPriorPeriodRealizedPnlMissingError(closedPeriod.id);
        }
      }

      const cumulativeRealizedStrategyProfit = foldCumulativeRealizedStrategyProfit(periodsForFold);

      return computeFeeComputation({
        periodId: period.id,
        organizationId: period.organizationId,
        exchangeAccountId: period.exchangeAccountId,
        periodRealizedStrategyProfit: period.realizedPnl,
        cumulativeRealizedStrategyProfit,
        previousHighWaterMark: currentHwm.highWaterMark,
        unrealizedPnl: period.unrealizedPnl,
        realizedFillFinality: input.realizedFillFinality ?? false,
        computedAt: input.computedAt,
      });
    },
  };
}

export function createSqliteFeeComputationService(
  db: WaiaDb,
  deps: Partial<FeeComputationServiceDeps> = {},
): FeeComputationService {
  return createFeeComputationService({
    reportingPeriodRepository:
      deps.reportingPeriodRepository ?? createSqliteReportingPeriodRepository(db),
    hwmLedgerService: deps.hwmLedgerService ?? createSqliteHwmLedgerService(db),
    assertMembership:
      deps.assertMembership ??
      ((context) => {
        assertOrgMembershipSqlite(db, context);
      }),
  });
}

export function createPostgresFeeComputationService(
  ex: PgFeeComputationExecutor,
  deps: Partial<FeeComputationServiceDeps> = {},
  db?: WaiaPostgresDb,
): FeeComputationService {
  return createFeeComputationService({
    reportingPeriodRepository:
      deps.reportingPeriodRepository ?? createPostgresReportingPeriodRepository(ex, db),
    hwmLedgerService: deps.hwmLedgerService ?? createPostgresHwmLedgerService(ex, {}, db),
    assertMembership:
      deps.assertMembership ??
      (async (context) => {
        await assertOrgMembershipPostgres(ex, context);
      }),
  });
}
