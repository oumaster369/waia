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

const BAR_INTERVALS = new Set(["1m", "15m", "1h", "4h", "1d"]);

function refuseInput(reason: string): never {
  throw new Error(`DISCOVERY_OBSERVATION_INPUT_INVALID:${reason}`);
}

function timestampMs(value: unknown, field: string): number {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    refuseInput(`TIMESTAMP:${field}`);
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) refuseInput(`TIMESTAMP:${field}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
  if (day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59) {
    refuseInput(`TIMESTAMP:${field}`);
  }
  if (match[8] !== "Z" && (Number(match[10]) > 23 || Number(match[11]) > 59)) {
    refuseInput(`TIMESTAMP:${field}`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) refuseInput(`TIMESTAMP:${field}`);
  return timestamp;
}

function validateObservationScope(input: ObservationSynthesizerInput): Readonly<{
  bars: readonly Bar[];
  startMs: number;
  endMs: number;
}> {
  const { barWindow, bars, closedTrades } = input;
  if (!barWindow || typeof barWindow.symbol !== "string" || barWindow.symbol.trim() !== barWindow.symbol ||
      barWindow.symbol.length === 0 || !Array.isArray(bars) || !Array.isArray(closedTrades)) {
    refuseInput("WINDOW_OR_COLLECTION");
  }
  const startMs = timestampMs(barWindow.start, "window.start");
  const endMs = timestampMs(barWindow.end, "window.end");
  if (startMs > endMs) refuseInput("WINDOW_REVERSED");

  let interval: string | undefined;
  let previousOpenMs: number | undefined;
  let previousCloseMs: number | undefined;
  for (const [index, bar] of bars.entries()) {
    if (!bar || bar.symbol !== barWindow.symbol || typeof bar.interval !== "string" ||
        !BAR_INTERVALS.has(bar.interval)) {
      refuseInput(`BAR_SCOPE:${index}`);
    }
    if (interval !== undefined && bar.interval !== interval) refuseInput(`BAR_INTERVAL:${index}`);
    interval = bar.interval;

    const openMs = timestampMs(bar.barOpenTime, `bar.${index}.open`);
    const closeMs = timestampMs(bar.barCloseTime, `bar.${index}.close`);
    if (openMs >= closeMs || openMs < startMs || closeMs > endMs) {
      refuseInput(`BAR_WINDOW:${index}`);
    }
    if (previousOpenMs !== undefined && previousCloseMs !== undefined &&
        (openMs <= previousOpenMs || openMs < previousCloseMs || closeMs <= previousCloseMs)) {
      refuseInput(`BAR_ORDER:${index}`);
    }
    previousOpenMs = openMs;
    previousCloseMs = closeMs;
  }

  for (const [index, trade] of closedTrades.entries()) {
    if (!trade || trade.symbol !== barWindow.symbol || !(trade.executedAt instanceof Date) ||
        !Number.isFinite(trade.executedAt.getTime())) {
      refuseInput(`TRADE_SCOPE_OR_TIME:${index}`);
    }
    const executedAtMs = trade.executedAt.getTime();
    if (executedAtMs < startMs || executedAtMs > endMs) refuseInput(`TRADE_WINDOW:${index}`);
  }
  return Object.freeze({ bars, startMs, endMs });
}

function defaultResolveRegimeForTrade(
  trade: ObservationSynthesizerInput["closedTrades"][number],
  bars: readonly Bar[],
): string | null {
  if (bars.length < 20) {
    return null;
  }
  try {
    return classifyBarWindowRegime(bars.slice(-20));
  } catch {
    return null;
  }
}

function buildTradeRefs(input: ObservationSynthesizerInput): ObservationTradeRef[] {
  const resolve = input.resolveRegimeForTrade ?? defaultResolveRegimeForTrade;
  return input.closedTrades.map((trade) => {
    const executedAtMs = trade.executedAt.getTime();
    const causalPrefix = input.bars.filter((bar) => Date.parse(bar.barCloseTime) <= executedAtMs);
    return {
      fillId: trade.fillId,
      symbol: trade.symbol,
      executedAt: trade.executedAt.toISOString(),
      regimeLabel: resolve(trade, causalPrefix),
    };
  });
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
  validateObservationScope(input);

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
