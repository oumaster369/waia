import { z } from "zod";
import { HTX_DERIVATIVES_ACCOUNT_FAMILIES } from "./derivatives/types";
import type {
  AccountObservation,
  ObservationBinding,
  DerivativesAccountFamilyObservation,
  HtxV5AccountObservation,
} from "./types";

const text = z.string().min(1).max(256);
const time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const decimal = text.regex(/^\d+(?:\.\d+)?$/);
const dateText = text.refine((value) => Number.isFinite(Date.parse(value)));
export const observationBindingSchema = z
  .object({
    organizationId: z.string().uuid(),
    credentialId: z.string().uuid(),
    exchangeAccountId: text,
    credentialRevision: text.regex(/^[1-9]\d*$/),
    configurationRevision: text,
  })
  .strict();
const balance = z.object({ asset: text, free: decimal, locked: decimal, total: decimal }).strict();
const order = z
  .object({
    orderId: text,
    clientOrderId: z.string().max(256),
    symbol: text,
    side: z.enum(["buy", "sell"]),
    type: z.enum(["limit", "market"]),
    status: z.enum(["open", "partially_filled"]),
    price: decimal.optional(),
    quantity: decimal,
    filledQuantity: decimal,
    createdAt: dateText,
    updatedAt: dateText.nullable(),
  })
  .strict();
const trade = z
  .object({
    tradeId: text,
    orderId: text,
    clientOrderId: z.string().max(256),
    symbol: text,
    side: z.enum(["buy", "sell"]),
    price: decimal,
    quantity: decimal,
    fee: decimal,
    feeAsset: text,
    executedAt: dateText,
  })
  .strict();
const error = z.enum([
  "TIMEOUT",
  "RATE_LIMITED",
  "PERMISSION_DENIED",
  "READ_FAILED",
  "INVALID_RESPONSE",
  "IDENTITY_MISMATCH",
]);
const v5Decimal = z.string().min(1).max(80).regex(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/);
const v5UnsignedDecimal = z.string().min(1).max(80).regex(/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/);
const v5Timestamp = time.nullable();
const v5Contract = z.string().regex(/^[A-Z0-9]+-USDT(?:-\d{6})?$/);
const v5Identifier = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const v5PositionSide = z.enum(["long", "short", "both"]);
const v5Side = z.enum(["buy", "sell"]);
const v5MarginMode = z.enum(["cross", "isolated"]);
const v5ComponentStatus = z.enum(["NOT_CONFIGURED", "COMPLETE", "PARTIAL", "ERROR"]);
const v5ReadTimes = {
  readStartedAtMs: time.nullable(),
  readCompletedAtMs: time.nullable(),
  responseGeneratedAtMs: time.nullable(),
  error: error.nullable(),
};
const v5ValueObservation = <T extends z.ZodTypeAny>(value: T) => z.object({
  status: z.enum(["COMPLETE", "ERROR"]), value: value.nullable(), ...v5ReadTimes,
}).strict().refine(c => c.readStartedAtMs !== null && c.readCompletedAtMs !== null &&
  c.readStartedAtMs <= c.readCompletedAtMs &&
  (c.responseGeneratedAtMs === null || c.responseGeneratedAtMs <= c.readCompletedAtMs) &&
  (c.status === "ERROR" ? c.value === null && c.error !== null : c.value !== null && c.error === null));
const v5PageScope = z.object({ pageSize: z.number().int().min(1).max(100),
  maxPages: z.number().int().min(1).max(2), pagesRead: z.number().int().min(1).max(2),
  nextFrom: z.string().regex(/^(?:0|[1-9]\d{0,18})$/).nullable(), completeness: z.literal("UNKNOWN") }).strict();
const v5RowsObservation = <T extends z.ZodTypeAny>(value: T, paginated: boolean) => z.object({
  status: z.enum(["COMPLETE", "PARTIAL", "ERROR"]), values: z.array(value).max(200).nullable(),
  ...v5ReadTimes, pageScope: paginated ? v5PageScope.nullable() : z.null(),
}).strict().refine(c => c.status === "ERROR"
  ? c.values === null && c.error !== null && c.readStartedAtMs !== null && c.readCompletedAtMs !== null
  : c.values !== null && (c.status === "COMPLETE" ? c.error === null : true) &&
    c.readStartedAtMs !== null && c.readCompletedAtMs !== null &&
    (c.status === "PARTIAL" ? c.pageScope !== null : c.error === null))
  .refine(c => !paginated || c.status === "ERROR" || (c.status === "PARTIAL" && c.pageScope !== null));
