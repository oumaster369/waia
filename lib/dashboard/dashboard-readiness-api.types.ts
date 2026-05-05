import type {
  IndicatorKey,
  ReadinessInput,
  ReadinessResult,
} from "@/lib/readiness/types";

import type { TwinDialogueSignals } from "@/lib/dashboard/readiness-snapshot-default";

/** Serializable slice before derived readiness fields (HTTP + RSC source). */
export type DashboardReadinessPayload = {
  readinessInput: ReadinessInput;
  twinSignals: TwinDialogueSignals;
  identityLabel: string;
  /** Missing-data copy per indicator; null until DEE-17 supplies strings. */
  hintsByIndicator: Record<IndicatorKey, string | null>;
};

/** GET /api/dashboard/readiness JSON body. */
export type DashboardReadinessApiResponse = DashboardReadinessPayload & {
  readinessResult: ReadinessResult;
};
