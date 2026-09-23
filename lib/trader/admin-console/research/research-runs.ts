import { researchProgress } from "@/lib/trader/admin-console/research/strategy-stats";

const STALE_AFTER_MS = 10 * 60 * 1000;

export function presentResearchRun(input: {
  organizationId: string;
  runId: string;
  phase: string;
  committedCycles: number;
  qualifiedTotalCycles: number;
  observedAt: string;
  symbol: string;
  partition: string;
  nowMs: number;
}): {
  organizationId: string;
  runId: string;
  phase: string;
  symbol: string;
  partition: string;
  observedAt: string;
  progress: ReturnType<typeof researchProgress>;
  inactive: boolean;
} {
  const observedMs = Date.parse(input.observedAt);
  const active = input.phase === "RUNNING" || input.phase === "QUEUED";
  return {
    organizationId: input.organizationId,
    runId: input.runId,
    phase: input.phase,
    symbol: input.symbol,
    partition: input.partition,
    observedAt: input.observedAt,
    progress: researchProgress(input.committedCycles, input.qualifiedTotalCycles),
    inactive: active && Number.isFinite(observedMs) && input.nowMs - observedMs > STALE_AFTER_MS,
  };
}
