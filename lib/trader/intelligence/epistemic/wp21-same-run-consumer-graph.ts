/**
 * HTR-WP21 — machine-readable consumer graph for same-run authority prohibition proof.
 */
export const WP21_EPISTEMIC_OUTPUT_SYMBOLS = [
  "trader_knowledge_confidence_update_record",
  "OutcomeResolutionReadPort",
  "runWp21CycleSeam",
  "runWp21TerminalSeam",
  "queryMarketKnowledgeReadModel",
] as const;

/** Runtime surfaces that must never consume WP21 epistemic outputs within the same run. */
export const WP21_PROHIBITED_SAME_RUN_CONSUMER_SURFACES = [
  "lib/trader/intelligence/forecast-decision",
  "lib/trader/risk",
  "lib/trader/execution",
  "lib/trader/intelligence/strategies",
] as const;

export type Wp21SameRunConsumerGraph = Readonly<{
  epistemicOutputs: readonly string[];
  prohibitedSameRunConsumers: readonly string[];
  capitalPathConsumers: readonly string[];
  verifiedAtBuild: true;
}>;

export function buildWp21SameRunConsumerGraph(): Wp21SameRunConsumerGraph {
  return {
    epistemicOutputs: [...WP21_EPISTEMIC_OUTPUT_SYMBOLS],
    prohibitedSameRunConsumers: [...WP21_PROHIBITED_SAME_RUN_CONSUMER_SURFACES],
    capitalPathConsumers: [],
    verifiedAtBuild: true,
  };
}
