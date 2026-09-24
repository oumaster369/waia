import { MVP_STRATEGY_REGISTRY } from "@/lib/trader/intelligence/strategies/registry";

export type StrategyCatalogRow = {
  strategyId: string;
  version: string;
  displayName: string;
  source: "registry" | "trades" | "both";
  reason: string | null;
  returnPct: { state: "unavailable"; reason: "RETURN_METHOD_NOT_RATIFIED" };
};

export function mergeStrategyCatalog(
  trades: readonly { strategyId: string; version: string }[],
): StrategyCatalogRow[] {
  const registry = new Map(
    MVP_STRATEGY_REGISTRY.map((entry) => [`${entry.strategyId}\t${entry.version}`, entry]),
  );
  const seen = new Set<string>();
  const rows: StrategyCatalogRow[] = [];
  for (const entry of MVP_STRATEGY_REGISTRY) {
    const key = `${entry.strategyId}\t${entry.version}`;
    seen.add(key);
    const traded = trades.some(
      (trade) => trade.strategyId === entry.strategyId && trade.version === entry.version,
    );
    rows.push({
      strategyId: entry.strategyId,
      version: entry.version,
      displayName: entry.displayName,
      source: traded ? "both" : "registry",
      reason: null,
      returnPct: { state: "unavailable", reason: "RETURN_METHOD_NOT_RATIFIED" },
    });
  }
  for (const trade of trades) {
    const key = `${trade.strategyId}\t${trade.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const knownId = [...registry.values()].some((entry) => entry.strategyId === trade.strategyId);
    rows.push({
      strategyId: trade.strategyId,
      version: trade.version,
      displayName: trade.strategyId,
      source: "trades",
      reason: knownId
        ? "версия есть в сделках и отсутствует в реестре"
        : "стратегия есть в сделках и отсутствует в реестре",
      returnPct: { state: "unavailable", reason: "RETURN_METHOD_NOT_RATIFIED" },
    });
  }
  return rows;
}
