import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { getIdhpsSession } from "@/lib/trader/execution/idhps-session-registry";
import {
  fillPayloadMatches,
  type FillRow,
  type RecordFillInput,
} from "@/lib/trader/execution/order-repository.types";
import { mapSealedFillRow } from "@/lib/trader/observability/fhv-economic-ledger";
import { EconomicSealBreachError } from "@/lib/trader/observability/fhv-economic-seal";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

/**
 * Post-seal write authority (ADR-0025 AD-11/AD-13).
 *
 * Once an economically sealed order's rows are pruned from `session.sqlite`, the parent lookup in
 * `recordFillSqlite` / `recordFillProgressSqlite` no longer finds it. Without this resolution a
 * legitimate duplicate delivery would raise `OrderNotFoundError` and fill idempotency — which
 * previously relied on reading `trader_fills` back — would be lost.
 *
 * Authority is the run-scoped verified seal registry, never terminal state and never a fallback
 * to whatever SQLite happens to still hold. Lookups are O(1) against indexes built once when the
 * seal was published; nothing is re-verified or re-hashed per write.
 */

export type FhvPostSealFillOutcome =
  /** Case E — no sealed order either: the caller preserves OrderNotFoundError. */
  | { kind: "NO_SEALED_ORDER" }
  /** Case B — exact duplicate already in sealed history; return it with no economic mutation. */
  | { kind: "IDEMPOTENT_DUPLICATE"; fill: FillRow }
  /** Case C — same stable fill identity, different payload. */
  | { kind: "PAYLOAD_CONFLICT"; sealed: FillRow }
  /** Case D — sealed order, genuinely new economic event. */
  | { kind: "SEAL_BREACH" };

/**
 * Resolve a fill against sealed history when SQLite has no parent row.
 *
 * Pure resolution: this performs no mutation and no termination. Callers translate the outcome
 * into the canonical error or return value for their interface.
 */
export function resolveFhvPostSealFillOutcome(input: {
  context: OrgContext;
  orderId: string;
  exchangeTradeId: string;
  candidate: RecordFillInput;
}): FhvPostSealFillOutcome {
  const session = getIdhpsSession();
  const registry = session?.sealedOrderRegistry;
  const snapshot = session?.sealedLedgerSnapshot;
  if (!registry || !snapshot) {
    return { kind: "NO_SEALED_ORDER" };
  }

  // Cross-tenant and cross-run reads fail closed before any lookup.
  registry.assertScope(input.context.organizationId);

  if (!registry.isSealed(input.orderId)) {
    return { kind: "NO_SEALED_ORDER" };
  }

  const sealedFills = snapshot.fillsByOrderId.get(input.orderId) ?? [];
  for (const row of sealedFills) {
    if (String(row.exchange_trade_id) !== input.exchangeTradeId) {
      continue;
    }
    const sealed = mapSealedFillRow(row) as FillRow;
    return fillPayloadMatches(sealed, input.candidate)
      ? { kind: "IDEMPOTENT_DUPLICATE", fill: sealed }
      : { kind: "PAYLOAD_CONFLICT", sealed };
  }

  // The order is economically sealed and this fill is not part of that sealed truth.
  return { kind: "SEAL_BREACH" };
}

/**
 * Fail closed on a genuinely new post-seal economic event.
 *
 * Terminates the run through the existing accounting-bridge termination architecture so the
 * failure surfaces as reconciliation-required evidence, then throws. Sealed history is never
 * mutated and the order is never silently reopened.
 */
export function raiseFhvEconomicSealBreach(input: {
  orderId: string;
  exchangeTradeId: string;
  detail: string;
  terminate: (code: string) => void;
}): never {
  try {
    input.terminate("ECONOMIC_SEAL_BREACH_RECONCILIATION_REQUIRED");
  } catch {
    // Termination bookkeeping must never mask the breach itself.
  }
  throw new EconomicSealBreachError(input.orderId, input.exchangeTradeId, input.detail);
}
