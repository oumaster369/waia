import type { Bar, BarInterval } from "@/lib/trader/intelligence/types";
import { formatDecimal, parseDecimal } from "@/lib/trader/risk/numeric";
import { historicalInstrumentsMatch, normalizeHistoricalInstrument } from "@/lib/trader/symbols/historical-instrument";
import { RESEARCH_EXECUTABLE_ID_V1, researchTrialParametersSchemaV1, type ResearchTrialParametersV1 } from "@/lib/trader/research/research-experiment-contract-v1";

const INTERVAL_MS: Record<BarInterval, number> = {
  "1m": 60_000, "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000,
};
const CLOSE = /^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/;

function canonicalUtcMs(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return NaN;
  const ms = Date.parse(value);
  const canonical = value.includes(".") ? value : value.replace("Z", ".000Z");
  return Number.isSafeInteger(ms) && new Date(ms).toISOString() === canonical ? ms : NaN;
}

export type ResearchLookbackEvaluationV1 = Readonly<{
  executableId: typeof RESEARCH_EXECUTABLE_ID_V1;
  authority: "SIGNAL_ONLY";
  parameters: ResearchTrialParametersV1;
  action: "BUY" | "SELL" | "NONE";
  reason: "BUY_THRESHOLD" | "SELL_THRESHOLD" | "NEUTRAL" | "INSUFFICIENT_BARS" | "ZERO_DISPERSION";
  evaluatedAt: string;
  symbol: string;
  interval: BarInterval;
  close: string | null;
  meanClose: string | null;
  populationDispersion: string | null;
  zscore: string | null;
}>;

function integerSqrt(value: bigint): bigint {
  if (value < 2n) return value;
  let root = value;
  let next = (root + value / root) >> 1n;
  while (next < root) {
    root = next;
    next = (root + value / root) >> 1n;
  }
  return root;
}

/** The single parameterized mathematical kernel for the closed research
 * executable. This is deliberately not an MVP StrategySignal or an execution
 * capability. It grants no permission, size, expected edge or scientific status.
 * The replay owner must apply the existing permission/Risk/Guardian/cost gates.
 * It is currently unwired: a passing kernel test is not cross-stage replay proof.
 *
 * The mean and population dispersion use the repository's eight-decimal fixed
 * point arithmetic, including truncation toward zero and integer square root.
 * The current closed bar participates in the window. Flat/short windows do not
 * emit a proposal. A complete, chronological, contiguous closed prefix is required.
 */
export function evaluateResearchLookbackV1(input: {
  parameters: unknown;
  bars: readonly Bar[];
  symbol: string;
  interval: BarInterval;
  evaluatedAt: string;
}): ResearchLookbackEvaluationV1 {
  const parameters = Object.freeze(researchTrialParametersSchemaV1.parse(input.parameters));
  const symbol = normalizeHistoricalInstrument(input.symbol);
  const asOf = canonicalUtcMs(input.evaluatedAt);
  const intervalMs = INTERVAL_MS[input.interval];
  if (!Number.isSafeInteger(asOf) || !intervalMs) throw new Error("RESEARCH_EXECUTABLE_TIME_INVALID");
  let previousOpen: number | undefined;
  let previousClose: number | undefined;
  for (const bar of input.bars) {
    const open = canonicalUtcMs(bar.barOpenTime);
    const close = canonicalUtcMs(bar.barCloseTime);
    if (!historicalInstrumentsMatch(bar.symbol, symbol) || bar.interval !== input.interval) {
      throw new Error("RESEARCH_EXECUTABLE_INSTRUMENT_MISMATCH");
    }
    if (!Number.isSafeInteger(open) || !Number.isSafeInteger(close) || open < 0 || open >= close || close > asOf ||
        (close !== open + intervalMs && close !== open + intervalMs - 1) ||
        (previousOpen !== undefined && open - previousOpen !== intervalMs) ||
        (previousClose !== undefined && open < previousClose)) {
      throw new Error("RESEARCH_EXECUTABLE_NONCAUSAL_OR_GAPPED_PREFIX");
    }
    if (bar.close.length > 40 || !CLOSE.test(bar.close) || parseDecimal(bar.close) <= 0n) {
      throw new Error("RESEARCH_EXECUTABLE_PRICE_INVALID");
    }
    previousOpen = open;
    previousClose = close;
  }
  const base = {
    executableId: RESEARCH_EXECUTABLE_ID_V1,
    authority: "SIGNAL_ONLY" as const,
    parameters,
    evaluatedAt: new Date(asOf).toISOString(),
    symbol,
    interval: input.interval,
  };
  const latest = input.bars.at(-1);
  if (input.bars.length < parameters.lookbackBars || !latest) {
    return Object.freeze({ ...base, action: "NONE", reason: "INSUFFICIENT_BARS",
      close: latest?.close ?? null, meanClose: null, populationDispersion: null, zscore: null });
  }
  const closes = input.bars.slice(-parameters.lookbackBars).map(bar => parseDecimal(bar.close));
  const count = BigInt(closes.length);
  const mean = closes.reduce((sum, value) => sum + value, 0n) / count;
  const variance = closes.reduce((sum, value) => sum + (value - mean) ** 2n, 0n) / count;
  const dispersion = integerSqrt(variance);
  const distribution = { close: latest.close, meanClose: formatDecimal(mean),
    populationDispersion: formatDecimal(dispersion) };
  if (dispersion === 0n) {
    return Object.freeze({ ...base, ...distribution, action: "NONE", reason: "ZERO_DISPERSION", zscore: null });
  }
  const numerator = (closes.at(-1)! - mean) * parseDecimal("1");
  const zscore = numerator / dispersion;
  // Compare before truncating the display value: a small negative quotient
  // formats as zero, but must not cross the zero SELL threshold.
  const action = numerator <= parseDecimal(parameters.buyZscore) * dispersion ? "BUY" :
    numerator >= parseDecimal(parameters.sellZscore) * dispersion ? "SELL" : "NONE";
  return Object.freeze({ ...base, ...distribution, action,
    reason: action === "BUY" ? "BUY_THRESHOLD" : action === "SELL" ? "SELL_THRESHOLD" : "NEUTRAL",
    zscore: formatDecimal(zscore) });
}
