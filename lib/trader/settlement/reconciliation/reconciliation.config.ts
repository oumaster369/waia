/** Default operator claim lease (30 minutes). */
export const DEFAULT_RECONCILIATION_CLAIM_LEASE_MS = 1_800_000;

/** Default reconciliation cooling-off when env override is unset (15 minutes — ADR-0011). */
export const DEFAULT_RECONCILIATION_COOLING_OFF_MS = 900_000;

export function effectiveReconciliationClaimLeaseMs(leaseMs?: number | null): number {
  if (leaseMs != null) {
    return leaseMs;
  }
  const envValue = process.env.TRADER_RECONCILIATION_CLAIM_LEASE_MS;
  if (envValue !== undefined && envValue.trim() !== "") {
    const parsed = Number.parseInt(envValue, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_RECONCILIATION_CLAIM_LEASE_MS;
}

export function effectiveReconciliationCoolingOffMs(coolingOffMs?: number | null): number {
  if (coolingOffMs != null) {
    return coolingOffMs;
  }
  const envValue = process.env.TRADER_RECONCILIATION_COOLING_OFF_MS;
  if (envValue !== undefined && envValue.trim() !== "") {
    const parsed = Number.parseInt(envValue, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_RECONCILIATION_COOLING_OFF_MS;
}

export function computeClaimExpiresAt(now: Date, leaseMs?: number | null): Date {
  return new Date(now.getTime() + effectiveReconciliationClaimLeaseMs(leaseMs));
}

export function computeReconciliationCoolingOffUntil(
  proposedAt: Date,
  coolingOffMs?: number | null,
): Date {
  return new Date(proposedAt.getTime() + effectiveReconciliationCoolingOffMs(coolingOffMs));
}
