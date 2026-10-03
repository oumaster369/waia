import type { Balance } from "@/lib/trader/connectors/types";
import {
  HTX_DERIVATIVES_ACCOUNT_FAMILIES,
  HTX_DERIVATIVES_FILL_CONTRACT_LIMIT,
  HTX_DERIVATIVES_FILL_MAX_ROWS,
  isHtxDerivativesFillContract,
  type HtxDerivativesAccountFamily,
  type HtxDerivativesAccountRow,
  type HtxDerivativesFillRow,
  type HtxDerivativesPositionRow,
} from "./derivatives/types";
import type {
  AccountObservation,
  AccountObservationReader,
  HtxV5AccountObservation,
  ObservationBinding,
  ObservationClock,
  DerivativesAccountFamilyObservation,
  DerivativesAccountObservation,
  ObservationComponent,
  DerivativesExecutionsObservation,
  DerivativesPositionsObservation,
  ObservationConfig,
  ObservationLease,
  ObservationReadError,
  ObservationRepository,
  ObservationTickResult,
  ObservedOrder,
  ObservedTrade,
  ReadEnvelope,
} from "./types";
import { HTX_V5_READ_BUDGET_MS } from "./types";
import { htxV5ObservationConfigurationSchema } from "./coverage";
import {
  deriveAccountObservationStatus,
  parseAccountObservation,
  sameObservationBinding,
} from "./validation";

