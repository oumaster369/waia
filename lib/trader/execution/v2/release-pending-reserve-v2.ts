import { and, eq, sql } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { ExecutionReportV2 } from "@/lib/trader/execution/v2/contracts";
import { formatDecimal, parseDecimal } from "@/lib/trader/risk/numeric";

type ReleaseExecutor = Pick<WaiaPostgresDb, "select" | "update" | "execute">;

export class PendingReserveReleaseError extends Error {
  constructor(readonly reason: string) {
    super(`Execution V2 pending reserve release refused: ${reason}`);
    this.name = "PendingReserveReleaseError";
  }
}

function alreadyReleased(priorReports: readonly ExecutionReportV2[]): boolean {
  return priorReports.some((report) => report.rawObservation.pendingReserveReleased === true);
}

/**
 * Moves a consumed allowance's reserved notional out of worst-case pending.
 * Does not change the allowance lifecycle and does not touch outstanding
 * reservations. A prior release flag skips the subtraction.
 */
export async function releaseWorstCasePendingForRejectedAttemptV2(
  tx: ReleaseExecutor,
  input: Readonly<{
    organizationId: string;
    accountId: string;
    riskAllowanceId: string;
    priorReports: readonly ExecutionReportV2[];
  }>,
): Promise<void> {
  if (alreadyReleased(input.priorReports)) return;
  await tx.execute(sql`select set_config('lock_timeout', '5s', true)`);
  const accounts = await tx
    .select({
      pending: pgSchema.traderRiskAccountStateV2.worstCasePendingExposureNotional,
      stateVersion: pgSchema.traderRiskAccountStateV2.stateVersion,
    })
    .from(pgSchema.traderRiskAccountStateV2)
    .where(
      and(
        eq(pgSchema.traderRiskAccountStateV2.organizationId, input.organizationId),
        eq(pgSchema.traderRiskAccountStateV2.accountId, input.accountId),
      ),
    )
    .limit(1)
    .for("update");
  const account = accounts[0];
  if (!account) throw new PendingReserveReleaseError("RISK_ACCOUNT_STATE_MISSING");
  const allowances = await tx
    .select({
      lifecycleState: pgSchema.traderRiskAllowancesV2.lifecycleState,
      reserved: pgSchema.traderRiskAllowancesV2.reservedExposureNotional,
    })
    .from(pgSchema.traderRiskAllowancesV2)
    .where(
      and(
        eq(pgSchema.traderRiskAllowancesV2.id, input.riskAllowanceId),
        eq(pgSchema.traderRiskAllowancesV2.organizationId, input.organizationId),
        eq(pgSchema.traderRiskAllowancesV2.accountId, input.accountId),
      ),
    )
    .limit(1)
    .for("update");
  const allowance = allowances[0];
  if (!allowance || allowance.lifecycleState !== "CONSUMED") {
    throw new PendingReserveReleaseError("ALLOWANCE_NOT_CONSUMED");
  }
  let next: string;
  try {
    const pending = parseDecimal(account.pending);
    const reserved = parseDecimal(allowance.reserved);
    if (pending < reserved) throw new PendingReserveReleaseError("PENDING_RESERVE_UNDERFLOW");
    next = formatDecimal(pending - reserved);
  } catch (error) {
    if (error instanceof PendingReserveReleaseError) throw error;
    throw new PendingReserveReleaseError("PENDING_RESERVE_UNDERFLOW");
  }
  const updated = await tx
    .update(pgSchema.traderRiskAccountStateV2)
    .set({
      worstCasePendingExposureNotional: next,
      stateVersion: account.stateVersion + 1n,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(pgSchema.traderRiskAccountStateV2.organizationId, input.organizationId),
        eq(pgSchema.traderRiskAccountStateV2.accountId, input.accountId),
        eq(pgSchema.traderRiskAccountStateV2.stateVersion, account.stateVersion),
      ),
    )
    .returning({ accountId: pgSchema.traderRiskAccountStateV2.accountId });
  if (updated.length !== 1)
    throw new PendingReserveReleaseError("PENDING_RESERVE_RELEASE_CONFLICT");
}