const v5BalanceDetail = z.object({
  currency: z.string().regex(/^[A-Z0-9]{2,16}$/), equity: v5Decimal,
  isolatedEquity: v5Decimal, available: v5Decimal, isolatedAvailable: v5Decimal,
  withdrawAvailable: v5Decimal, profitUnreal: v5Decimal, isolatedProfitUnreal: v5Decimal,
  initialMargin: v5Decimal, maintenanceMargin: v5Decimal, maintenanceMarginRate: v5Decimal,
  initialMarginRate: v5Decimal, voucher: v5Decimal, voucherValue: v5Decimal,
  createdTimeMs: v5Timestamp, updatedTimeMs: v5Timestamp,
}).strict();
const v5Balance = z.object({
  state: z.enum(["normal", "liquidating", "adl", "open_limit"]),
  account: z.object({ equityUsd: v5Decimal, initialMarginUsd: v5Decimal,
    maintenanceMarginUsd: v5Decimal, maintenanceMarginRate: v5Decimal, profitUnrealUsd: v5Decimal,
    availableMarginUsd: v5Decimal, voucherValue: v5Decimal, createdTimeMs: v5Timestamp,
    updatedTimeMs: v5Timestamp }).strict(),
  details: z.array(v5BalanceDetail).max(100),
}).strict().refine(v => new Set(v.details.map(row => row.currency)).size === v.details.length);
const v5Position = z.object({ contractCode: v5Contract, positionSide: v5PositionSide,
  direction: v5Side, marginMode: v5MarginMode, volume: v5UnsignedDecimal,
  available: v5UnsignedDecimal, openAveragePrice: v5Decimal, liquidationPrice: v5Decimal.nullable(),
  initialMargin: v5Decimal.nullable(), maintenanceMargin: v5Decimal, margin: v5Decimal,
  profitUnreal: v5Decimal, profitRate: v5Decimal, marginRate: v5Decimal,
  marginCurrency: z.string().min(1).max(256), lastPrice: v5Decimal, markPrice: v5Decimal,
  contractType: z.string().min(1).max(256), createdTimeMs: v5Timestamp,
  updatedTimeMs: v5Timestamp }).strict();
const v5OpenOrder = z.object({ id: z.string().regex(/^(?:0|[1-9]\d{0,18})$/), orderId: v5Identifier,
  contractCode: v5Contract, clientOrderId: v5Identifier.nullable(), side: v5Side,
  positionSide: v5PositionSide, marginMode: v5MarginMode, volume: v5UnsignedDecimal,
  state: z.enum(["new", "partially_filled", "filled", "partially_canceled", "canceled"]),
  reduceOnly: z.boolean().nullable(), tpTriggerPrice: v5Decimal.nullable(),
  slTriggerPrice: v5Decimal.nullable(), createdTimeMs: v5Timestamp, updatedTimeMs: v5Timestamp }).strict();
const v5AlgoOrder = z.object({ id: z.string().regex(/^(?:0|[1-9]\d{0,18})$/), algoId: v5Identifier,
  contractCode: v5Contract, volume: v5UnsignedDecimal,
  type: z.enum(["tp", "sl", "tpsl", "trigger", "trailing_stop"]), state: z.literal("active"),
  positionSide: v5PositionSide, side: v5Side, marginMode: v5MarginMode,
  tpTriggerPrice: v5Decimal.nullable(), slTriggerPrice: v5Decimal.nullable(),
  reduceOnly: z.boolean().nullable(), createdTimeMs: v5Timestamp, updatedTimeMs: v5Timestamp }).strict();
const v5Fill = z.object({ id: z.string().regex(/^(?:0|[1-9]\d{0,18})$/), tradeId: v5Identifier,
  orderId: v5Identifier, contractCode: v5Contract, side: v5Side, positionSide: v5PositionSide,
  orderType: z.enum(["1", "3", "4", "22"]), marginMode: v5MarginMode,
  tradePrice: v5UnsignedDecimal, tradeVolume: v5UnsignedDecimal, tradeTurnover: v5UnsignedDecimal,
  tradeFee: v5Decimal, feeCurrency: z.string().min(1).max(256), profit: v5Decimal,
  createdTimeMs: v5Timestamp, updatedTimeMs: v5Timestamp }).strict();
