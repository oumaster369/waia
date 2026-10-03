import type { Balance, Order, Trade } from "@/lib/trader/connectors/types";
import type { HtxObservationCoverage } from "./coverage";
import type {
  HtxDerivativesAccountFamily,
  HtxDerivativesAccountRow,
  HtxDerivativesAccountSnapshot,
  HtxDerivativesFillRow,
  HtxDerivativesPositionRow,
} from "./derivatives/types";
import type {
  HtxV5AlgoOrder,
  HtxV5AssetMode,
  HtxV5BalanceDetail,
  HtxV5BalanceSnapshot,
  HtxV5Fill,
  HtxV5OpenOrder,
  HtxV5Position,
} from "./derivatives/htx-v5-read-contract";

export type ObservationBinding = Readonly<{
  organizationId: string;
  credentialId: string;
  exchangeAccountId: string;
  credentialRevision: string;
  configurationRevision: string;
}>;
export type ObservationLease = Readonly<{
  binding: ObservationBinding;
  token: string;
  ownerId: string;
  expiresAtMs: number;
  consecutiveFailures: number;
}>;
export type ObservationReadError =
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "PERMISSION_DENIED"
  | "READ_FAILED"
  | "INVALID_RESPONSE"
  | "IDENTITY_MISMATCH";
