import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { OrderExecutionService } from "@/lib/trader/execution/execution-service.types";
import type { ReconciliationService } from "@/lib/trader/execution/reconciliation.types";
import { runEvaluationCycle } from "@/lib/trader/intelligence/evaluation-cycle";
import type { MarketSnapshot } from "@/lib/trader/market-data/types";
import type { FutureCycleEpistemicEffectReceiptV2 } from "@/lib/trader/knowledge/navigator/future-cycle-epistemic-effect-v2";
import type { KnowledgeSelectionReceiptV2 } from "@/lib/trader/knowledge/navigator/knowledge-selection-receipt-v2";
import type { LiveReportingBridgeResult } from "@/lib/trader/live/reporting-bridge";
import { proveLiveFillReportingReadable } from "@/lib/trader/live/reporting-bridge";
import type { LiveEdgeDriftPostureV2 } from "@/lib/trader/restriction/live-edge-drift-restriction-v2";
import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import type { RuntimePostureV2 } from "@/lib/trader/runtime-authority/v2/runtime-authority-assessment-v2";
import {
  buildAuthoritativeRuntimeContextV2,
  type AuthoritativeRuntimeContextV2,
  type AuthoritativeRuntimeContextV2Input,
} from "@/lib/trader/runtime-v2/authoritative-runtime-context-v2";
import type { ComposeCanonicalEpistemicSpineV2Input } from "@/lib/trader/runtime-v2/canonical-epistemic-compose-v2";
import {
  runCanonicalOrdinaryCapitalCycleV2,
  type CanonicalRecurringCycleV2Result,
} from "@/lib/trader/runtime-v2/canonical-recurring-cycle-v2";
import type {
  CanonicalDecisionCapitalAuthorityV2Deps,
  DecisionCapitalAuthorityV2Result,
} from "@/lib/trader/runtime-v2/decision-capital-authority-v2";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

/**
 * Caller-supplied epistemic envelope for live-equivalent ordinary ENTER_LONG.
 * Navigator and future-cycle receipts are never invented: omit or pass null.
 */
export type LiveCanonicalOrdinaryCapitalEnvelopeV2 = Readonly<{
  context?: AuthoritativeRuntimeContextV2;
  contextInputs?: Omit<
    AuthoritativeRuntimeContextV2Input,
    "organizationId" | "accountId" | "symbol" | "pitAnchor"
  >;
  navigatorReceipt: KnowledgeSelectionReceiptV2 | null;
  predictiveAdmissionVerdict: "ADMITTED" | "NOT_ADMITTED" | "RESEARCH_ONLY";
  futureCycleEffect: FutureCycleEpistemicEffectReceiptV2 | null;
  currentRuntimePosture: RuntimePostureV2;
  currentDriftPosture: LiveEdgeDriftPostureV2;
  mkbInjectionAttempted?: boolean;
  legacyKnowledgeMutationAttempted?: boolean;
}>;

export type LiveCycleDeps = {
  execution: OrderExecutionService;
  reconciliation: ReconciliationService;
  reportingBridge: Parameters<typeof proveLiveFillReportingReadable>[0]["reportingBridge"];
  feeComputation: Parameters<typeof proveLiveFillReportingReadable>[0]["feeComputation"];
  hwmLedger: Parameters<typeof proveLiveFillReportingReadable>[0]["hwmLedger"];
  orderRepository: Parameters<typeof proveLiveFillReportingReadable>[0]["orderRepository"];
  /** DEE-634: sole live-equivalent actionability/economics authority. */
  decisionCapitalAuthorityV2?: CanonicalDecisionCapitalAuthorityV2Deps;
  canonicalOrdinaryCapitalEnvelopeV2?: LiveCanonicalOrdinaryCapitalEnvelopeV2;
};

export type RunLiveCycleInput = {
  context: OrgContext;
  snapshot: MarketSnapshot;
  accountKey: string;
  exchangeAccountId: string;
  strategyId: string;
  strategyVersion: string;
  credentialId: string;
  defaultQuantity?: string;
  notionalCap?: string;
  accountState?: AccountRiskState;
  newId?: () => string;
  canonicalOrdinaryCapitalEnvelopeV2?: LiveCanonicalOrdinaryCapitalEnvelopeV2;
};

