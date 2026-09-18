export const KNOWLEDGE_NAVIGATOR_RUNTIME_MODULES_V2 = {
  receipt: "lib/trader/knowledge/navigator/knowledge-selection-receipt-v2.ts",
  selector: "lib/trader/knowledge/navigator/knowledge-navigator-v2.ts",
  futureCycleEffect: "lib/trader/knowledge/navigator/future-cycle-epistemic-effect-v2.ts",
} as const;

export const KNOWLEDGE_NAVIGATOR_FORBIDDEN_CONSUMER_PREFIXES_V2 = [
  "lib/trader/intelligence/decision",
  "lib/trader/risk/",
  "lib/trader/execution/",
  "lib/trader/live/",
  "lib/trader/capital/",
  "lib/trader/research/holdout/",
] as const;

export const KNOWLEDGE_NAVIGATOR_RAW_MKB_INJECTION_SYMBOLS_V2 = [
  "queryMkbReadModel",
  "createMkbReadModelSourcePostgres",
] as const;

export const KNOWLEDGE_NAVIGATOR_CAPITAL_FIELDS_V2 = [
  "capitalAllocation",
  "capitalAuthority",
  "orderAuthority",
  "positionSize",
  "promoteToLive",
  "riskMultiplier",
  "tradeEligibility",
] as const;

export function isKnowledgeNavigatorCapitalConsumerForbiddenV2(path: string): boolean {
  return KNOWLEDGE_NAVIGATOR_FORBIDDEN_CONSUMER_PREFIXES_V2.some((prefix) =>
    path.startsWith(prefix),
  );
}