const v5AlgoPageScope = z.object({ pageSize: z.number().int().min(1).max(20),
  maxPagesPerType: z.number().int().min(1).max(2),
  queries: z.array(z.object({ type: z.enum(["tp", "sl", "tpsl", "trigger", "trailing_stop"]),
    pagesRead: z.number().int().min(1).max(2), nextFrom: z.string().regex(/^(?:0|[1-9]\d{0,18})$/).nullable() }).strict()).length(5),
  completeness: z.literal("UNKNOWN") }).strict()
  .refine(scope => new Set(scope.queries.map(query => query.type)).size === 5 &&
    scope.queries.every(query => query.pagesRead <= scope.maxPagesPerType));
const v5FillPageScope = z.object({ pageSize: z.number().int().min(1).max(100),
  maxPagesPerContract: z.number().int().min(1).max(2),
  queries: z.array(z.object({ contractCode: v5Contract, pagesRead: z.number().int().min(1).max(2),
    nextFrom: z.string().regex(/^(?:0|[1-9]\d{0,18})$/).nullable() }).strict()).max(8),
  completeness: z.literal("UNKNOWN") }).strict()
  .refine(scope => scope.queries.every(query => query.pagesRead <= scope.maxPagesPerContract));
const htxV5 = z.object({
  schemaVersion: z.literal("htx-v5-observation/v1"), htxUid: z.string().regex(/^[1-9]\d{0,38}$/).nullable(),
  assetMode: v5ValueObservation(z.enum(["0", "1", "2"])),
  balance: v5ValueObservation(v5Balance),
  positions: v5RowsObservation(v5Position, false),
  openOrders: v5RowsObservation(v5OpenOrder, true),
  algoOrders: z.object({ status: z.enum(["PARTIAL", "ERROR"]), values: z.array(v5AlgoOrder).max(200).nullable(),
    ...v5ReadTimes, pageScope: v5AlgoPageScope.nullable() }).strict().refine(c =>
      c.readStartedAtMs !== null && c.readCompletedAtMs !== null &&
      c.readStartedAtMs <= c.readCompletedAtMs && (c.responseGeneratedAtMs === null ||
        c.responseGeneratedAtMs <= c.readCompletedAtMs) &&
      (c.status === "ERROR" ? c.values === null && c.error !== null : c.values !== null && c.pageScope !== null)),
  fills: z.object({ status: v5ComponentStatus, values: z.array(v5Fill).max(800).nullable(),
    ...v5ReadTimes, coverage: z.enum(["NOT_CONFIGURED", "CONFIGURED_CONTRACTS_AND_WINDOW"]),
    contracts: z.array(v5Contract).max(8), windowStartMs: time.nullable(), windowEndMs: time.nullable(),
    pageScope: v5FillPageScope.nullable() }).strict().refine(c => c.status === "NOT_CONFIGURED"
      ? c.coverage === "NOT_CONFIGURED" && c.values === null && c.readStartedAtMs === null &&
        c.readCompletedAtMs === null && c.responseGeneratedAtMs === null && c.error === null &&
        c.contracts.length === 0 && c.windowStartMs === null && c.windowEndMs === null && c.pageScope === null
      : c.coverage === "CONFIGURED_CONTRACTS_AND_WINDOW" && c.contracts.length > 0 &&
        c.readStartedAtMs !== null && c.readCompletedAtMs !== null && c.readStartedAtMs <= c.readCompletedAtMs &&
        (c.responseGeneratedAtMs === null || c.responseGeneratedAtMs <= c.readCompletedAtMs) &&
        (c.status === "ERROR" ? c.values === null && c.error !== null && c.pageScope === null &&
          ((c.windowStartMs === null && c.windowEndMs === null) ||
            (c.windowStartMs !== null && c.windowEndMs !== null && c.windowStartMs < c.windowEndMs)) :
          c.status === "PARTIAL" && c.values !== null && c.error === null && c.pageScope !== null &&
            c.windowStartMs !== null && c.windowEndMs !== null && c.windowStartMs < c.windowEndMs)),
}).strict().refine(v => v.htxUid === null || v.htxUid.length > 0);
function component<T extends z.ZodTypeAny>(item: T) {
  return z
    .object({
      status: z.enum(["COMPLETE", "PARTIAL", "ERROR"]),
      values: z.array(item).max(10000).nullable(),
      sourceAsOfMs: time.nullable(),
      readStartedAtMs: time,
      readCompletedAtMs: time,
      error: error.nullable(),
    })
    .strict()
    .refine(
      (c) =>
        c.readStartedAtMs <= c.readCompletedAtMs &&
        (c.sourceAsOfMs === null || c.sourceAsOfMs <= c.readCompletedAtMs) &&
        (c.status === "ERROR"
          ? c.values === null && c.error !== null
          : c.values !== null && c.error === null),
    );
}
const derivativeAccount = z
  .object({
    accountCode: text.regex(/^[A-Z0-9_-]{1,64}$/),
    collateralAsset: z
      .string()
      .regex(/^[A-Z0-9]{1,16}$/)
      .nullable(),
    marginMode: z.enum(["isolated", "cross"]).nullable(),
    marginBalance: z
      .string()
      .regex(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/)
      .max(80)
      .nullable(),
    marginAvailable: z
      .string()
      .regex(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/)
      .max(80)
      .nullable(),
    withdrawAvailable: z
      .string()
      .regex(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/)
      .max(80)
      .nullable(),
    marginPosition: z
      .string()
      .regex(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/)
      .max(80)
      .nullable(),
    marginFrozen: z
      .string()
      .regex(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/)
      .max(80)
      .nullable(),
    marginStatic: z
      .string()
      .regex(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/)
      .max(80)
      .nullable(),
    realizedPnl: z
      .string()
      .regex(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/)
      .max(80)
      .nullable(),
    unrealizedPnl: z
      .string()
      .regex(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/)
      .max(80)
      .nullable(),
    riskRate: z
      .string()
      .regex(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/)
      .max(80)
      .nullable(),
    liquidationPrice: z
      .string()
      .regex(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/)
      .max(80)
      .nullable(),
    leverage: z
      .string()
      .regex(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/)
      .max(80)
      .nullable(),
  })
  .strict();
