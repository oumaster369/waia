import type { LifecycleEventRow } from "@/lib/trader/lifecycle/trade-lifecycle.types";
import type { LifecycleRepository } from "@/lib/trader/lifecycle/lifecycle-repository.types";
import { TRADE_LIFECYCLE_SEMANTICS_VERSION } from "@/lib/trader/paper/trade-lifecycle-semantics";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export const M9_LIFECYCLE_TRACE_SCHEMA_VERSION = "m9_lifecycle_trace_v1";

export type M9LifecycleTraceExport = {
  schemaVersion: typeof M9_LIFECYCLE_TRACE_SCHEMA_VERSION;
  generatedAt: string;
  organizationId: string;
  strategyId: string;
  strategyVersion: string;
  tradeLifecycleSemanticsVersion: typeof TRADE_LIFECYCLE_SEMANTICS_VERSION;
  parityAssertionPassed: boolean;
  lifecycleEventCount: number;
  forcedFlatEventCount: number;
  fillEventCount: number;
  events: readonly LifecycleEventRow[];
};

export async function buildM9LifecycleTraceExport(input: {
  context: OrgContext;
  lifecycleRepository: LifecycleRepository;
  strategyId: string;
  strategyVersion: string;
  parityAssertionPassed?: boolean;
  generatedAt?: string;
}): Promise<M9LifecycleTraceExport> {
  const events = await input.lifecycleRepository.listLifecycleEvents(input.context);
  const forcedFlatEventCount = events.filter((event) => event.phase === "FORCED_FLAT").length;
  const fillEventCount = events.filter((event) => event.phase === "ORDER_FILLED").length;

  return {
    schemaVersion: M9_LIFECYCLE_TRACE_SCHEMA_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    organizationId: input.context.organizationId,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    tradeLifecycleSemanticsVersion: TRADE_LIFECYCLE_SEMANTICS_VERSION,
    parityAssertionPassed: input.parityAssertionPassed ?? true,
    lifecycleEventCount: events.length,
    forcedFlatEventCount,
    fillEventCount,
    events,
  };
}
