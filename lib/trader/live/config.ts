/** Default org live-enable cooling-off when env override is unset (15 minutes). */
export const DEFAULT_ORG_LIVE_ENABLE_COOLING_OFF_MS = 900_000;

/** Typed operator acknowledgement for org live-enable confirmation (ADR-0011). */
export const REQUIRED_ORG_LIVE_ENABLE_ACK = "ENABLE ORG-0 LIVE TRADING";

export function effectiveOrgLiveEnableCoolingOffMs(coolingOffMs?: number | null): number {
  const envValue = process.env.TRADER_ORG_LIVE_ENABLE_COOLING_OFF_MS;
  if (coolingOffMs != null) {
    return coolingOffMs;
  }
  if (envValue !== undefined && envValue.trim() !== "") {
    const parsed = Number.parseInt(envValue, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_ORG_LIVE_ENABLE_COOLING_OFF_MS;
}
