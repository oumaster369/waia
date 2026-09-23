import {
  addDecimal,
  compareDecimal,
  divideDecimal,
  subtractDecimal,
} from "@/lib/trader/risk/numeric";

export function strategyTradeStats(pnls: readonly string[]): {
  count: number;
  winRate: string | null;
  profitFactor: string | null;
  returnPct: { state: "unavailable"; reason: "RETURN_METHOD_NOT_RATIFIED" };
} {
  const returnPct = { state: "unavailable", reason: "RETURN_METHOD_NOT_RATIFIED" } as const;
  if (pnls.length === 0) return { count: 0, winRate: null, profitFactor: null, returnPct };
  let wins = "0";
  let losses = "0";
  let winCount = 0;
  for (const pnl of pnls) {
    if (compareDecimal(pnl, "0") > 0) {
      wins = addDecimal(wins, pnl);
      winCount += 1;
    } else if (compareDecimal(pnl, "0") < 0) {
      losses = addDecimal(losses, subtractDecimal("0", pnl));
    }
  }
  return {
    count: pnls.length,
    winRate: divideDecimal(String(winCount), String(pnls.length)),
    profitFactor: compareDecimal(losses, "0") === 0 ? null : divideDecimal(wins, losses),
    returnPct,
  };
}

export function researchProgress(
  committedCycles: number,
  qualifiedTotalCycles: number,
): { kind: "ratio"; value: string } | { kind: "count"; value: number } {
  if (qualifiedTotalCycles > 0) {
    return {
      kind: "ratio",
      value: divideDecimal(String(committedCycles), String(qualifiedTotalCycles)),
    };
  }
  return { kind: "count", value: committedCycles };
}

export function researchConditionDifferences(
  left: { dataset: string; period: string; costs: string; version: string; model: string },
  right: { dataset: string; period: string; costs: string; version: string; model: string },
): string[] {
  return (["dataset", "period", "costs", "version", "model"] as const).filter(
    (key) => left[key] !== right[key],
  );
}