const positionDecimal = z
  .string()
  .regex(/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/)
  .max(80)
  .nullable();
const signedPositionDecimal = z
  .string()
  .regex(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/)
  .max(80)
  .nullable();
const derivativePosition = z
  .object({
    symbol: text.regex(/^[A-Z0-9_-]{1,64}$/),
    contractCode: text.regex(/^[A-Z0-9_-]{1,64}$/),
    contractType: z
      .string()
      .regex(/^[a-z0-9_-]{1,32}$/)
      .nullable(),
    direction: z.enum(["buy", "sell"]),
    volume: positionDecimal,
    available: positionDecimal,
    frozen: positionDecimal,
    costOpen: positionDecimal,
    costHold: positionDecimal,
    unrealizedPnl: signedPositionDecimal,
    profitRate: signedPositionDecimal,
    positionMargin: positionDecimal,
    marginAsset: z
      .string()
      .regex(/^[A-Z0-9]{1,16}$/)
      .nullable(),
    leverage: positionDecimal,
    lastPrice: positionDecimal,
    liquidationPrice: positionDecimal,
  })
  .strict();
const derivativePositions = z
  .object({
    status: z.enum(["COMPLETE", "PARTIAL", "ERROR"]),
    values: z.array(derivativePosition).max(100).nullable(),
    readStartedAtMs: time,
    readCompletedAtMs: time,
    responseGeneratedAtMs: time.nullable(),
    error: error.nullable(),
  })
  .strict()
  .refine(
    (value) =>
      value.readStartedAtMs <= value.readCompletedAtMs &&
      (value.responseGeneratedAtMs === null ||
        value.responseGeneratedAtMs <= value.readCompletedAtMs) &&
      (value.status === "ERROR"
        ? value.values === null && value.error !== null
        : value.values !== null && value.error === null),
  );
const derivativeFill = z
  .object({
    id: text.regex(/^[A-Za-z0-9_-]{1,128}$/),
    matchId: z
      .string()
      .regex(/^\d{1,40}$/)
      .nullable(),
    orderId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .nullable(),
    symbol: text.regex(/^[A-Z0-9_-]{1,64}$/),
    contractCode: text.regex(/^[A-Z0-9_-]{1,64}$/),
    contractType: z
      .string()
      .regex(/^[a-z0-9_-]{1,32}$/)
      .nullable(),
    direction: z.enum(["buy", "sell"]),
    offset: z.enum(["open", "close", "both"]),
    volume: positionDecimal,
    price: positionDecimal,
    fee: signedPositionDecimal,
    feeAsset: z
      .string()
      .regex(/^[A-Z0-9]{1,16}$/)
      .nullable(),
    realizedPnl: signedPositionDecimal,
    offsetPnl: signedPositionDecimal,
    executedAtMs: time.nullable(),
    orderSource: z
      .string()
      .regex(/^[a-z0-9_-]{1,32}$/)
      .nullable(),
  })
  .strict();
