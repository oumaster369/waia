import { INDICATOR_KEYS_ORDER, type IndicatorKey } from "@/lib/readiness/types";

/** Placeholder hints (DEE-17); keys match readiness model indicator order. */
export const NULL_HINTS_BY_INDICATOR: Record<IndicatorKey, string | null> =
  INDICATOR_KEYS_ORDER.reduce(
    (acc, key) => {
      acc[key] = null;
      return acc;
    },
    {} as Record<IndicatorKey, string | null>,
  );
