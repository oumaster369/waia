import "server-only";

import {
  DEFAULT_DASHBOARD_IDENTITY_LABEL,
  DEFAULT_READINESS_INPUT,
  DEFAULT_TWIN_DIALOGUE_SIGNALS,
} from "@/lib/dashboard/readiness-snapshot-default";
import type { DashboardReadinessPayload } from "@/lib/dashboard/dashboard-readiness-api.types";
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

/**
 * Single server snapshot for dashboard readiness until auth + persistence replace this.
 * The page and GET /api/dashboard/readiness consume the same loader (HTTP contract documented on the route).
 */
export async function getDashboardReadinessPayload(): Promise<DashboardReadinessPayload> {
  return {
    readinessInput: DEFAULT_READINESS_INPUT,
    twinSignals: DEFAULT_TWIN_DIALOGUE_SIGNALS,
    identityLabel: DEFAULT_DASHBOARD_IDENTITY_LABEL,
    hintsByIndicator: NULL_HINTS_BY_INDICATOR,
  };
}
