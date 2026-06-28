/** Default grace period before an ISSUED invoice triggers account suspension (7 days). */
export const DEFAULT_INVOICE_PAYMENT_GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

export function parseInvoicePaymentGracePeriodMs(env: Record<string, unknown> = {}): number {
  const raw = env.TRADER_INVOICE_PAYMENT_GRACE_PERIOD_MS;
  if (typeof raw !== "string" || raw.trim() === "") {
    return DEFAULT_INVOICE_PAYMENT_GRACE_PERIOD_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_INVOICE_PAYMENT_GRACE_PERIOD_MS;
}