const derivativeExecutions = z
  .object({
    status: z.enum(["NOT_CONFIGURED", "COMPLETE", "PARTIAL", "ERROR"]),
    coverage: z.enum(["CONFIGURED_CONTRACTS", "NOT_CONFIGURED"]),
    values: z.array(derivativeFill).max(100).nullable(),
    contracts: z.array(z.string().regex(/^[A-Z0-9_-]{1,64}$/)).max(8),
    readStartedAtMs: time,
    readCompletedAtMs: time,
    responseGeneratedAtMs: time.nullable(),
    windowStartMs: time.nullable(),
    windowEndMs: time.nullable(),
    error: error.nullable(),
  })
  .strict()
  .refine(
    (value) =>
      value.readStartedAtMs <= value.readCompletedAtMs &&
      (value.responseGeneratedAtMs === null ||
        value.responseGeneratedAtMs <= value.readCompletedAtMs) &&
      (value.status === "NOT_CONFIGURED"
        ? value.coverage === "NOT_CONFIGURED" &&
          value.values === null &&
          value.error === null &&
          value.contracts.length === 0 &&
          value.windowStartMs === null &&
          value.windowEndMs === null
        : value.coverage === "CONFIGURED_CONTRACTS" &&
          ((value.windowStartMs === null && value.windowEndMs === null) ||
            (value.windowStartMs !== null &&
              value.windowEndMs !== null &&
              value.windowStartMs < value.windowEndMs &&
              value.windowEndMs <= value.readCompletedAtMs &&
              value.windowEndMs - value.windowStartMs <= 86_400_000))) &&
      (value.status === "ERROR"
        ? value.values === null && value.error !== null
        : value.status === "NOT_CONFIGURED"
          ? true
          : value.values !== null && value.error === null),
  );
const derivativeFamily = z
  .object({
    family: z.enum(HTX_DERIVATIVES_ACCOUNT_FAMILIES),
    status: z.enum(["NOT_CONFIGURED", "COMPLETE", "PARTIAL", "ERROR"]),
    accounts: z.array(derivativeAccount).max(100).nullable(),
    readStartedAtMs: time.nullable(),
    readCompletedAtMs: time.nullable(),
    responseGeneratedAtMs: time.nullable(),
    error: error.nullable(),
    positions: derivativePositions.optional(),
    executions: derivativeExecutions.optional(),
  })
  .strict();
const derivatives = z
  .object({
    schemaVersion: z.literal("htx-derivatives-observation/v1"),
    families: z.array(derivativeFamily).length(HTX_DERIVATIVES_ACCOUNT_FAMILIES.length),
  })
  .strict();
const observationFields = z.object({
  observationId: z.string().uuid(),
  binding: observationBindingSchema,
  collectionStartedAtMs: time,
  collectionCompletedAtMs: time,
  status: z.enum(["COMPLETE", "PARTIAL", "ERROR"]),
  balances: component(balance),
  openOrders: component(order),
  trades: z
    .array(
      z.object({ symbol: text.regex(/^[A-Z0-9]{2,32}$/), component: component(trade) }).strict(),
    )
    .min(1)
    .max(32),
  holdings: z.array(balance).max(10000).nullable(),
});
const observation = z.discriminatedUnion("schemaVersion", [
  observationFields.extend({ schemaVersion: z.literal("account-observation/v1") }).strict(),
  observationFields
    .extend({ schemaVersion: z.literal("account-observation/v2"), derivatives })
    .strict(),
  observationFields
    .extend({ schemaVersion: z.literal("account-observation/v3"), htxV5: htxV5, derivatives: derivatives.optional() })
    .strict(),
]);
export function sameObservationBinding(a: ObservationBinding, b: ObservationBinding) {
  return (
    a.organizationId === b.organizationId &&
    a.credentialId === b.credentialId &&
    a.exchangeAccountId === b.exchangeAccountId &&
    a.credentialRevision === b.credentialRevision &&
    a.configurationRevision === b.configurationRevision
  );
}
/** Strict allowlist: stored/read payloads cannot acquire raw responses or credentials. */
export type AccountObservationComponentStatus = "COMPLETE" | "PARTIAL" | "ERROR";

/** Aggregate collected components only; NOT_CONFIGURED derivative families are omitted by callers. */
export function deriveAccountObservationStatus(
  statuses: readonly AccountObservationComponentStatus[],
): AccountObservationComponentStatus {
  return statuses.every((status) => status === "COMPLETE")
    ? "COMPLETE"
    : statuses.every((status) => status === "ERROR")
      ? "ERROR"
      : "PARTIAL";
}