const bindingKeys = [
  "organizationId",
  "credentialId",
  "exchangeAccountId",
  "credentialRevision",
  "configurationRevision",
] as const;
const errors: readonly ObservationReadError[] = [
  "TIMEOUT",
  "RATE_LIMITED",
  "PERMISSION_DENIED",
  "READ_FAILED",
  "INVALID_RESPONSE",
  "IDENTITY_MISMATCH",
];
export class AccountObservationReadFailure extends Error {
  constructor(readonly code: ObservationReadError) {
    super(code);
  }
}
/** Classified diagnostics only; never attach raw transport/database exceptions. */
export class AccountObservationFailure extends Error {
  readonly secondary: string[] = [];
  constructor(readonly code: string) {
    super(code);
  }
}
function invalid(): never {
  throw new AccountObservationReadFailure("INVALID_RESPONSE");
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 256) invalid();
  return value;
}
function decimal(value: unknown): string {
  const result = text(value);
  if (!/^\d+(?:\.\d+)?$/.test(result)) invalid();
  return result;
}
function signedDecimal(value: unknown): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value.length > 80 ||
    !/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)
  )
    invalid();
  return value;
}
function nonnegativePositionDecimal(value: unknown): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value.length > 80 ||
    !/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)
  )
    invalid();
  return value;
}
function optionalClientId(value: unknown): string {
  return value === "" ? "" : text(value);
}
function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (!allowed.includes(value as T)) invalid();
  return value as T;
}
function timestamp(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid();
  return value as number;
}
function dateText(value: unknown): string {
  const result = text(value);
  if (!Number.isFinite(Date.parse(result))) invalid();
  return result;
}
function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function copyBinding(value: ObservationBinding): ObservationBinding {
  return Object.freeze(
    Object.fromEntries(bindingKeys.map((key) => [key, text(value[key])])),
  ) as ObservationBinding;
}
function sameBinding(a: ObservationBinding, b: ObservationBinding): boolean {
  return !!b && bindingKeys.every((key) => a[key] === b[key]);
}
function balance(value: unknown): Balance {
  const r = row(value);
  return Object.freeze({
    asset: text(r.asset),
    free: decimal(r.free),
    locked: decimal(r.locked),
    total: decimal(r.total),
  });
}
function order(value: unknown): ObservedOrder {
  const r = row(value);
  return Object.freeze({
    orderId: text(r.orderId),
    clientOrderId: optionalClientId(r.clientOrderId),
    symbol: text(r.symbol),
    side: enumValue(r.side, ["buy", "sell"]),
    type: enumValue(r.type, ["limit", "market"]),
    status: enumValue(r.status, ["open", "partially_filled"]),
    ...(r.price === undefined ? {} : { price: decimal(r.price) }),
    quantity: decimal(r.quantity),
    filledQuantity: decimal(r.filledQuantity),
    createdAt: dateText(r.createdAt),
    updatedAt: r.updatedAt === null ? null : dateText(r.updatedAt),
  });
}
function trade(value: unknown, symbol: string): ObservedTrade {
  const r = row(value);
  if (r.symbol !== symbol) invalid();
  return Object.freeze({
    tradeId: text(r.tradeId),
    orderId: text(r.orderId),
    clientOrderId: optionalClientId(r.clientOrderId),
    symbol,
    side: enumValue(r.side, ["buy", "sell"]),
    price: decimal(r.price),
    quantity: decimal(r.quantity),
    fee: decimal(r.fee),
    feeAsset: text(r.feeAsset),
    executedAt: dateText(r.executedAt),
  });
}
function position(value: unknown, family: HtxDerivativesAccountFamily): HtxDerivativesPositionRow {
  const r = row(value);
  const symbol = text(r.symbol).toUpperCase();
  const contractCode = text(r.contractCode).toUpperCase();
  const direction = enumValue(r.direction, ["buy", "sell"] as const);
  const contractType = r.contractType === null ? null : text(r.contractType).toLowerCase();
  const marginAsset = r.marginAsset === null ? null : text(r.marginAsset).toUpperCase();
  if (
    !/^[A-Z0-9_-]{1,64}$/.test(symbol) ||
    !/^[A-Z0-9_-]{1,64}$/.test(contractCode) ||
    (contractType !== null && !/^[a-z0-9_-]{1,32}$/.test(contractType)) ||
    (family.startsWith("usdt_") ? marginAsset !== "USDT" : marginAsset !== symbol)
  )
    invalid();
  const signed = new Set(["unrealizedPnl", "profitRate"]);
  const values = [
    "volume",
    "available",
    "frozen",
    "costOpen",
    "costHold",
    "unrealizedPnl",
    "profitRate",
    "positionMargin",
    "leverage",
    "lastPrice",
    "liquidationPrice",
  ] as const;
  const numeric = Object.fromEntries(
    values.map((key) => [
      key,
      signed.has(key) ? signedDecimal(r[key]) : nonnegativePositionDecimal(r[key]),
    ]),
  ) as Record<(typeof values)[number], string | null>;
  return Object.freeze({ symbol, contractCode, contractType, direction, ...numeric, marginAsset });
}
function fill(value: unknown, family: HtxDerivativesAccountFamily): HtxDerivativesFillRow {
  const r = row(value);
  const id = text(r.id);
  const symbol = text(r.symbol).toUpperCase();
  const contractCode = text(r.contractCode).toUpperCase();
  const direction = enumValue(r.direction, ["buy", "sell"] as const);
  const offset = enumValue(r.offset, ["open", "close", "both"] as const);
  const matchesSymbol =
    family === "coin_delivery_futures"
      ? new RegExp(`^${symbol}\\d{6}$`).test(contractCode)
      : contractCode.startsWith(`${symbol}-`);
  if (
    !/^[A-Za-z0-9_-]{1,128}$/.test(id) ||
    !isHtxDerivativesFillContract(family, contractCode) ||
    !matchesSymbol
  )
    invalid();
  const matchId = r.matchId === null ? null : text(r.matchId);
  const orderId = r.orderId === null ? null : text(r.orderId);
  const feeAsset = r.feeAsset === null ? null : text(r.feeAsset).toUpperCase();
  const contractType = r.contractType === null ? null : text(r.contractType).toLowerCase();
  const orderSource = r.orderSource === null ? null : text(r.orderSource).toLowerCase();
  if (
    (matchId !== null && !/^\d{1,40}$/.test(matchId)) ||
    (orderId !== null && !/^[A-Za-z0-9_-]{1,64}$/.test(orderId)) ||
    (feeAsset !== null && !/^[A-Z0-9]{1,16}$/.test(feeAsset)) ||
    (contractType !== null && !/^[a-z0-9_-]{1,32}$/.test(contractType)) ||
    (orderSource !== null && !/^[a-z0-9_-]{1,32}$/.test(orderSource))
  )
    invalid();
  const executedAtMs = r.executedAtMs === null ? null : timestamp(r.executedAtMs);
  return Object.freeze({
    id,
    matchId,
    orderId,
    symbol,
    contractCode,
    contractType,
    direction,
    offset,
    volume: nonnegativePositionDecimal(r.volume),
    price: nonnegativePositionDecimal(r.price),
    fee: signedDecimal(r.fee),
    feeAsset,
    realizedPnl: signedDecimal(r.realizedPnl),
    offsetPnl: signedDecimal(r.offsetPnl),
    executedAtMs,
    orderSource,
  });
}

function htxV5FailureProjection(
  code: ObservationReadError,
  startedAtMs: number,
  completedAtMs: number,
  contracts: readonly string[],
): HtxV5AccountObservation {
  const valueFailure = (value: null) => Object.freeze({ status: "ERROR" as const, value,
    readStartedAtMs: startedAtMs, readCompletedAtMs: completedAtMs,
    responseGeneratedAtMs: null, error: code });
  const rowsFailure = Object.freeze({ status: "ERROR" as const, values: null,
    readStartedAtMs: startedAtMs, readCompletedAtMs: completedAtMs,
    responseGeneratedAtMs: null, error: code, pageScope: null });
  return Object.freeze({ schemaVersion: "htx-v5-observation/v1", htxUid: null,
    assetMode: valueFailure(null),
    balance: valueFailure(null),
    positions: rowsFailure,
    openOrders: rowsFailure,
    algoOrders: Object.freeze({ status: "ERROR" as const, values: null,
      readStartedAtMs: startedAtMs, readCompletedAtMs: completedAtMs,
      responseGeneratedAtMs: null, error: code, pageScope: null }),
    fills: contracts.length ? Object.freeze({ status: "ERROR" as const, values: null,
      readStartedAtMs: startedAtMs, readCompletedAtMs: completedAtMs,
      responseGeneratedAtMs: null, error: code, coverage: "CONFIGURED_CONTRACTS_AND_WINDOW" as const,
      contracts: Object.freeze([...contracts]), windowStartMs: null, windowEndMs: null, pageScope: null })
      : Object.freeze({ status: "NOT_CONFIGURED" as const, values: null, readStartedAtMs: null,
        readCompletedAtMs: null, responseGeneratedAtMs: null, error: null, coverage: "NOT_CONFIGURED" as const,
        contracts: Object.freeze([]), windowStartMs: null, windowEndMs: null, pageScope: null }),
  });
}

