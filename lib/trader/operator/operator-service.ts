import { createHash } from "node:crypto";

import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { CompletionProviderPort } from "@/lib/ai-gateway/completion-types";
import { FakeCompletionProvider } from "@/lib/ai-gateway/fake-completion-provider";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { assertOperatorActionAllowed } from "@/lib/trader/operator/operator-authority";
import { appendOperatorAuditPostgres } from "@/lib/trader/operator/operator-audit-repository-postgres";
import type {
  OperatorRecommendInput,
  OperatorRecommendResult,
  OperatorRecommendation,
  OperatorServiceStateSnapshot,
} from "@/lib/trader/operator/operator.types";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";

type PgExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

export type OperatorServiceDeps = {
  completionProvider?: CompletionProviderPort;
  readState?: (
    ex: PgExecutor,
    context: OrgContext,
    input: OperatorRecommendInput,
  ) => Promise<OperatorServiceStateSnapshot>;
};

function canonicalJsonString(value: unknown): string {
  return JSON.stringify(value);
}

function computeOperatorAuditDigest(input: {
  actionKind: string;
  actionPayloadJson: string;
  recommendationJson: string | null;
  actorKind: string;
  createdAt: Date;
}): string {
  const payload = {
    actionKind: input.actionKind,
    actionPayloadJson: input.actionPayloadJson,
    recommendationJson: input.recommendationJson,
    actorKind: input.actorKind,
    createdAt: input.createdAt.toISOString(),
  };
  return createHash("sha256").update(canonicalJsonString(payload), "utf8").digest("hex");
}

function buildStubRecommendation(
  state: OperatorServiceStateSnapshot,
  providerText?: string,
): OperatorRecommendation {
  const focus = state.strategyId ? ` for ${state.strategyId}` : "";
  return {
    summary: providerText?.trim() || `Review research readiness${focus} before promotion.`,
    rationale:
      "Operator v0 recommend-only loop: deterministic evaluators and human attestation remain authoritative.",
    suggestedActions: ["read_backtest_results", "draft_gate_package", "recommend_strategy_review"],
    confidence: "medium",
  };
}

async function defaultReadState(
  _ex: PgExecutor,
  context: OrgContext,
  input: OperatorRecommendInput,
): Promise<OperatorServiceStateSnapshot> {
  return {
    organizationId: context.organizationId,
    strategyId: input.focusStrategyId,
    hypothesisCount: 0,
    backtestRunCount: 0,
    pendingPromotionCount: 0,
  };
}

/**
 * Recommend-only operator loop stub (RI-P5 / ADR-0019).
 * Reads state, produces a recommendation via CompletionProviderPort, audits the action.
 */
export async function runOperatorRecommendLoop(
  ex: PgExecutor,
  context: OrgContext,
  input: OperatorRecommendInput,
  deps: OperatorServiceDeps = {},
): Promise<OperatorRecommendResult> {
  const action = "recommend_strategy_review";
  assertOperatorActionAllowed(action);

  const scoped = requireOrgContext(context.organizationId);
  const readState = deps.readState ?? defaultReadState;
  const state = await readState(ex, scoped, input);

  const provider = deps.completionProvider ?? new FakeCompletionProvider();
  const completion = await provider.complete({
    model: "waia-operator-v0",
    messages: [
      {
        role: "system",
        content: "You are the AI-TRADER recommend-only operator. Never promote or trade.",
      },
      {
        role: "user",
        content: JSON.stringify({
          organizationId: scoped.organizationId,
          focusStrategyId: input.focusStrategyId ?? null,
          promptContext: input.promptContext ?? null,
          state,
        }),
      },
    ],
    maxOutputTokens: 256,
    temperature: 0,
  });

  const providerOk = completion.ok;
  const recommendation = buildStubRecommendation(state, providerOk ? completion.text : undefined);

  const createdAt = new Date();
  const actionPayload = {
    action,
    focusStrategyId: input.focusStrategyId ?? null,
    state,
    providerOk,
  };
  const actionPayloadJson = JSON.stringify(actionPayload);
  const recommendationJson = JSON.stringify(recommendation);
  const contentDigest = computeOperatorAuditDigest({
    actionKind: action,
    actionPayloadJson,
    recommendationJson,
    actorKind: "operator",
    createdAt,
  });

  assertOperatorActionAllowed("append_audit_log");
  const auditEntry = await appendOperatorAuditPostgres(ex, scoped, {
    id: crypto.randomUUID(),
    actionKind: action,
    actionPayloadJson,
    recommendationJson,
    actorKind: "operator",
    contentDigest,
    createdAt,
  });

  return {
    recommendation,
    auditEntryId: auditEntry.id,
    providerOk,
  };
}