export function parseAccountObservation(value: unknown): AccountObservation {
  const result = observation.parse(value);
  const components = [result.balances, result.openOrders, ...result.trades.map((t) => t.component)];
  const derivativeProjection = result.schemaVersion === "account-observation/v2" || result.schemaVersion === "account-observation/v3"
    ? result.derivatives : undefined;
  const derivativeStatuses = derivativeProjection
      ? derivativeProjection.families.flatMap((item) =>
          item.status === "NOT_CONFIGURED"
            ? []
            : [
                item.status,
                ...(item.positions ? [item.positions.status] : []),
                ...(item.executions && item.executions.status !== "NOT_CONFIGURED"
                  ? [item.executions.status]
                  : []),
              ],
        )
      : [];
  const v5Statuses = result.schemaVersion === "account-observation/v3"
    ? [result.htxV5.assetMode.status, result.htxV5.balance.status, result.htxV5.positions.status,
      result.htxV5.openOrders.status, result.htxV5.algoOrders.status, result.htxV5.fills.status]
      .filter((status): status is Exclude<typeof status, "NOT_CONFIGURED"> => status !== "NOT_CONFIGURED")
    : [];
  const status = deriveAccountObservationStatus([
    ...components.map((component) => component.status),
    ...derivativeStatuses,
    ...v5Statuses,
  ]);
  if (
    result.collectionStartedAtMs > result.collectionCompletedAtMs ||
    status !== result.status ||
    components.some(
      (c) =>
        c.readStartedAtMs < result.collectionStartedAtMs ||
        c.readCompletedAtMs > result.collectionCompletedAtMs,
    ) ||
    new Set(result.trades.map((t) => t.symbol)).size !== result.trades.length ||
    result.trades.some((t) => t.component.values?.some((v) => v.symbol !== t.symbol)) ||
    JSON.stringify(result.holdings) !==
      JSON.stringify(result.balances.status === "COMPLETE" ? result.balances.values : null)
  ) {
    throw new Error("ACCOUNT_OBSERVATION_INVALID_PAYLOAD");
  }
  if (derivativeProjection)
    validateDerivativesProjection(
      derivativeProjection.families,
      result.collectionStartedAtMs,
      result.collectionCompletedAtMs,
    );
  if (result.schemaVersion === "account-observation/v3")
    validateHtxV5Projection(result.htxV5, result.collectionStartedAtMs, result.collectionCompletedAtMs);
  return result as AccountObservation;
}

function validateHtxV5Projection(
  projection: HtxV5AccountObservation,
  collectionStartedAtMs: number,
  collectionCompletedAtMs: number,
): void {
  const components = [projection.assetMode, projection.balance, projection.positions,
    projection.openOrders, projection.algoOrders,
    ...(projection.fills.status === "NOT_CONFIGURED" ? [] : [projection.fills])];
  let successful = false;
  for (const component of components) {
    if (component.status === "ERROR") {
      if (component.error === null) throw new Error("ACCOUNT_OBSERVATION_INVALID_PAYLOAD");
    } else if (component.status !== "NOT_CONFIGURED") {
      successful = true;
      if (component.status === "COMPLETE" && component.error !== null)
        throw new Error("ACCOUNT_OBSERVATION_INVALID_PAYLOAD");
    }
    if (component.readStartedAtMs === null || component.readCompletedAtMs === null ||
      component.readStartedAtMs > component.readCompletedAtMs ||
      component.readStartedAtMs < collectionStartedAtMs ||
      component.readCompletedAtMs > collectionCompletedAtMs ||
      (component.responseGeneratedAtMs !== null && component.responseGeneratedAtMs > component.readCompletedAtMs))
      throw new Error("ACCOUNT_OBSERVATION_INVALID_PAYLOAD");
  }
  if ((successful && projection.htxUid === null) || (!successful && projection.htxUid !== null))
    throw new Error("ACCOUNT_OBSERVATION_INVALID_PAYLOAD");
  const checkUnique = <T>(values: readonly T[] | null, key: (row: T) => string) => {
    if (values && new Set(values.map(key)).size !== values.length) throw new Error("ACCOUNT_OBSERVATION_INVALID_PAYLOAD");
  };
  checkUnique(projection.positions.values, row => `${row.contractCode}\0${row.marginMode}\0${row.positionSide}`);
  checkUnique(projection.openOrders.values, row => row.id);
  checkUnique(projection.algoOrders.values, row => `${row.type}\0${row.id}`);
  checkUnique(projection.fills.values, row => `${row.contractCode}\0${row.id}`);
  if (projection.openOrders.pageScope && (projection.openOrders.pageScope.pagesRead > projection.openOrders.pageScope.maxPages ||
    (projection.openOrders.values?.length ?? 0) > projection.openOrders.pageScope.pageSize * projection.openOrders.pageScope.pagesRead))
    throw new Error("ACCOUNT_OBSERVATION_INVALID_PAYLOAD");
  if (projection.algoOrders.pageScope && (projection.algoOrders.pageScope.queries.length !== 5 ||
    projection.algoOrders.pageScope.queries.some(query => (projection.algoOrders.values ?? [])
      .filter(row => row.type === query.type).length > projection.algoOrders.pageScope!.pageSize * query.pagesRead)))
    throw new Error("ACCOUNT_OBSERVATION_INVALID_PAYLOAD");
  const fill = projection.fills;
  if (fill.status === "NOT_CONFIGURED") return;
  const fillPageScope = fill.pageScope;
  const invalidWindowPair = (fill.windowStartMs === null) !== (fill.windowEndMs === null);
  const invalidKnownWindow = fill.windowStartMs !== null && fill.windowEndMs !== null &&
    (fill.windowEndMs - fill.windowStartMs > 48 * 60 * 60 * 1000 || fill.windowStartMs >= fill.windowEndMs);
  const invalidFillScope = fillPageScope !== null && (fillPageScope.queries.length !== fill.contracts.length ||
    fillPageScope.queries.some((query, index) => query.contractCode !== fill.contracts[index] ||
      (fill.values ?? []).filter(row => row.contractCode === query.contractCode).length >
        fillPageScope.pageSize * query.pagesRead));
  const invalidFillValue = fill.values !== null && fill.values.some(row => !fill.contracts.includes(row.contractCode) ||
    (fill.windowStartMs !== null && fill.windowEndMs !== null && row.createdTimeMs !== null &&
      (row.createdTimeMs < fill.windowStartMs || row.createdTimeMs > fill.windowEndMs)));
  if (fill.contracts.length === 0 || new Set(fill.contracts).size !== fill.contracts.length ||
    invalidWindowPair || invalidKnownWindow ||
    (fill.status === "PARTIAL" && (fill.windowStartMs === null || fill.windowEndMs === null)) ||
    (fill.status === "ERROR" ? fillPageScope !== null : !fillPageScope) || invalidFillScope || invalidFillValue)
    throw new Error("ACCOUNT_OBSERVATION_INVALID_PAYLOAD");
}