/** Injected domain core. NOT a runtime or PostgreSQL adapter; no background work starts here. */
export function createAccountObservationService(
  deps: Readonly<{
    repository: ObservationRepository;
    clock: ObservationClock;
    newObservationId(): string;
    openReader(binding: ObservationBinding, signal: AbortSignal): Promise<AccountObservationReader>;
  }>,
  inputConfig: ObservationConfig,
) {
  const rawDerivativeFamilies = inputConfig.htxDerivativesFamilies;
  const rawFillContracts = inputConfig.htxDerivativesFillContracts;
  if (
    rawDerivativeFamilies !== undefined &&
    (!Array.isArray(rawDerivativeFamilies) ||
      rawDerivativeFamilies.length === 0 ||
      rawDerivativeFamilies.length > HTX_DERIVATIVES_ACCOUNT_FAMILIES.length)
  ) {
    throw new Error("ACCOUNT_OBSERVATION_INVALID_CONFIG");
  }
  if (
    rawFillContracts !== undefined &&
    (!Array.isArray(rawFillContracts) ||
      rawFillContracts.length === 0 ||
      rawFillContracts.length > HTX_DERIVATIVES_FILL_CONTRACT_LIMIT)
  ) {
    throw new Error("ACCOUNT_OBSERVATION_INVALID_CONFIG");
  }
  const derivativeFamilies =
    rawDerivativeFamilies === undefined ? undefined : Object.freeze([...rawDerivativeFamilies]);
  const fillContracts =
    rawFillContracts === undefined
      ? undefined
      : Object.freeze(
          rawFillContracts.map((item) =>
            Object.freeze({ family: item.family, contract: item.contract }),
          ),
        );
  const htxV5 = inputConfig.htxV5 === undefined
    ? undefined
    : Object.freeze({ ...htxV5ObservationConfigurationSchema.parse(inputConfig.htxV5),
        ...(inputConfig.htxV5.fillContracts
          ? { fillContracts: Object.freeze([...inputConfig.htxV5.fillContracts].sort()) }
          : {}) });
  const config = Object.freeze({
    ...inputConfig,
    symbols: Object.freeze([...inputConfig.symbols]),
    ...(derivativeFamilies
      ? { htxDerivativesFamilies: Object.freeze([...derivativeFamilies]) }
      : {}),
    ...(fillContracts ? { htxDerivativesFillContracts: fillContracts } : {}),
    ...(htxV5 ? { htxV5 } : {}),
  });
  text(config.revision);
  if (
    !config.symbols.length ||
    config.symbols.length > 32 ||
    new Set(config.symbols).size !== config.symbols.length ||
    config.symbols.some((symbol) => !/^[A-Z0-9]{2,32}$/.test(symbol)) ||
    (derivativeFamilies !== undefined &&
      (!Array.isArray(derivativeFamilies) ||
        !derivativeFamilies.length ||
        derivativeFamilies.length > HTX_DERIVATIVES_ACCOUNT_FAMILIES.length ||
        new Set(derivativeFamilies).size !== derivativeFamilies.length ||
        derivativeFamilies.some((family) => !HTX_DERIVATIVES_ACCOUNT_FAMILIES.includes(family)))) ||
    [config.pollIntervalMs, config.maxBackoffMs, config.readTimeoutMs, config.leaseTtlMs].some(
      (value) => !Number.isSafeInteger(value) || value <= 0,
    ) ||
    config.maxBackoffMs < config.pollIntervalMs ||
    config.leaseTtlMs <=
      config.readTimeoutMs *
        (3 +
          config.symbols.length +
          (derivativeFamilies?.length ?? 0) +
          (fillContracts?.length ?? 0)) +
        (htxV5?.enabled ? HTX_V5_READ_BUDGET_MS : 0) ||
    (htxV5 !== undefined &&
      ((!htxV5.enabled &&
        (htxV5.fillContracts !== undefined || htxV5.expectedHtxUid !== undefined)) ||
        new Set(htxV5.fillContracts ?? []).size !== (htxV5.fillContracts?.length ?? 0))) ||
    (fillContracts !== undefined &&
      (derivativeFamilies === undefined ||
        new Set(fillContracts.map((item) => `${item.family}\u0000${item.contract}`)).size !==
          fillContracts.length ||
        fillContracts.some(
          (item) =>
            !derivativeFamilies.includes(item.family) ||
            !isHtxDerivativesFillContract(item.family, item.contract),
        )))
  ) {
    throw new Error("ACCOUNT_OBSERVATION_INVALID_CONFIG");
  }
  const now = () => timestamp(deps.clock.now());
  async function open(
    binding: ObservationBinding,
    signal?: AbortSignal,
  ): Promise<AccountObservationReader> {
    if (signal?.aborted) throw new AccountObservationFailure("ACCOUNT_OBSERVATION_OPEN_FAILED");
    const abort = new AbortController();
    let abandoned = false;
    let resolved: AccountObservationReader | undefined;
    let disposed = false;
    const failure = new AccountObservationFailure("ACCOUNT_OBSERVATION_OPEN_FAILED");
    const disposeLate = () => {
      if (disposed || !resolved) return;
      disposed = true;
      try {
        resolved.dispose();
      } catch {
        failure.secondary.push("LATE_DISPOSAL_FAILED");
      }
    };
    let cancel!: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      cancel = () => {
        abort.abort();
        reject(failure);
      };
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) cancel();
    });
    const pending = Promise.resolve().then(() => deps.openReader(binding, abort.signal));
    void pending.then(
      (reader) => {
        resolved = reader;
        if (abandoned) disposeLate();
      },
      () => {},
    );
    try {
      return await Promise.race([
        pending,
        cancelled,
        deps.clock.sleep(config.readTimeoutMs, abort.signal).then(() => {
          failure.secondary.push("OPEN_TIMEOUT");
          throw failure;
        }),
      ]);
    } catch {
      abandoned = true;
      disposeLate();
      throw failure;
    } finally {
      signal?.removeEventListener("abort", cancel);
      abort.abort();
    }
  }
  async function current(lease: ObservationLease) {
    const time = now();
    return (
      Number.isSafeInteger(lease.expiresAtMs) &&
      time < lease.expiresAtMs &&
      (await deps.repository.isCurrent(lease, time))
    );
  }
  async function read<T>(
    lease: ObservationLease,
    fetch: (signal: AbortSignal) => Promise<ReadEnvelope<T>>,
    normalize: (item: unknown) => T,
    signal?: AbortSignal,
  ): Promise<ObservationComponent<T>> {
    const started = now();
    const abort = new AbortController();
    const cancel = () => abort.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      if (signal?.aborted) throw new AccountObservationReadFailure("READ_FAILED");
      const response = await Promise.race([
        fetch(abort.signal),
        deps.clock.sleep(config.readTimeoutMs, abort.signal).then(() => {
          throw new AccountObservationReadFailure("TIMEOUT");
        }),
      ]);
      const ended = now();
      if (ended < started) invalid();
      if (!response || !sameBinding(lease.binding, response.binding)) {
        throw new AccountObservationReadFailure("IDENTITY_MISMATCH");
      }
      if (!Array.isArray(response.values) || typeof response.complete !== "boolean") invalid();
      const sourceAsOfMs = response.sourceAsOfMs === null ? null : timestamp(response.sourceAsOfMs);
      if (sourceAsOfMs !== null && sourceAsOfMs > ended) invalid();
      const values = Object.freeze(Array.from(response.values, normalize));
      return Object.freeze({
        status: response.complete ? "COMPLETE" : "PARTIAL",
        values,
        sourceAsOfMs,
        readStartedAtMs: started,
        readCompletedAtMs: ended,
        error: null,
      });
    } catch (error) {
      const code =
        error instanceof AccountObservationReadFailure && errors.includes(error.code)
          ? error.code
          : "READ_FAILED";
      return Object.freeze({
        status: "ERROR",
        values: null,
        sourceAsOfMs: null,
        readStartedAtMs: started,
        readCompletedAtMs: now(),
        error: code,
      });
    } finally {
      signal?.removeEventListener("abort", cancel);
      abort.abort();
    }
  }
  async function readDerivative(
    lease: ObservationLease,
    family: HtxDerivativesAccountFamily,
    reader: AccountObservationReader,
    signal?: AbortSignal,
  ): Promise<DerivativesAccountFamilyObservation | null> {
    const started = now();
    const abort = new AbortController();
    const cancel = () => abort.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    const failed = (
      error: ObservationReadError,
      completedAt = now(),
    ): DerivativesAccountFamilyObservation =>
      Object.freeze({
        family,
        status: "ERROR",
        accounts: null,
        readStartedAtMs: started,
        readCompletedAtMs: completedAt,
        responseGeneratedAtMs: null,
        error,
        positions: Object.freeze({
          status: "ERROR",
          values: null,
          readStartedAtMs: started,
          readCompletedAtMs: completedAt,
          responseGeneratedAtMs: null,
          error,
        }),
        executions: Object.freeze({
          status: "ERROR",
          coverage: "CONFIGURED_CONTRACTS",
          values: null,
          contracts: Object.freeze([]),
          readStartedAtMs: started,
          readCompletedAtMs: completedAt,
          responseGeneratedAtMs: null,
          windowStartMs: null,
          windowEndMs: null,
          error,
        }),
      });
    try {
      if (signal?.aborted) throw new AccountObservationReadFailure("READ_FAILED");
      const readDerivativesAccount = reader.readDerivativesAccount;
      if (typeof readDerivativesAccount !== "function") {
        throw new AccountObservationFailure("ACCOUNT_OBSERVATION_DERIVATIVES_READER_UNAVAILABLE");
      }
      const response = await Promise.race([
        readDerivativesAccount.call(reader, family, abort.signal),
        deps.clock.sleep(config.readTimeoutMs, abort.signal).then(() => {
          throw new AccountObservationReadFailure("TIMEOUT");
        }),
      ]);
      const ended = now();
      if (ended < started) invalid();
      if (!response) invalid();
      if (!response.binding || !sameObservationBinding(lease.binding, response.binding))
        return null;
      const snapshot = response.snapshot;
      if (!snapshot) invalid();
      if (!HTX_DERIVATIVES_ACCOUNT_FAMILIES.includes(snapshot.family)) invalid();
      if (snapshot.family !== family) return null;
      if (snapshot.schemaVersion !== "htx-derivatives-account/v1") invalid();
      if (!Array.isArray(snapshot.accounts) || snapshot.accounts.length > 100) invalid();
      const responseGeneratedAtMs =
        snapshot.responseGeneratedAtMs === null ? null : timestamp(snapshot.responseGeneratedAtMs);
      if (responseGeneratedAtMs !== null && responseGeneratedAtMs > ended) invalid();
      const accounts = Object.freeze(
        Array.from(
          snapshot.accounts,
          (account) => Object.freeze({ ...row(account) }) as unknown as HtxDerivativesAccountRow,
        ),
      );
      const positionsResponse = response.positions;
      if (!positionsResponse) invalid();
      let positions: DerivativesPositionsObservation | undefined;
      {
        if (
          !["COMPLETE", "PARTIAL", "ERROR"].includes(positionsResponse.status) ||
          !Number.isSafeInteger(positionsResponse.readStartedAtMs) ||
          !Number.isSafeInteger(positionsResponse.readCompletedAtMs) ||
          positionsResponse.readStartedAtMs > positionsResponse.readCompletedAtMs ||
          positionsResponse.readStartedAtMs < started ||
          positionsResponse.readCompletedAtMs > ended ||
          (positionsResponse.responseGeneratedAtMs !== null &&
            (!Number.isSafeInteger(positionsResponse.responseGeneratedAtMs) ||
              positionsResponse.responseGeneratedAtMs > positionsResponse.readCompletedAtMs)) ||
          (positionsResponse.status === "ERROR"
            ? positionsResponse.values !== null || positionsResponse.error === null
            : !Array.isArray(positionsResponse.values) || positionsResponse.error !== null)
        )
          invalid();
        if (
          positionsResponse.error === "IDENTITY_MISMATCH" ||
          positionsResponse.error === "PERMISSION_DENIED"
        )
          return null;
        const positionValues =
          positionsResponse.values === null
            ? null
            : Object.freeze(
                Array.from(positionsResponse.values, (value) => position(value, family)),
              );
        if (positionValues && positionValues.length > 100) invalid();
        positions = Object.freeze({
          status: positionsResponse.status,
          values: positionValues,
          readStartedAtMs: positionsResponse.readStartedAtMs,
          readCompletedAtMs: positionsResponse.readCompletedAtMs,
          responseGeneratedAtMs: positionsResponse.responseGeneratedAtMs,
          error: positionsResponse.error,
        });
      }
      const executionsResponse = response.executions;
      let executions: DerivativesExecutionsObservation | undefined;
      if (executionsResponse) {
        if (
          !["NOT_CONFIGURED", "COMPLETE", "PARTIAL", "ERROR"].includes(executionsResponse.status) ||
          !["CONFIGURED_CONTRACTS", "NOT_CONFIGURED"].includes(executionsResponse.coverage) ||
          !Number.isSafeInteger(executionsResponse.readStartedAtMs) ||
          !Number.isSafeInteger(executionsResponse.readCompletedAtMs) ||
          executionsResponse.readStartedAtMs > executionsResponse.readCompletedAtMs ||
          executionsResponse.readStartedAtMs < started ||
          executionsResponse.readCompletedAtMs > ended ||
          (executionsResponse.responseGeneratedAtMs !== null &&
            (!Number.isSafeInteger(executionsResponse.responseGeneratedAtMs) ||
              executionsResponse.responseGeneratedAtMs > executionsResponse.readCompletedAtMs)) ||
          (executionsResponse.status === "ERROR"
            ? executionsResponse.values !== null || executionsResponse.error === null
            : executionsResponse.status === "NOT_CONFIGURED"
              ? executionsResponse.values !== null || executionsResponse.error !== null
              : !Array.isArray(executionsResponse.values) || executionsResponse.error !== null) ||
          !Array.isArray(executionsResponse.contracts) ||
          executionsResponse.contracts.length > HTX_DERIVATIVES_FILL_CONTRACT_LIMIT
        )
          invalid();
        if (
          executionsResponse.error === "IDENTITY_MISMATCH" ||
          executionsResponse.error === "PERMISSION_DENIED"
        )
          return null;
        const fillValues =
          executionsResponse.values === null
            ? null
            : Object.freeze(Array.from(executionsResponse.values, (value) => fill(value, family)));
        if (fillValues && fillValues.length > HTX_DERIVATIVES_FILL_MAX_ROWS) invalid();
        executions = Object.freeze({
          status: executionsResponse.status,
          coverage: executionsResponse.coverage,
          values: fillValues,
          contracts: Object.freeze([...executionsResponse.contracts]),
          readStartedAtMs: executionsResponse.readStartedAtMs,
          readCompletedAtMs: executionsResponse.readCompletedAtMs,
          responseGeneratedAtMs: executionsResponse.responseGeneratedAtMs,
          windowStartMs:
            executionsResponse.windowStartMs === null
              ? null
              : timestamp(executionsResponse.windowStartMs),
          windowEndMs:
            executionsResponse.windowEndMs === null
              ? null
              : timestamp(executionsResponse.windowEndMs),
          error: executionsResponse.error,
        });
      }
      // Cross-margin exposes withdraw_available as transferable account balance;
      // other families use margin_available. Optional position metrics remain null.
      const partial = accounts.some(
        (account) =>
          account.marginBalance === null ||
          (family === "usdt_cross_shared"
            ? account.withdrawAvailable == null
            : account.marginAvailable === null),
      );
      return Object.freeze({
        family,
        status: partial ? "PARTIAL" : "COMPLETE",
        accounts,
        readStartedAtMs: started,
        readCompletedAtMs: ended,
        responseGeneratedAtMs,
        error: null,
        ...(positions ? { positions } : {}),
        ...(executions ? { executions } : {}),
      });
    } catch (error) {
      if (error instanceof AccountObservationFailure) throw error;
      const code =
        error instanceof AccountObservationReadFailure && errors.includes(error.code)
          ? error.code
          : error instanceof Error && error.message === "HTX_DERIVATIVES_INVALID_RESPONSE"
            ? "INVALID_RESPONSE"
            : "READ_FAILED";
      if (code === "IDENTITY_MISMATCH" || code === "PERMISSION_DENIED") return null;
      return failed(code);
    } finally {
      signal?.removeEventListener("abort", cancel);
      abort.abort();
    }
  }
  async function readHtxV5(
    lease: ObservationLease,
    reader: AccountObservationReader,
    signal?: AbortSignal,
  ): Promise<HtxV5AccountObservation | null> {
    const started = now();
    const contracts = config.htxV5?.fillContracts ?? [];
    const abort = new AbortController();
    const cancel = () => abort.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    const failed = (code: ObservationReadError) => htxV5FailureProjection(code, started,
      Math.max(started, now()), contracts);
    try {
      if (signal?.aborted) return null;
      const read = reader.readHtxV5;
      if (typeof read !== "function") return failed("READ_FAILED");
      const response = await Promise.race([
        read.call(reader, abort.signal),
        deps.clock.sleep(HTX_V5_READ_BUDGET_MS, abort.signal).then(() => {
          throw new AccountObservationReadFailure("TIMEOUT");
        }),
      ]);
      const ended = now();
      if (ended < started) return failed("INVALID_RESPONSE");
      if (!response || !response.binding || !sameObservationBinding(lease.binding, response.binding))
        return null;
      const projection = response.projection;
      if (!projection || projection.schemaVersion !== "htx-v5-observation/v1")
        return failed("INVALID_RESPONSE");
      const components = [projection.assetMode, projection.balance, projection.positions,
        projection.openOrders, projection.algoOrders, projection.fills];
      const onlyUnavailableWithoutUid = projection.htxUid === null && components.every(component =>
        component.status === "ERROR" || component.status === "NOT_CONFIGURED");
      if (config.htxV5?.expectedHtxUid && projection.htxUid !== config.htxV5.expectedHtxUid &&
        !onlyUnavailableWithoutUid) return null;
      const fills = projection.fills;
      const configuredContracts = [...contracts].sort();
      if (configuredContracts.length > 0
        ? fills.coverage !== "CONFIGURED_CONTRACTS_AND_WINDOW" ||
          fills.contracts.length !== configuredContracts.length ||
          fills.contracts.some((contract, index) => contract !== configuredContracts[index])
        : fills.coverage !== "NOT_CONFIGURED" || fills.contracts.length !== 0) {
        return failed("INVALID_RESPONSE");
      }
      if (components.some(component => component.error === "IDENTITY_MISMATCH" ||
        component.error === "PERMISSION_DENIED")) return null;
      return projection;
    } catch (error) {
      if (signal?.aborted) return null;
      const code = error instanceof AccountObservationReadFailure && errors.includes(error.code)
        ? error.code
        : error instanceof Error && error.message === "HTX_V5_INVALID_RESPONSE"
          ? "INVALID_RESPONSE"
          : "READ_FAILED";
      if (code === "IDENTITY_MISMATCH" || code === "PERMISSION_DENIED") return null;
      return failed(code);
    } finally {
      signal?.removeEventListener("abort", cancel);
      abort.abort();
    }
  }
  return Object.freeze({
    async tick(
      requestedBinding: ObservationBinding,
      ownerId: string,
      signal?: AbortSignal,
    ): Promise<ObservationTickResult> {
      const binding = copyBinding(requestedBinding);
      text(ownerId);
      if (binding.configurationRevision !== config.revision || signal?.aborted)
        return { status: "FENCED" };
      const started = now();
      let reader: AccountObservationReader | undefined;
      let primary: AccountObservationFailure | undefined;
      let committed = false;
      let releaseClaim: Pick<ObservationLease, "binding" | "ownerId" | "token"> | undefined;
      const dispose = () => {
        const owned = reader;
        reader = undefined;
        owned?.dispose();
      };
      try {
        let rawLease: ObservationLease | null;
        try {
          rawLease = await deps.repository.claimDue(binding, ownerId, started, config.leaseTtlMs);
        } catch {
          throw new AccountObservationFailure("ACCOUNT_OBSERVATION_CLAIM_FAILED");
        }
        if (!rawLease) return { status: "NOT_CLAIMED" };
        releaseClaim = Object.freeze({ binding, ownerId, token: text(rawLease.token) });
        const lease = Object.freeze({ ...rawLease, binding: copyBinding(rawLease.binding) });
        // Cancellation may arrive while the bounded database currentness check
        // is in flight. A true DB result cannot revive a cancelled tick.
        const active = async () => !signal?.aborted && (await current(lease)) && !signal?.aborted;
        if (
          !sameBinding(binding, lease.binding) ||
          lease.ownerId !== ownerId ||
          !lease.token ||
          !Number.isSafeInteger(lease.consecutiveFailures) ||
          lease.consecutiveFailures < 0 ||
          !(await active())
        )
          return { status: "FENCED" };
        reader = await open(binding, signal);
        if (!(await active())) return { status: "FENCED" };
        if (
          config.htxDerivativesFamilies?.length &&
          typeof reader.readDerivativesAccount !== "function"
        ) {
          throw new AccountObservationFailure("ACCOUNT_OBSERVATION_DERIVATIVES_READER_UNAVAILABLE");
        }
        const balances = await read(
          lease,
          (requestSignal) => reader!.readBalances(requestSignal),
          balance,
          signal,
        );
        if (balances.error === "IDENTITY_MISMATCH" || !(await active()))
          return { status: "FENCED" };
        const openOrders = await read(
          lease,
          (requestSignal) => reader!.readOpenOrders(requestSignal),
          order,
          signal,
        );
        if (openOrders.error === "IDENTITY_MISMATCH") return { status: "FENCED" };
        const trades: AccountObservation["trades"][number][] = [];
        for (const symbol of config.symbols) {
          if (!(await active())) return { status: "FENCED" };
          trades.push(
            Object.freeze({
              symbol,
              component: await read(
                lease,
                (requestSignal) => reader!.readTrades(symbol, requestSignal),
                (value) => trade(value, symbol),
                signal,
              ),
            }),
          );
          if (trades.at(-1)!.component.error === "IDENTITY_MISMATCH") return { status: "FENCED" };
        }
        const components = [balances, openOrders, ...trades.map((item) => item.component)];
        const observationId = text(deps.newObservationId());
        const holdings = balances.status === "COMPLETE" ? balances.values : null;
        const common = (
          collectionCompletedAtMs: number,
          derivativeFamilies: readonly DerivativesAccountFamilyObservation[] = [],
          htxV5: HtxV5AccountObservation | undefined = undefined,
        ) => ({
          observationId,
          binding,
          collectionStartedAtMs: started,
          collectionCompletedAtMs,
          status: deriveAccountObservationStatus([
            ...components.map((item) => item.status),
            ...derivativeFamilies.flatMap((item) =>
              item.status === "NOT_CONFIGURED"
                ? []
                : [
                    item.status,
                    ...(item.positions ? [item.positions.status] : []),
                    ...(item.executions && item.executions.status !== "NOT_CONFIGURED"
                      ? [item.executions.status]
                      : []),
                ],
            ),
            ...(htxV5 ? [htxV5.assetMode.status, htxV5.balance.status, htxV5.positions.status,
              htxV5.openOrders.status, htxV5.algoOrders.status, htxV5.fills.status]
              .filter((status): status is Exclude<typeof status, "NOT_CONFIGURED"> => status !== "NOT_CONFIGURED") : []),
          ]),
          balances,
          openOrders,
          trades: Object.freeze(trades),
          holdings,
        });
        let derivatives: DerivativesAccountObservation | undefined;
        if (config.htxDerivativesFamilies?.length) {
          const families: DerivativesAccountFamilyObservation[] =
            HTX_DERIVATIVES_ACCOUNT_FAMILIES.map((family) =>
              Object.freeze({
                family,
                status: "NOT_CONFIGURED" as const,
                accounts: null,
                readStartedAtMs: null,
                readCompletedAtMs: null,
                responseGeneratedAtMs: null,
                error: null,
              }),
            );
          for (const family of config.htxDerivativesFamilies) {
            if (!(await active())) return { status: "FENCED" };
            const result = await readDerivative(lease, family, reader!, signal);
            if (!result || !(await active())) return { status: "FENCED" };
            const index = families.findIndex((item) => item.family === family);
            families[index] = result;
            if (result.status !== "ERROR") {
              try {
                const candidateEnd = now();
                if (candidateEnd < started) invalid();
                parseAccountObservation({
                  schemaVersion: "account-observation/v2",
                  ...common(candidateEnd, families),
                  derivatives: { schemaVersion: "htx-derivatives-observation/v1", families },
                });
              } catch {
                families[index] = Object.freeze({
                  family,
                  status: "ERROR",
                  accounts: null,
                  readStartedAtMs: result.readStartedAtMs,
                  readCompletedAtMs: result.readCompletedAtMs,
                  responseGeneratedAtMs: null,
                  error: "INVALID_RESPONSE",
                });
              }
            }
          }
          derivatives = Object.freeze({
            schemaVersion: "htx-derivatives-observation/v1",
            families: Object.freeze(families),
          });
        }
        let htxV5: HtxV5AccountObservation | undefined;
        if (config.htxV5?.enabled) {
          if (!(await active())) return { status: "FENCED" };
          const projection = await readHtxV5(lease, reader!, signal);
          if (!projection || !(await active())) return { status: "FENCED" };
          htxV5 = projection;
        }
        dispose();
        if (!(await active())) return { status: "FENCED" };
        const ended = now();
        if (ended < started) invalid();
        const candidate = Object.freeze(
          htxV5
            ? {
                schemaVersion: "account-observation/v3" as const,
                ...common(ended, derivatives?.families ?? [], htxV5),
                ...(derivatives ? { derivatives } : {}),
                htxV5,
              }
            : derivatives
              ? {
                schemaVersion: "account-observation/v2" as const,
                ...common(ended, derivatives.families),
                derivatives,
                }
              : { schemaVersion: "account-observation/v1" as const, ...common(ended) },
        );
        parseAccountObservation(candidate);
        const observation: AccountObservation = candidate;
        // Bounded venue coverage remains PARTIAL, but is not a transport/collection failure.
        const failed =
          components.some((item) => item.status === "ERROR") ||
          (derivatives?.families.some(
            (item) =>
              item.status === "ERROR" ||
              item.positions?.status === "ERROR" ||
              item.executions?.status === "ERROR",
          ) ??
            false);
        const htxV5Failed = htxV5 ? [htxV5.assetMode, htxV5.balance, htxV5.positions,
          htxV5.openOrders, htxV5.algoOrders, htxV5.fills].some(component =>
          component.status === "ERROR" || component.error !== null) : false;
        const collectionFailed = failed || htxV5Failed;
        const failures = collectionFailed ? Math.min(lease.consecutiveFailures + 1, 30) : 0;
        const delay = !collectionFailed
          ? config.pollIntervalMs
          : Math.min(config.maxBackoffMs, config.pollIntervalMs * 2 ** failures);
        const nextDueAtMs = timestamp(ended + delay);
        if (signal?.aborted) return { status: "FENCED" };
        committed = await deps.repository.commitIfCurrent({
          lease,
          observation,
          nowMs: ended,
          nextDueAtMs,
          consecutiveFailures: failures,
        });
        return committed ? { status: "COMMITTED", observation, nextDueAtMs } : { status: "FENCED" };
      } catch (error) {
        primary =
          error instanceof AccountObservationFailure
            ? error
            : new AccountObservationFailure("ACCOUNT_OBSERVATION_INTERNAL_FAILURE");
        throw primary;
      } finally {
        let cleanup: AccountObservationFailure | undefined;
        try {
          dispose();
        } catch {
          cleanup = new AccountObservationFailure("ACCOUNT_OBSERVATION_DISPOSAL_FAILED");
        }
        // Successful commit atomically released its token; do not invent a second release obligation.
        if (!committed && releaseClaim)
          try {
            // Even a malformed claim response cannot redirect cleanup into another scope/owner.
            await deps.repository.release(releaseClaim);
          } catch {
            if (cleanup) cleanup.secondary.push("ACCOUNT_OBSERVATION_RELEASE_FAILED");
            else cleanup = new AccountObservationFailure("ACCOUNT_OBSERVATION_RELEASE_FAILED");
          }
        if (cleanup && primary) primary.secondary.push(cleanup.code, ...cleanup.secondary);
        else if (cleanup) throw cleanup;
      }
    },
  });
}
