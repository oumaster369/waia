import { createCostModelV1 } from "@/lib/trader/execution/cost-model";
import { runEvaluationCycle } from "@/lib/trader/intelligence/evaluation-cycle";
import { HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1 } from "@/lib/trader/intelligence/historical-profile/htr-historical-intelligence-profile-v1";
import { declareResearchNonCapitalInformationAuthorityV2 } from "@/lib/trader/intelligence/information-sufficiency";
import { createDeterministicReplayIdFactory } from "@/lib/trader/research/deterministic-replay-id-factory";
import type { Bar, EvaluationCycleResult } from "@/lib/trader/intelligence/types";

export function wp14Bars(count = 80): Bar[] {
  return Array.from({ length: count }, (_, i) => ({
    symbol: "BTC/USDT",
    interval: "1m" as const,
    open: "100",
    high: "101",
    low: "99",
    close: String(100 + i * 0.1),
    volume: "1",
    barOpenTime: new Date(Date.UTC(2024, 0, 1, 0, i)).toISOString(),
    barCloseTime: new Date(Date.UTC(2024, 0, 1, 0, i + 1)).toISOString(),
  }));
}

export function runWp14EvaluationCycle(
  overrides: Partial<Parameters<typeof runEvaluationCycle>[0]> = {},
): EvaluationCycleResult {
  const bars = overrides.bars ?? wp14Bars();
  const organizationId = overrides.organizationId ?? "org-wp14";
  return runEvaluationCycle({
    organizationId,
    bars,
    historicalProfile: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1,
    runId: "wp14-run",
    cycleId: "0",
    newId: createDeterministicReplayIdFactory(415_140),
    costModel: createCostModelV1("10", "5"),
    informationSufficiencyAuthority: declareResearchNonCapitalInformationAuthorityV2({
      organizationId,
      reason: "HTR_WP14_UNIT_TEST",
    }),
    ...overrides,
  });
}
