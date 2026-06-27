/** Default promotion cooling-off when env override is unset (15 minutes — matches kill-switch recovery default). */
export const DEFAULT_PROMOTION_COOLING_OFF_MS = 900_000;

export function effectivePromotionCoolingOffMs(coolingOffMs?: number | null): number {
  const envValue = process.env.TRADER_PROMOTION_COOLING_OFF_MS;
  if (coolingOffMs != null) {
    return coolingOffMs;
  }
  if (envValue !== undefined && envValue.trim() !== "") {
    const parsed = Number.parseInt(envValue, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_PROMOTION_COOLING_OFF_MS;
}
