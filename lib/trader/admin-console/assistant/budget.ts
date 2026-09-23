import { ADMIN_REASON } from "@/lib/trader/admin-console/reason-codes";

export type AssistantUsage = { tokens: number; estimated: boolean };

export function resolveAssistantDailyTokenBudget(env: {
  WAIA_ADMIN_ASSISTANT_DAILY_TOKEN_BUDGET?: string;
  WAIA_AI_TRADER_DAILY_TOKEN_BUDGET?: string;
}): number | null {
  const raw = (
    env.WAIA_ADMIN_ASSISTANT_DAILY_TOKEN_BUDGET ??
    env.WAIA_AI_TRADER_DAILY_TOKEN_BUDGET ??
    ""
  ).trim();
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function tokensFromUsage(
  usage: { totalTokens?: number } | null,
  text: string,
): AssistantUsage {
  const total = usage?.totalTokens;
  if (typeof total === "number" && Number.isFinite(total) && total >= 0) {
    return { tokens: Math.floor(total), estimated: false };
  }
  return { tokens: Math.max(1, Math.ceil(text.length / 4)), estimated: true };
}

export function sumUsageTokens(records: readonly { tokens: number }[]): number {
  return records.reduce((sum, record) => sum + record.tokens, 0);
}

export function assessAssistantBudget(
  usedTokens: number,
  limit: number | null,
): { allowed: true } | { allowed: false; reason: typeof ADMIN_REASON.assistantBudgetExhausted } {
  if (limit == null) return { allowed: true };
  if (usedTokens >= limit) {
    return { allowed: false, reason: ADMIN_REASON.assistantBudgetExhausted };
  }
  return { allowed: true };
}

export type AssistantModelDecision = "disabled" | "budget" | "provider_unavailable" | "call";

/** The in-flight call may pass the limit. That excess is the soft budget. */
export function assistantModelDecision(input: {
  enabled: boolean;
  fakePath: boolean;
  usedTokens: number;
  limit: number | null;
}): AssistantModelDecision {
  if (!input.enabled) return "disabled";
  if (!assessAssistantBudget(input.usedTokens, input.limit).allowed) return "budget";
  if (input.fakePath) return "provider_unavailable";
  return "call";
}