export type LiveCycleStrategyStage = {
  strategySignalId: string | null;
  strategyId: string;
  strategyVersion: string;
};

export type LiveCycleResult = {
  evaluation: ReturnType<typeof runEvaluationCycle>;
  strategyStage: LiveCycleStrategyStage | null;
  execution: Awaited<ReturnType<OrderExecutionService["submitOrder"]>> | null;
  reconciliation: Awaited<ReturnType<ReconciliationService["reconcile"]>> | null;
  reporting: LiveReportingBridgeResult | null;
  submitBlocked: boolean;
  skipReason?: string;
  decisionCapitalAuthorityV2?: DecisionCapitalAuthorityV2Result;
  canonicalOrdinaryCapitalCycleV2?: CanonicalRecurringCycleV2Result;
};

export function liveCycleOrderKeys(
  cycleId: string,
  strategyId: string,
): {
  clientOrderId: string;
  idempotencyKey: string;
} {
  return {
    clientOrderId: `client-live-cycle-${cycleId}-${strategyId}`,
    idempotencyKey: `idem-live-cycle-${cycleId}-${strategyId}`,
  };
}

function resolveLiveCanonicalEpistemicSpineV2(input: {
  envelope: LiveCanonicalOrdinaryCapitalEnvelopeV2 | undefined;
  organizationId: string;
  accountId: string;
  symbol: string;
  pitAnchor: string;
}):
  | { ok: true; epistemic: ComposeCanonicalEpistemicSpineV2Input }
  | {
      ok: false;
      reasonCode:
        | "CANONICAL_ENVELOPE_MISSING"
        | "CANONICAL_ENVELOPE_INVALID"
        | "ENVELOPE_IDENTITY_MISMATCH";
    } {
  if (!input.envelope) return { ok: false, reasonCode: "CANONICAL_ENVELOPE_MISSING" };
  try {
    const context =
      input.envelope.context ??
      (input.envelope.contextInputs
        ? buildAuthoritativeRuntimeContextV2({
            organizationId: input.organizationId,
            accountId: input.accountId,
            symbol: input.symbol,
            pitAnchor: input.pitAnchor,
            ...input.envelope.contextInputs,
          })
        : null);
    if (!context) return { ok: false, reasonCode: "CANONICAL_ENVELOPE_INVALID" };
    if (
      context.organizationId !== input.organizationId ||
      context.accountId !== input.accountId ||
      context.symbol !== input.symbol ||
      context.pitAnchor !== input.pitAnchor
    ) {
      return { ok: false, reasonCode: "ENVELOPE_IDENTITY_MISMATCH" };
    }
    return {
      ok: true,
      epistemic: {
        context,
        navigatorReceipt: input.envelope.navigatorReceipt,
        predictiveAdmissionVerdict: input.envelope.predictiveAdmissionVerdict,
        futureCycleEffect: input.envelope.futureCycleEffect,
        mkbInjectionAttempted: input.envelope.mkbInjectionAttempted,
        legacyKnowledgeMutationAttempted: input.envelope.legacyKnowledgeMutationAttempted,
      },
    };
  } catch {
    return { ok: false, reasonCode: "CANONICAL_ENVELOPE_INVALID" };
  }
}

/**
 * Bounded single live-equivalent cycle: compose → GATE_ONLY admission →
 * Decision V2 → Risk → Execution. Terminates after one order attempt (no loop).
 */
