import { strategyLifecycleStates } from "@/lib/trader/intelligence/strategies/registry";

export const STRATEGY_LIFECYCLE_SCHEMA_VERSION = "htr-wp16-strategy-lifecycle/v1";

export type StrategyLifecycleState = (typeof strategyLifecycleStates)[number];

export type StrategyLifecycleActor = "HUMAN" | "MACHINE" | "SERVICE";

export type StrategyLifecycleTransition = {
  fromState: StrategyLifecycleState | null;
  toState: StrategyLifecycleState;
  actor: StrategyLifecycleActor;
};

export type StrategyLifecycleEvent = {
  id: string;
  organizationId: string;
  strategyId: string;
  strategyVersion: string;
  fromState: StrategyLifecycleState | null;
  toState: StrategyLifecycleState;
  actor: StrategyLifecycleActor;
  approvalRef: string | null;
  reasonCode: string | null;
  seq: number;
  effectiveAt: string;
  runId: string | null;
  contentDigest: string;
  createdAt: string;
};
