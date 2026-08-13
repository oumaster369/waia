import { computeTreasuryContentDigest } from "@/lib/waia-core/treasury/digest";
import { TreasuryValidationError } from "@/lib/waia-core/treasury/errors";
import { requireBigint } from "@/lib/waia-core/treasury/money";
import { isActiveCommittedStatus } from "@/lib/waia-core/treasury/commitment-fsm";
import type { TreasuryRunwayPlanRecord } from "@/lib/waia-core/treasury/admin/catalog-types";
import type {
  TreasuryCommitmentRecord,
  TreasuryTransactionRecord,
} from "@/lib/waia-core/treasury/types";
import { BREATH_DAY_MS, breathPendingReasons } from "@/lib/waia-core/treasury/breath/types";

export function computeRunwayEndsAt(input: {
  runwayAsOf: Date;
  freeFundsAtAsOfMicros: bigint;
  approvedDailyBurnMicros: bigint;
}): Date {
  const free = requireBigint(input.freeFundsAtAsOfMicros, "freeFundsAtAsOfMicros");
  const burn = requireBigint(input.approvedDailyBurnMicros, "approvedDailyBurnMicros");
  if (burn <= 0n) {
    throw new TreasuryValidationError(
      breathPendingReasons.ACTIVE_RUNWAY_PLAN_AMBIGUOUS,
      "Approved daily burn must be > 0",
    );
  }
  const durationMs = (free * BREATH_DAY_MS) / burn;
  const asOfMs = BigInt(input.runwayAsOf.getTime());
  const endsMs = asOfMs + durationMs;
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  const min = BigInt(Number.MIN_SAFE_INTEGER);
  if (endsMs > max || endsMs < min) {
    throw new TreasuryValidationError(
      breathPendingReasons.RUNWAY_DATE_OUT_OF_RANGE,
      "Runway endsAt cannot be represented as a Date",
    );
  }
  const asNumber = Number(endsMs);
  if (!Number.isSafeInteger(asNumber)) {
    throw new TreasuryValidationError(
      breathPendingReasons.RUNWAY_DATE_OUT_OF_RANGE,
      "Runway endsAt is not a safe integer millisecond value",
    );
  }
  const endsAt = new Date(asNumber);
  if (Number.isNaN(endsAt.getTime())) {
    throw new TreasuryValidationError(
      breathPendingReasons.RUNWAY_DATE_OUT_OF_RANGE,
      "Runway endsAt is not a valid Date",
    );
  }
  return endsAt;
}

export function computeRunwayInputDigest(input: {
  verified: readonly TreasuryTransactionRecord[];
  commitments: readonly TreasuryCommitmentRecord[];
  plan: TreasuryRunwayPlanRecord;
  freeFundsAtAsOfMicros: bigint;
}): string {
  const verified = [...input.verified]
    .filter((row) => row.status === "VERIFIED")
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((row) => ({
      id: row.id,
      cashEffectMicros: row.cashEffectMicros?.toString(10) ?? null,
      recordContentDigest: row.recordContentDigest,
      verifiedAt: row.verifiedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    }));
  const commitments = [...input.commitments]
    .filter((row) => isActiveCommittedStatus(row.status))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((row) => ({
      id: row.id,
      amountMicros: row.amountMicros.toString(10),
      status: row.status,
      recordContentDigest: row.recordContentDigest,
      updatedAt: row.updatedAt.toISOString(),
    }));
  return computeTreasuryContentDigest({
    verified,
    commitments,
    plan: {
      id: input.plan.id,
      dailyBurnMicros: input.plan.dailyBurnMicros.toString(10),
      currency: input.plan.currency,
      effectiveFrom: input.plan.effectiveFrom.toISOString(),
      effectiveTo: input.plan.effectiveTo?.toISOString() ?? null,
      status: input.plan.status,
    },
    freeFundsAtAsOfMicros: input.freeFundsAtAsOfMicros.toString(10),
  });
}
