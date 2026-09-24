import type {
  AdminCoverage,
  AdminDataState,
  AdminFact,
  AdminMode,
  AdminReadEnvelope,
  AdminScope,
  AdminTimes,
} from "@/lib/trader/admin-console/contracts";
import { adminRevision } from "@/lib/trader/admin-console/revision";

export const EMPTY_TIMES: AdminTimes = {
  sourceAt: null,
  observedAt: null,
  effectiveAt: null,
};

export function adminFact<T>(input: {
  state: AdminDataState;
  value: T | null;
  reasons?: string[];
  source?: string | null;
  times?: AdminTimes;
  breakdownRef?: string;
}): AdminFact<T> {
  return {
    state: input.state,
    value: input.value,
    times: input.times ?? EMPTY_TIMES,
    source: input.source ?? null,
    reasons: input.reasons ?? [],
    ...(input.breakdownRef ? { breakdownRef: input.breakdownRef } : {}),
  };
}

export function adminEnvelope<T>(input: {
  data: T;
  scope: AdminScope;
  mode?: AdminMode | "all";
  coverage?: AdminCoverage | null;
  missingSources?: string[];
  generatedAt?: string;
  cursor?: string;
  financeRevision?: string;
}): AdminReadEnvelope<T> {
  return {
    schemaVersion: "admin-console/v1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    revision: adminRevision(input.data),
    ...(input.financeRevision ? { financeRevision: input.financeRevision } : {}),
    ...(input.cursor ? { cursor: input.cursor } : {}),
    scope: input.scope,
    mode: input.mode ?? "all",
    coverage: input.coverage ?? null,
    missingSources: input.missingSources ?? [],
    data: input.data,
  };
}
