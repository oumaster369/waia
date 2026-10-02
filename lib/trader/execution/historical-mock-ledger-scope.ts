import { z } from "zod";
import type { CreateOrderInput } from "@/lib/trader/execution/order-repository.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

const scopeSchema = z.object({
  organizationId: z.string().uuid(),
  historicalRunId: z.string().min(1).max(256).refine(value => value.trim() === value),
  historicalAccountKey: z.string().min(1).max(256).refine(value => value.trim() === value),
}).strict();

/** Row isolation only. This tuple grants no research, financial or live authority. */
export type HistoricalMockLedgerScope = Readonly<z.infer<typeof scopeSchema>>;

export function captureHistoricalMockLedgerScope(value: HistoricalMockLedgerScope): HistoricalMockLedgerScope {
  return Object.freeze(scopeSchema.parse(value));
}

export function assertHistoricalMockLedgerContext(context: OrgContext, scope: HistoricalMockLedgerScope): void {
  if (context.organizationId !== scope.organizationId) {
    throw new Error("HISTORICAL_MOCK_LEDGER_ORGANIZATION_MISMATCH");
  }
}

export function bindHistoricalMockOrderInput(input: CreateOrderInput, scope: HistoricalMockLedgerScope): CreateOrderInput {
  if (input.executionMode !== "mock" ||
      (input.historicalRunId != null && input.historicalRunId !== scope.historicalRunId) ||
      (input.historicalAccountKey != null && input.historicalAccountKey !== scope.historicalAccountKey)) {
    throw new Error("HISTORICAL_MOCK_LEDGER_ORDER_SCOPE_MISMATCH");
  }
  return Object.freeze({ ...input, historicalRunId: scope.historicalRunId,
    historicalAccountKey: scope.historicalAccountKey });
}
