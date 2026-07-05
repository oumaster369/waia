import { classifyBarWindowRegime } from "@/lib/trader/research/regime-coverage";
import type { Bar } from "@/lib/trader/intelligence/types";
import {
  OBSERVATION_SCHEMA_VERSION,
  type ObservationRecord,
  type ObservationSynthesizerInput,
  type ObservationTradeRef,
} from "@/lib/trader/discovery/observation.types";
import { buildObservationContentDigest } from "@/lib/trader/discovery/serialize-discovery";
import { assertNoBannedFields } from "@/lib/trader/discovery/no-reinforcement-guard";

function defaultResolveRegimeForTrade(
  trade: ObservationSynthesizerInput["closedTrades"][number],
  bars: readonly Bar[],
): string | null {
  const tradeTime = trade.executedAt.toISOString();
  const windowBars = bars.filter(
    (bar) => bar.barCloseTime <= tradeTime && bars.indexOf(bar) >= Math.max(0, bars.length - 20),
  );
  if (windowBars.length < 20) {
    return null;
  }
  try {
    return classifyBarWindowRegime(windowBars.slice(-20));
  } catch {
    return null;
  }
}

function buildTradeRefs(input: ObservationSynthesizerInput): ObservationTradeRef[] {
  const resolve = input.resolveRegimeForTrade ?? defaultResolveRegimeForTrade;
  return input.closedTrades.map((trade) => ({
    fillId: trade.fillId,
    symbol: trade.symbol,
    executedAt: trade.executedAt.toISOString(),
    regimeLabel: resolve(trade, input.bars),
  }));
}

function collectObservedRegimes(
  tradeRefs: readonly ObservationTradeRef[],
  bars: readonly Bar[],
): string[] {
  const regimes = new Set<string>();
  for (const ref of tradeRefs) {
    if (ref.regimeLabel) {
      regimes.add(ref.regimeLabel);
    }
  }
  if (bars.length >= 20) {
    try {
      regimes.add(classifyBarWindowRegime(bars.slice(-20)));
    } catch {
      // insufficient window — skip
    }
  }
  return [...regimes].sort((a, b) => a.localeCompare(b));
}

export function synthesizeObservations(
  input: ObservationSynthesizerInput,
  observationId: string,
  createdAt = new Date().toISOString(),
): ObservationRecord {
  assertNoBannedFields(input.patternObservations ?? [], "patternObservations");
  assertNoBannedFields(input.eventObservations ?? [], "eventObservations");

  const tradeRefs = buildTradeRefs(input);
  const observedRegimes = collectObservedRegimes(tradeRefs, input.bars);

  const draft: Omit<ObservationRecord, "contentDigest"> = {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    observationId,
    campaignRef: input.campaignRef,
    barWindow: {
      symbol: input.barWindow.symbol,
      interval: input.bars[0]?.interval ?? "1m",
      start: input.barWindow.start,
      end: input.barWindow.end,
      barCount: input.bars.length,
    },
    observedRegimes,
    tradeRefs,
    patternRefs: input.patternObservations ?? [],
    eventRefs: input.eventObservations ?? [],
    createdAt,
  };

  return {
    ...draft,
    contentDigest: buildObservationContentDigest(draft),
  };
}