function validateDerivativesProjection(
  families: readonly DerivativesAccountFamilyObservation[],
  collectionStartedAtMs: number,
  collectionCompletedAtMs: number,
): void {
  const byFamily = new Map(families.map((item) => [item.family, item]));
  const valid =
    byFamily.size === HTX_DERIVATIVES_ACCOUNT_FAMILIES.length &&
    HTX_DERIVATIVES_ACCOUNT_FAMILIES.every((family) => byFamily.has(family));
  if (!valid) throw new Error("ACCOUNT_OBSERVATION_INVALID_PAYLOAD");
  for (const item of families) {
    const notConfigured = item.status === "NOT_CONFIGURED";
    if (notConfigured) {
      if (
        item.accounts !== null ||
        item.readStartedAtMs !== null ||
        item.readCompletedAtMs !== null ||
        item.responseGeneratedAtMs !== null ||
        item.error !== null ||
        item.positions !== undefined ||
        item.executions !== undefined
      ) {
        throw new Error("ACCOUNT_OBSERVATION_INVALID_PAYLOAD");
      }
      continue;
    }
    if (
      item.readStartedAtMs === null ||
      item.readCompletedAtMs === null ||
      item.readStartedAtMs > item.readCompletedAtMs ||
      item.readStartedAtMs < collectionStartedAtMs ||
      item.readCompletedAtMs > collectionCompletedAtMs ||
      (item.responseGeneratedAtMs !== null &&
        item.responseGeneratedAtMs > item.readCompletedAtMs) ||
      (item.status === "ERROR"
        ? item.accounts !== null || item.error === null
        : item.accounts === null || item.error !== null)
    ) {
      throw new Error("ACCOUNT_OBSERVATION_INVALID_PAYLOAD");
    }
    const rows = item.accounts ?? [];
    const missingRequiredBalance =
      item.status === "COMPLETE" &&
      rows.some(
        (row) =>
          row.marginBalance === null ||
          (item.family === "usdt_cross_shared"
            ? row.withdrawAvailable == null
            : row.marginAvailable === null),
      );
    const positions = item.positions;
    const invalidPositions =
      positions !== undefined &&
      (positions.readStartedAtMs < collectionStartedAtMs ||
        positions.readCompletedAtMs > collectionCompletedAtMs ||
        (positions.responseGeneratedAtMs !== null &&
          positions.responseGeneratedAtMs > positions.readCompletedAtMs) ||
        (positions.status === "ERROR"
          ? positions.values !== null || positions.error === null
          : positions.values === null || positions.error !== null) ||
        (positions.status === "COMPLETE" &&
          positions.values?.some(
            (row) =>
              row.volume === null ||
              row.available === null ||
              row.frozen === null ||
              row.costOpen === null ||
              row.costHold === null ||
              row.unrealizedPnl === null ||
              row.positionMargin === null ||
              row.leverage === null,
          )) ||
        (positions.values !== null &&
          (new Set(positions.values.map((row) => `${row.contractCode}\u0000${row.direction}`))
            .size !== positions.values.length ||
            positions.values.some((row) => {
              if (item.family === "usdt_isolated_perpetual")
                return row.marginAsset !== "USDT" || row.contractCode !== `${row.symbol}-USDT`;
              if (item.family === "usdt_cross_shared")
                return (
                  row.marginAsset !== "USDT" ||
                  !row.contractCode.startsWith(`${row.symbol}-USDT`) ||
                  !/^[A-Z0-9]+-USDT(?:-\d{6})?$/.test(row.contractCode)
                );
              if (item.family === "coin_perpetual")
                return row.marginAsset !== row.symbol || row.contractCode !== `${row.symbol}-USD`;
              return (
                row.marginAsset !== row.symbol ||
                !new RegExp(`^${row.symbol}\\d{6}$`).test(row.contractCode)
              );
            }))));
    const executions = item.executions;
    const contractShape = (contract: string) => {
      if (item.family === "usdt_isolated_perpetual")
        return contract === contract.replace(/-\d{6}$/, "") && /^[A-Z0-9]+-USDT$/.test(contract);
      if (item.family === "usdt_cross_shared") return /^[A-Z0-9]+-USDT(?:-\d{6})?$/.test(contract);
      if (item.family === "coin_perpetual") return /^[A-Z0-9]+-USD$/.test(contract);
      return /^[A-Z0-9]+\d{6}$/.test(contract);
    };
    const invalidExecutions =
      executions !== undefined &&
      (executions.readStartedAtMs < collectionStartedAtMs ||
        executions.readCompletedAtMs > collectionCompletedAtMs ||
        (executions.status === "COMPLETE" &&
          (executions.values?.some(
            (row) =>
              row.volume === null ||
              row.price === null ||
              row.fee === null ||
              row.feeAsset === null ||
              row.executedAtMs === null,
          ) ||
            executions.contracts.length === 0 ||
            executions.windowStartMs === null)) ||
        (executions.values !== null &&
          (new Set(executions.values.map((row) => row.id)).size !== executions.values.length ||
            executions.values.some(
              (row) =>
                !executions.contracts.includes(row.contractCode) ||
                !contractShape(row.contractCode) ||
                (executions.windowStartMs !== null &&
                  executions.windowEndMs !== null &&
                  row.executedAtMs !== null &&
                  (row.executedAtMs < executions.windowStartMs ||
                    row.executedAtMs > executions.windowEndMs)) ||
                (item.family.startsWith("usdt_")
                  ? !row.contractCode.startsWith(`${row.symbol}-`)
                  : item.family === "coin_perpetual"
                    ? row.contractCode !== `${row.symbol}-USD`
                    : !new RegExp(`^${row.symbol}\\d{6}$`).test(row.contractCode)),
            ))) ||
        executions.contracts.some((contract) => !contractShape(contract)));
    if (
      missingRequiredBalance ||
      invalidPositions ||
      invalidExecutions ||
      new Set(rows.map((row) => row.accountCode)).size !== rows.length ||
      rows.some((row) => {
        if (item.family === "usdt_cross_shared") {
          return (
            row.accountCode !== "USDT" ||
            row.collateralAsset !== "USDT" ||
            (row.marginMode !== null && row.marginMode !== "cross")
          );
        }
        if (item.family === "usdt_isolated_perpetual") {
          return (
            row.collateralAsset !== "USDT" ||
            !row.accountCode.endsWith("-USDT") ||
            (row.marginMode !== null && row.marginMode !== "isolated")
          );
        }
        if (item.family === "coin_perpetual") {
          return (
            !row.accountCode.endsWith("-USD") ||
            !row.collateralAsset ||
            !row.accountCode.startsWith(`${row.collateralAsset}-`)
          );
        }
        return !row.collateralAsset || row.accountCode !== row.collateralAsset;
      })
    )
      throw new Error("ACCOUNT_OBSERVATION_INVALID_PAYLOAD");
  }
}
