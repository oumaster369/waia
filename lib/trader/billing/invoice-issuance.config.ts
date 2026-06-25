/** Default issuance cooling-off when env override is unset (15 minutes — ADR-0011). */
export const DEFAULT_INVOICE_ISSUANCE_COOLING_OFF_MS = 900_000;

/** Default approval validity window after which re-approval is required (24 hours). */
export const DEFAULT_INVOICE_APPROVAL_VALIDITY_MS = 86_400_000;

export function effectiveInvoiceIssuanceCoolingOffMs(coolingOffMs?: number | null): number {
  if (coolingOffMs != null) {
    return coolingOffMs;
  }
  const envValue = process.env.TRADER_INVOICE_ISSUANCE_COOLING_OFF_MS;
  if (envValue !== undefined && envValue.trim() !== "") {
    const parsed = Number.parseInt(envValue, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_INVOICE_ISSUANCE_COOLING_OFF_MS;
}

export function effectiveInvoiceApprovalValidityMs(validityMs?: number | null): number {
  if (validityMs != null) {
    return validityMs;
  }
  const envValue = process.env.TRADER_INVOICE_APPROVAL_VALIDITY_MS;
  if (envValue !== undefined && envValue.trim() !== "") {
    const parsed = Number.parseInt(envValue, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_INVOICE_APPROVAL_VALIDITY_MS;
}

export function computeCoolingOffUntil(approvedAt: Date, coolingOffMs?: number | null): Date {
  return new Date(approvedAt.getTime() + effectiveInvoiceIssuanceCoolingOffMs(coolingOffMs));
}

export function computeApprovalExpiresAt(approvedAt: Date, validityMs?: number | null): Date {
  return new Date(approvedAt.getTime() + effectiveInvoiceApprovalValidityMs(validityMs));
}
