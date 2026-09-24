import { mergeStrategyCatalog } from "@/lib/trader/admin-console/research/strategy-catalog";
export type StrategyEvidence = {
  organizationId: string;
  strategyId: string;
  version: string;
  kind: "trade" | "promotion" | "candidate" | "lifecycle" | "test";
  id: string;
  state: string;
  at: string | null;
};
export function presentStrategyWorkspace(evidence: readonly StrategyEvidence[], mode: string) {
  const catalog = mergeStrategyCatalog(evidence.filter((row) => row.kind === "trade"));
  const keys = new Set(catalog.map((row) => `${row.strategyId}\t${row.version}`));
  for (const row of evidence) {
    const key = `${row.strategyId}\t${row.version}`;
    if (keys.has(key)) continue;
    keys.add(key);
    // Catalogue labels never confer qualification on a different version.
    catalog.push({
      strategyId: row.strategyId,
      version: row.version,
      displayName: row.strategyId,
      source: "registry",
      reason: "Версия из сохранённых доказательств",
      returnPct: { state: "unavailable", reason: "RETURN_METHOD_NOT_RATIFIED" },
    });
  }
  return catalog.map((row) => {
    const facts = evidence.filter(
      (fact) => fact.strategyId === row.strategyId && fact.version === row.version,
    );
    const deployments = facts.filter(
      (fact) =>
        fact.kind === "promotion" &&
        fact.state === "EFFECTIVE" &&
        (mode === "live" || mode === "all"),
    );
    const recentlyWorked = facts.some((fact) => fact.kind === "trade");
    const retired =
      facts.some((fact) => fact.kind === "lifecycle") &&
      facts.filter((fact) => fact.kind === "lifecycle").every((fact) => fact.state === "RETIRED");
    const testing = facts.some(
      (fact) =>
        fact.kind === "test" ||
        fact.kind === "candidate" ||
        (fact.kind === "lifecycle" && ["PAPER", "RESEARCHING"].includes(fact.state)),
    );
    return {
      ...row,
      mode,
      working: deployments.length > 0,
      recentlyWorked,
      deployments,
      evidence: facts,
      tab:
        deployments.length > 0 || recentlyWorked
          ? "working"
          : retired
            ? "archive"
            : testing
              ? "testing"
              : "proposed",
      activityLabel:
        deployments.length > 0
          ? "Работает: продвижение EFFECTIVE"
          : recentlyWorked
            ? "Недавно работала · deployment не подтверждён"
            : retired
              ? "В архиве"
              : testing
                ? "Исследование / тестирование"
                : "В каталоге · без подтверждённого deployment",
    };
  });
}
export type StrategyWorkspaceItem = ReturnType<typeof presentStrategyWorkspace>[number];
export type StrategyWorkspace = {
  items: StrategyWorkspaceItem[];
  workingCount: number | null;
  evidenceTruncated: boolean;
  scopeReason: string | null;
};
