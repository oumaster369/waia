import { financialHistoryFiltersSchema } from "@/lib/trader/account-observation/financial-history";

/** Date inputs are calendar days in UTC; the through day is included. */
export function financialHistoryPeriodFromDates(startDate: string, throughDate: string) {
  const midnight = (raw: string): number | null => {
    if (raw === "") return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error("INVALID_HISTORY_DATE");
    const ms = Date.parse(`${raw}T00:00:00.000Z`);
    if (!Number.isFinite(ms) || ms < 0 || new Date(ms).toISOString().slice(0, 10) !== raw)
      throw new Error("INVALID_HISTORY_DATE");
    return ms;
  };
  const start = midnight(startDate);
  const through = midnight(throughDate);
  return financialHistoryFiltersSchema.parse({
    windowStartMs: start,
    windowEndMs: through === null ? null : through + 86_400_000,
  });
}
