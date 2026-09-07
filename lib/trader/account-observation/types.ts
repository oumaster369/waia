import type { Balance, Order, Trade } from "@/lib/trader/connectors/types";

export type ObservationBinding = Readonly<{
  organizationId: string; credentialId: string; exchangeAccountId: string;
  credentialRevision: string; configurationRevision: string;
}>;
export type ObservationLease = Readonly<{
  binding: ObservationBinding; token: string; ownerId: string; expiresAtMs: number;
  consecutiveFailures: number;
}>;
export type ObservationReadError = "TIMEOUT" | "RATE_LIMITED" | "PERMISSION_DENIED" |
  "READ_FAILED" | "INVALID_RESPONSE" | "IDENTITY_MISMATCH";
export type ObservedOrder = Omit<Order, "rawVenueObservation">;
export type ObservedTrade = Omit<Trade, "rawVenueObservation">;
export type ObservationComponent<T> = Readonly<{
  status: "COMPLETE" | "PARTIAL" | "ERROR";
  values: readonly T[] | null;
  sourceAsOfMs: number | null;
  readStartedAtMs: number; readCompletedAtMs: number;
  error: ObservationReadError | null;
}>;
export type ReadEnvelope<T> = Readonly<{
  binding: ObservationBinding; values: readonly T[];
  sourceAsOfMs: number | null; complete: boolean;
}>;
/** This port cannot submit/cancel/amend. Credentials never enter the domain service. */
export type AccountObservationReader = Readonly<{
  readBalances(signal: AbortSignal): Promise<ReadEnvelope<Balance>>;
  readOpenOrders(signal: AbortSignal): Promise<ReadEnvelope<ObservedOrder>>;
  readTrades(symbol: string, signal: AbortSignal): Promise<ReadEnvelope<ObservedTrade>>;
  dispose(): void;
}>;
export type AccountObservation = Readonly<{
  schemaVersion: "account-observation/v1"; observationId: string;
  binding: ObservationBinding; collectionStartedAtMs: number; collectionCompletedAtMs: number;
  status: "COMPLETE" | "PARTIAL" | "ERROR";
  balances: ObservationComponent<Balance>; openOrders: ObservationComponent<ObservedOrder>;
  trades: readonly Readonly<{ symbol: string; component: ObservationComponent<ObservedTrade> }>[];
  /** Holdings are not strategy positions, marked equity or an entry-cost/PnL claim. */
  holdings: readonly Balance[] | null;
}>;
export type ObservationRepository = Readonly<{
  /** Atomically require active exact credential/config, next-due and unowned/expired lease. */
  claimDue(binding: ObservationBinding, ownerId: string, nowMs: number, ttlMs: number):
    Promise<ObservationLease | null>;
  isCurrent(lease: ObservationLease, nowMs: number): Promise<boolean>;
  /** ONE atomic transaction: require active exact binding + live token; append observation,
   * persist cadence/failure count and release this token. A pre-read check alone is insufficient. */
  commitIfCurrent(input: Readonly<{ lease: ObservationLease; observation: AccountObservation;
    nowMs: number; nextDueAtMs: number; consecutiveFailures: number }>): Promise<boolean>;
  /** Token compare-and-release; an obsolete owner cannot release a successor. */
  release(lease: ObservationLease): Promise<void>;
}>;
export type ObservationClock = Readonly<{
  now(): number;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}>;
export type ObservationConfig = Readonly<{
  revision: string; symbols: readonly string[]; pollIntervalMs: number; maxBackoffMs: number;
  readTimeoutMs: number; leaseTtlMs: number;
}>;
export type ObservationTickResult =
  | Readonly<{ status: "NOT_CLAIMED" | "FENCED" }>
  | Readonly<{ status: "COMMITTED"; observation: AccountObservation; nextDueAtMs: number }>;