/** HTX open-order REST evidence has no last-update timestamp; unknown stays null. */
export type ObservedOrder = Omit<Order, "rawVenueObservation" | "updatedAt"> & {
  updatedAt: string | null;
};
export type ObservedTrade = Omit<Trade, "rawVenueObservation">;
export type ObservationComponent<T> = Readonly<{
  status: "COMPLETE" | "PARTIAL" | "ERROR";
  values: readonly T[] | null;
  sourceAsOfMs: number | null;
  readStartedAtMs: number;
  readCompletedAtMs: number;
  error: ObservationReadError | null;
}>;
export type ReadEnvelope<T> = Readonly<{
  binding: ObservationBinding;
  values: readonly T[];
  sourceAsOfMs: number | null;
  complete: boolean;
}>;
/** This port cannot submit/cancel/amend. Credentials never enter the domain service. */
export type AccountObservationReader = Readonly<{
  readBalances(signal: AbortSignal): Promise<ReadEnvelope<Balance>>;
  readOpenOrders(signal: AbortSignal): Promise<ReadEnvelope<ObservedOrder>>;
  readTrades(symbol: string, signal: AbortSignal): Promise<ReadEnvelope<ObservedTrade>>;
  /** Present only for an enabled digest-bound V5 assignment. */
  readHtxV5?(signal: AbortSignal): Promise<HtxV5ObservationReadResult>;
  /** Optional unless this exact family list is present in digest-bound config. */
  readDerivativesAccount?(
    family: HtxDerivativesAccountFamily,
    signal: AbortSignal,
  ): Promise<
    Readonly<{
      binding: ObservationBinding;
      snapshot: HtxDerivativesAccountSnapshot;
      positions: DerivativesPositionsObservation;
      executions?: DerivativesExecutionsObservation;
    }>
  >;
  dispose(): void;
  /** Resolves only after disposed transport work has actually settled, including late responses. */
  settled?(): Promise<void>;
}>;
export type DerivativesExecutionsObservation = Readonly<{
  status: "NOT_CONFIGURED" | "COMPLETE" | "PARTIAL" | "ERROR";
  coverage: "CONFIGURED_CONTRACTS" | "NOT_CONFIGURED";
  values: readonly HtxDerivativesFillRow[] | null;
  contracts: readonly string[];
  readStartedAtMs: number;
  readCompletedAtMs: number;
  responseGeneratedAtMs: number | null;
  windowStartMs: number | null;
  windowEndMs: number | null;
  error: ObservationReadError | null;
}>;
export type DerivativesPositionsObservation = Readonly<{
  status: "COMPLETE" | "PARTIAL" | "ERROR";
  values: readonly HtxDerivativesPositionRow[] | null;
  readStartedAtMs: number;
  readCompletedAtMs: number;
  responseGeneratedAtMs: number | null;
  error: ObservationReadError | null;
}>;
export type DerivativesAccountFamilyObservation = Readonly<{
  family: HtxDerivativesAccountFamily;
  status: "NOT_CONFIGURED" | "COMPLETE" | "PARTIAL" | "ERROR";
  accounts: readonly HtxDerivativesAccountRow[] | null;
  readStartedAtMs: number | null;
  readCompletedAtMs: number | null;
  responseGeneratedAtMs: number | null;
  error: ObservationReadError | null;
  /** Omitted only for legacy stored observations; a fresh read always records it. */
  positions?: DerivativesPositionsObservation;
  /** Omitted only for legacy stored observations; a fresh derivatives read records it. */
  executions?: DerivativesExecutionsObservation;
}>;
export type DerivativesAccountObservation = Readonly<{
  schemaVersion: "htx-derivatives-observation/v1";
  families: readonly DerivativesAccountFamilyObservation[];
}>;
export type HtxV5ComponentStatus = "NOT_CONFIGURED" | "COMPLETE" | "PARTIAL" | "ERROR";
export type HtxV5ValueObservation<T> = Readonly<{
  status: Exclude<HtxV5ComponentStatus, "NOT_CONFIGURED" | "PARTIAL">;
  value: T | null;
  readStartedAtMs: number | null;
  readCompletedAtMs: number | null;
  responseGeneratedAtMs: number | null;
  error: ObservationReadError | null;
}>;
export type HtxV5PageScope = Readonly<{
  pageSize: number;
  maxPages: number;
  pagesRead: number;
  nextFrom: string | null;
  completeness: "UNKNOWN";
}>;
export type HtxV5RowsObservation<T> = Readonly<{
  status: Exclude<HtxV5ComponentStatus, "NOT_CONFIGURED">;
  values: readonly T[] | null;
  readStartedAtMs: number | null;
  readCompletedAtMs: number | null;
  responseGeneratedAtMs: number | null;
  error: ObservationReadError | null;
  /** Unpaginated endpoints use null; cursor-driven endpoints preserve unknown coverage. */
  pageScope: HtxV5PageScope | null;
}>;
export type HtxV5AlgoOrdersObservation = Readonly<{
  status: Exclude<HtxV5ComponentStatus, "NOT_CONFIGURED">;
  values: readonly HtxV5AlgoOrder[] | null;
  readStartedAtMs: number | null;
  readCompletedAtMs: number | null;
  responseGeneratedAtMs: number | null;
  error: ObservationReadError | null;
  pageScope: Readonly<{
    pageSize: number;
    maxPagesPerType: number;
    queries: readonly Readonly<{ type: string; pagesRead: number; nextFrom: string | null }>[];
    completeness: "UNKNOWN";
  }> | null;
}>;
export type HtxV5FillsObservation = Readonly<{
  status: HtxV5ComponentStatus;
  values: readonly HtxV5Fill[] | null;
  readStartedAtMs: number | null;
  readCompletedAtMs: number | null;
  responseGeneratedAtMs: number | null;
  error: ObservationReadError | null;
  coverage: "NOT_CONFIGURED" | "CONFIGURED_CONTRACTS_AND_WINDOW";
  contracts: readonly string[];
  windowStartMs: number | null;
  windowEndMs: number | null;
  pageScope: Readonly<{
    pageSize: number;
    maxPagesPerContract: number;
    queries: readonly Readonly<{ contractCode: string; pagesRead: number; nextFrom: string | null }>[];
    completeness: "UNKNOWN";
  }> | null;
}>;
export type HtxV5AccountObservation = Readonly<{
  schemaVersion: "htx-v5-observation/v1";
  /** Descriptive source identity only; never a reusable authorization receipt. */
  htxUid: string | null;
  assetMode: HtxV5ValueObservation<HtxV5AssetMode>;
  balance: HtxV5ValueObservation<Readonly<{
    state: "normal" | "liquidating" | "adl" | "open_limit";
    account: HtxV5BalanceSnapshot["account"];
    details: readonly HtxV5BalanceDetail[];
  }>>;
  positions: HtxV5RowsObservation<HtxV5Position>;
  openOrders: HtxV5RowsObservation<HtxV5OpenOrder>;
  algoOrders: HtxV5AlgoOrdersObservation;
  fills: HtxV5FillsObservation;
}>;
export type HtxV5ObservationConfiguration = Readonly<{
  enabled: boolean;
  fillContracts?: readonly string[];
  expectedHtxUid?: string;
}>;
/** Fixed reader bound used in the scheduler lease inequality and service timeout. */
export const HTX_V5_READ_BUDGET_MS = 120_000;
export type HtxV5ObservationReadResult = Readonly<{
  binding: ObservationBinding;
  projection: HtxV5AccountObservation;
}>;
export type AccountObservationFields = Readonly<{
  observationId: string;
  binding: ObservationBinding;
  collectionStartedAtMs: number;
  collectionCompletedAtMs: number;
  status: "COMPLETE" | "PARTIAL" | "ERROR";
  balances: ObservationComponent<Balance>;
  openOrders: ObservationComponent<ObservedOrder>;
  trades: readonly Readonly<{ symbol: string; component: ObservationComponent<ObservedTrade> }>[];
  /** Holdings are not strategy positions, marked equity or an entry-cost/PnL claim. */
  holdings: readonly Balance[] | null;
}>;
/** Runtime validation enforces version-specific required/forbidden projection fields. */
export type AccountObservation = AccountObservationFields & Readonly<{
  schemaVersion: "account-observation/v1" | "account-observation/v2" | "account-observation/v3";
  derivatives?: DerivativesAccountObservation;
  htxV5?: HtxV5AccountObservation;
}>;
export type ObservationRepository = Readonly<{
  /** Atomically require active exact credential/config, next-due and unowned/expired lease. */
  claimDue(
    binding: ObservationBinding,
    ownerId: string,
    nowMs: number,
    ttlMs: number,
  ): Promise<ObservationLease | null>;
  isCurrent(lease: ObservationLease, nowMs: number): Promise<boolean>;
  /** ONE atomic transaction: require active exact binding + live token; append observation,
   * persist cadence/failure count and release this token. A pre-read check alone is insufficient. */
  commitIfCurrent(
    input: Readonly<{
      lease: ObservationLease;
      observation: AccountObservation;
      nowMs: number;
      nextDueAtMs: number;
      consecutiveFailures: number;
    }>,
  ): Promise<boolean>;
  /** Token compare-and-release; an obsolete owner cannot release a successor. */
  release(lease: Pick<ObservationLease, "binding" | "ownerId" | "token">): Promise<void>;
}>;
export type ObservationClock = Readonly<{
  now(): number;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}>;
export type ObservationConfig = Readonly<{
  revision: string;
  symbols: readonly string[];
  pollIntervalMs: number;
  maxBackoffMs: number;
  readTimeoutMs: number;
  leaseTtlMs: number;
  /** Omit to preserve the legacy spot-only digest and v1 observation shape. */
  htxDerivativesFamilies?: readonly HtxDerivativesAccountFamily[];
  /** Digest-bound contracts for executed-fill history. Open positions are not this set. */
  htxDerivativesFillContracts?: readonly Readonly<{
    family: HtxDerivativesAccountFamily;
    contract: string;
  }>[];
  /** Required by the configured HTX composition; generic injected readers may omit it. */
  htxCoverage?: HtxObservationCoverage;
  /** Optional protected V5 observation scope; omitted preserves legacy behavior. */
  htxV5?: HtxV5ObservationConfiguration;
}>;
export type ObservationTickResult =
  | Readonly<{ status: "NOT_CLAIMED" | "FENCED" }>
  | Readonly<{ status: "COMMITTED"; observation: AccountObservation; nextDueAtMs: number }>;
