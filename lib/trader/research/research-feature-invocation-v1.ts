import type { Bar, BarInterval } from "@/lib/trader/intelligence/types";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import { evaluateResearchLookbackV1 } from "@/lib/trader/research/research-lookback-evaluator-v1";

/** Internal stage primitive: describes an actual pure evaluator call, never
 * source/PIT qualification, scientific evidence or permission to execute. */
export function evaluateResearchFeatureInvocationV1(input: Readonly<{
  parameters: unknown;
  bars: readonly Bar[];
  symbol: string;
  interval: BarInterval;
  index: number;
  sourceBarIndex: number;
  cycleId: string;
}>) {
  if (!Number.isSafeInteger(input.index) || input.index < 0 || input.index >= input.bars.length ||
      !Number.isSafeInteger(input.sourceBarIndex) || input.sourceBarIndex < 0 ||
      typeof input.cycleId !== "string" || input.cycleId.length === 0) {
    throw new Error("RESEARCH_FEATURE_INVOCATION_IDENTITY_INVALID");
  }
  // Construct once: these exact immutable objects feed both the evaluator and
  // the digest. Absolute source ordinals never address the local bars array.
  const window = Object.freeze(input.bars.slice(Math.max(0, input.index - 127), input.index + 1)
    .map(bar => Object.freeze({ ...bar })));
  const first = window[0]!;
  const last = window.at(-1)!;
  const signal = evaluateResearchLookbackV1({ parameters: input.parameters,
    bars: window, symbol: input.symbol, interval: input.interval, evaluatedAt: last.barCloseTime });
  const body = Object.freeze({ schemaVersion: "waia.research.feature-invocation.v1" as const,
    rule: "trailing-128-closed-bars/v1" as const,
    index: input.index, sourceBarIndex: input.sourceBarIndex, cycleId: input.cycleId,
    symbol: signal.symbol, interval: signal.interval, evaluatedAt: signal.evaluatedAt,
    firstBarOpenTime: first.barOpenTime, lastBarCloseTime: last.barCloseTime,
    barCount: window.length, barsSha256: computeStableJsonDigest(window),
    parametersSha256: computeStableJsonDigest(signal.parameters), signal });
  return Object.freeze({ signal, invocationReceipt: Object.freeze({ ...body,
    contentDigestHex: computeStableJsonDigest(body) }) });
}

export type ResearchFeatureInvocationReceiptV1 =
  ReturnType<typeof evaluateResearchFeatureInvocationV1>["invocationReceipt"];