export async function runLiveCycleOnce(
  deps: LiveCycleDeps,
  input: RunLiveCycleInput,
): Promise<LiveCycleResult> {
  const evaluation = runEvaluationCycle({
    organizationId: input.context.organizationId,
    bars: input.snapshot.bars,
    quote: input.snapshot.quote,
    evaluatedAt: input.snapshot.evaluatedAt,
    newId: input.newId,
  });

  const signal = evaluation.signals.find(
    (entry) =>
      entry.outcome === "SIGNAL" && entry.strategyId === input.strategyId && entry.side === "buy",
  );

  if (!signal) {
    return {
      evaluation,
      strategyStage: null,
      execution: null,
      reconciliation: null,
      reporting: null,
      submitBlocked: true,
      skipReason: "no_signal",
    };
  }

  const strategyStage: LiveCycleStrategyStage = {
    strategySignalId: signal.strategySignalId,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
  };

  if (!deps.decisionCapitalAuthorityV2) {
    return {
      evaluation,
      strategyStage,
      execution: null,
      reconciliation: null,
      reporting: null,
      submitBlocked: true,
      skipReason: "decision_v2_authority_missing",
    };
  }

  const symbol = input.snapshot.bars[0]?.symbol ?? input.snapshot.quote.symbol;
  const pitAnchor = input.snapshot.evaluatedAt;
  const envelope =
    input.canonicalOrdinaryCapitalEnvelopeV2 ?? deps.canonicalOrdinaryCapitalEnvelopeV2;
  const resolved = resolveLiveCanonicalEpistemicSpineV2({
    envelope,
    organizationId: input.context.organizationId,
    accountId: input.accountKey,
    symbol,
    pitAnchor,
  });
  const cycle: CanonicalRecurringCycleV2Result =
    resolved.ok && envelope
      ? await runCanonicalOrdinaryCapitalCycleV2({
          epistemic: resolved.epistemic,
          admissionTemplate: {
            context: resolved.epistemic.context,
            currentRuntimePosture: envelope.currentRuntimePosture,
            currentDriftPosture: envelope.currentDriftPosture,
            navigatorOutcome: envelope.navigatorReceipt?.outcome ?? "UNKNOWN_UNRESOLVED",
            predictiveAdmissionVerdict: envelope.predictiveAdmissionVerdict,
            admittedAt: pitAnchor,
            identity: {
              organizationId: input.context.organizationId,
              accountId: input.accountKey,
              symbol,
              action: "ENTER_LONG",
              direction: "BUY",
              quantity: input.defaultQuantity ?? "0.001",
              externalEffectId: input.snapshot.cycleId,
            },
          },
          capitalDeps: deps.decisionCapitalAuthorityV2,
          capitalRequest: {
            organizationId: input.context.organizationId,
            accountId: input.accountKey,
            cycleId: input.snapshot.cycleId,
            symbol,
            referencePrice: evaluation.features.features.close,
            executionMode: "live-equivalent",
            forecastOutcome: evaluation.forecastRuntimeOutcome!,
            proposal: {
              action: "ENTER_LONG",
              quantity: input.defaultQuantity ?? "0.001",
              strategySignalId: signal.strategySignalId,
            },
          },
        })
      : {
          status: "NO_TRADE",
          stage: "EPISTEMIC",
          reasonCodes: [resolved.ok ? "CANONICAL_ENVELOPE_MISSING" : resolved.reasonCode],
        };

  if (cycle.status === "NO_TRADE") {
    return {
      evaluation,
      strategyStage,
      execution: null,
      reconciliation: null,
      reporting: null,
      submitBlocked: true,
      skipReason: "decision_v2_no_trade",
      canonicalOrdinaryCapitalCycleV2: cycle,
    };
  }

  const execution = cycle.capital.execution.execution;

  if (execution.status !== "submitted") {
    return {
      evaluation,
      strategyStage,
      execution,
      reconciliation: null,
      reporting: null,
      submitBlocked: true,
      skipReason: execution.status,
      decisionCapitalAuthorityV2: cycle.capital,
      canonicalOrdinaryCapitalCycleV2: cycle,
    };
  }

  const reconciliation = await deps.reconciliation.reconcile(input.context, {
    kind: "order",
    orderId: execution.order.id,
  });

  let reporting: LiveReportingBridgeResult | null = null;
  if (execution.order.state === "FILLED" || execution.order.state === "PARTIALLY_FILLED") {
    reporting = await proveLiveFillReportingReadable({
      context: input.context,
      orderRepository: deps.orderRepository,
      reportingBridge: deps.reportingBridge,
      feeComputation: deps.feeComputation,
      hwmLedger: deps.hwmLedger,
      exchangeAccountId: input.exchangeAccountId,
    });
  }

  return {
    evaluation,
    strategyStage,
    execution,
    reconciliation,
    reporting,
    submitBlocked: false,
    decisionCapitalAuthorityV2: cycle.capital,
    canonicalOrdinaryCapitalCycleV2: cycle,
  };
}
