import {
  assertHistoricalKnowledgeSnapshotAuthorityV2,
} from "@/lib/trader/intelligence/forecast-v2/historical-knowledge-snapshot-authority-v2";
import type { ForecastRuntimeInputV2 } from
  "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";
import type {
  HistoricalKnowledgePortV2,
  HistoricalKnowledgeSnapshotV2,
  HistoricalMaturedClosureV2,
  HistoricalSimulationV2Cycle,
} from "@/lib/trader/backtest/historical-simulation-v2";

export const HISTORICAL_FUTURE_ONLY_LEARNING_V2 =
  "waia.trader.historical_future_only_learning.v2" as const;

const DIGEST = /^[0-9a-f]{64}$/;

function refuse(reason: string): never {
  throw new Error(`HISTORICAL_FUTURE_ONLY_LEARNING_REFUSED:${reason}`);
}

function requireSnapshot(
  value: HistoricalKnowledgeSnapshotV2,
  pitAnchor: string,
  reason: string,
): void {
  if (value.asOf !== pitAnchor || !DIGEST.test(value.contentDigestHex)) refuse(reason);
}

/**
 * The single chronology boundary between objective outcome closure and the next
 * historical Forecast.  Knowledge may affect only a Forecast whose PIT is
 * strictly later than every outcome it consumes.  The Forecast must carry the
 * exact run-scoped snapshot authority returned after those closures are
 * applied; a caller cannot silently keep using a pre-learning runtime input.
 */
export async function prepareHistoricalFutureOnlyForecastV2(input: Readonly<{
  organizationId: string;
  runId: string;
  split: "development" | "walk_forward";
  cycle: HistoricalSimulationV2Cycle;
  knowledge: HistoricalKnowledgePortV2;
  resolveForecastInput(context: Readonly<{
    cycle: HistoricalSimulationV2Cycle;
    knowledge: HistoricalKnowledgeSnapshotV2;
  }>): Promise<ForecastRuntimeInputV2>;
}>): Promise<Readonly<{
  knowledgeBefore: HistoricalKnowledgeSnapshotV2;
  knowledgeAfterClosure: HistoricalKnowledgeSnapshotV2;
  closures: readonly HistoricalMaturedClosureV2[];
  forecastInput: ForecastRuntimeInputV2;
}>> {
  if (!input.organizationId.trim() || !input.runId.trim() ||
      (input.split !== "development" && input.split !== "walk_forward")) {
    refuse("SCOPE");
  }
  const pitEpoch = Date.parse(input.cycle.observedAt);
  if (!Number.isSafeInteger(pitEpoch) ||
      new Date(pitEpoch).toISOString() !== input.cycle.observedAt) {
    refuse("PIT");
  }

  const before = await input.knowledge.snapshotAsOf(input.cycle.observedAt);
  requireSnapshot(before, input.cycle.observedAt, "KNOWLEDGE_BEFORE");
  const closures = await input.knowledge.closeMaturedForecasts(input.cycle.observedAt);
  const seenForecasts = new Set<string>();
  const seenOutcomes = new Set<string>();
  for (const closure of closures) {
    const maturedEpoch = Date.parse(closure.maturedAt);
    if (!Number.isSafeInteger(maturedEpoch) ||
        new Date(maturedEpoch).toISOString() !== closure.maturedAt ||
        maturedEpoch >= pitEpoch ||
        !DIGEST.test(closure.forecastAuthorityContentDigestHex) ||
        !DIGEST.test(closure.outcomeContentDigestHex) ||
        seenForecasts.has(closure.forecastAuthorityContentDigestHex) ||
        seenOutcomes.has(closure.outcomeContentDigestHex)) {
      refuse("CLOSURE_AUTHORITY");
    }
    seenForecasts.add(closure.forecastAuthorityContentDigestHex);
    seenOutcomes.add(closure.outcomeContentDigestHex);
  }

  const after = await input.knowledge.applyMaturedClosures({
    strictlyBefore: input.cycle.observedAt,
    closures,
  });
  requireSnapshot(after, input.cycle.observedAt, "KNOWLEDGE_AFTER");

  const forecastInput = await input.resolveForecastInput({
    cycle: input.cycle,
    knowledge: after,
  });
  const authority = forecastInput.historicalKnowledgeSnapshotAuthority;
  if (!authority) refuse("FORECAST_KNOWLEDGE_AUTHORITY_MISSING");
  try {
    assertHistoricalKnowledgeSnapshotAuthorityV2(authority);
  } catch {
    refuse("FORECAST_KNOWLEDGE_AUTHORITY_INVALID");
  }
  if (authority.organizationId !== input.organizationId ||
      authority.runId !== input.runId ||
      authority.symbol !== input.cycle.symbol ||
      authority.pitAnchor !== input.cycle.observedAt ||
      authority.knowledgeContentDigestHex !== after.contentDigestHex ||
      forecastInput.knowledgeContentDigestHex !== after.contentDigestHex) {
    refuse("FORECAST_KNOWLEDGE_BINDING");
  }

  return Object.freeze({
    knowledgeBefore: before,
    knowledgeAfterClosure: after,
    closures: Object.freeze([...closures]),
    forecastInput,
  });
}
