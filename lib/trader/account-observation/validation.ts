import { z } from "zod";
import { HTX_DERIVATIVES_ACCOUNT_FAMILIES } from "./derivatives/types";
import type { AccountObservation, ObservationBinding, DerivativesAccountFamilyObservation } from "./types";

const text = z.string().min(1).max(256);
const time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const decimal = text.regex(/^\d+(?:\.\d+)?$/);
const dateText = text.refine(value => Number.isFinite(Date.parse(value)));
export const observationBindingSchema = z.object({
  organizationId: z.string().uuid(), credentialId: z.string().uuid(),
  exchangeAccountId: text, credentialRevision: text.regex(/^[1-9]\d*$/),
  configurationRevision: text,
}).strict();
const balance = z.object({ asset: text, free: decimal, locked: decimal, total: decimal }).strict();
const order = z.object({
  orderId: text, clientOrderId: z.string().max(256), symbol: text,
  side: z.enum(["buy", "sell"]), type: z.enum(["limit", "market"]),
  status: z.enum(["open", "partially_filled"]), price: decimal.optional(),
  quantity: decimal, filledQuantity: decimal, createdAt: dateText, updatedAt: dateText.nullable(),
}).strict();
const trade = z.object({
  tradeId: text, orderId: text, clientOrderId: z.string().max(256), symbol: text,
  side: z.enum(["buy", "sell"]), price: decimal, quantity: decimal,
  fee: decimal, feeAsset: text, executedAt: dateText,
}).strict();
const error = z.enum(["TIMEOUT", "RATE_LIMITED", "PERMISSION_DENIED", "READ_FAILED",
  "INVALID_RESPONSE", "IDENTITY_MISMATCH"]);
function component<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    status: z.enum(["COMPLETE", "PARTIAL", "ERROR"]),
    values: z.array(item).max(10000).nullable(), sourceAsOfMs: time.nullable(),
    readStartedAtMs: time, readCompletedAtMs: time, error: error.nullable(),
  }).strict().refine(c => c.readStartedAtMs <= c.readCompletedAtMs &&
    (c.sourceAsOfMs === null || c.sourceAsOfMs <= c.readCompletedAtMs) &&
    (c.status === "ERROR" ? c.values === null && c.error !== null :
      c.values !== null && c.error === null));
}
const derivativeAccount = z.object({
  accountCode: text.regex(/^[A-Z0-9_-]{1,64}$/),
  collateralAsset: z.string().regex(/^[A-Z0-9]{1,16}$/).nullable(),
  marginMode: z.enum(["isolated", "cross"]).nullable(),
  marginBalance: z.string().regex(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/).max(80).nullable(),
  marginAvailable: z.string().regex(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/).max(80).nullable(),
  withdrawAvailable: z.string().regex(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/).max(80).nullable(),
  marginPosition: z.string().regex(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/).max(80).nullable(),
  marginFrozen: z.string().regex(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/).max(80).nullable(),
  marginStatic: z.string().regex(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/).max(80).nullable(),
  realizedPnl: z.string().regex(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/).max(80).nullable(),
  unrealizedPnl: z.string().regex(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/).max(80).nullable(),
  riskRate: z.string().regex(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/).max(80).nullable(),
  liquidationPrice: z.string().regex(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/).max(80).nullable(),
  leverage: z.string().regex(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/).max(80).nullable(),
}).strict();
const derivativeFamily = z.object({
  family: z.enum(HTX_DERIVATIVES_ACCOUNT_FAMILIES),
  status: z.enum(["NOT_CONFIGURED", "COMPLETE", "PARTIAL", "ERROR"]),
  accounts: z.array(derivativeAccount).max(100).nullable(),
  readStartedAtMs: time.nullable(), readCompletedAtMs: time.nullable(),
  responseGeneratedAtMs: time.nullable(), error: error.nullable(),
}).strict();
const derivatives = z.object({
  schemaVersion: z.literal("htx-derivatives-observation/v1"),
  families: z.array(derivativeFamily).length(HTX_DERIVATIVES_ACCOUNT_FAMILIES.length),
}).strict();
const observationFields = z.object({
  observationId: z.string().uuid(),
  binding: observationBindingSchema, collectionStartedAtMs: time, collectionCompletedAtMs: time,
  status: z.enum(["COMPLETE", "PARTIAL", "ERROR"]),
  balances: component(balance), openOrders: component(order),
  trades: z.array(z.object({ symbol: text.regex(/^[A-Z0-9]{2,32}$/), component: component(trade) }).strict()).min(1).max(32),
  holdings: z.array(balance).max(10000).nullable(),
});
const observation = z.discriminatedUnion("schemaVersion", [
  observationFields.extend({ schemaVersion: z.literal("account-observation/v1") }).strict(),
  observationFields.extend({ schemaVersion: z.literal("account-observation/v2"), derivatives }).strict(),
]);
export function sameObservationBinding(a: ObservationBinding, b: ObservationBinding) {
  return a.organizationId === b.organizationId && a.credentialId === b.credentialId &&
    a.exchangeAccountId === b.exchangeAccountId && a.credentialRevision === b.credentialRevision &&
    a.configurationRevision === b.configurationRevision;
}
/** Strict allowlist: stored/read payloads cannot acquire raw responses or credentials. */
export type AccountObservationComponentStatus = "COMPLETE" | "PARTIAL" | "ERROR";

/** Aggregate collected components only; NOT_CONFIGURED derivative families are omitted by callers. */
export function deriveAccountObservationStatus(
  statuses: readonly AccountObservationComponentStatus[],
): AccountObservationComponentStatus {
  return statuses.every(status => status === "COMPLETE") ? "COMPLETE" :
    statuses.every(status => status === "ERROR") ? "ERROR" : "PARTIAL";
}

export function parseAccountObservation(value: unknown): AccountObservation {
  const result = observation.parse(value);
  const components = [result.balances, result.openOrders, ...result.trades.map(t => t.component)];
  const derivativeStatuses = result.schemaVersion === "account-observation/v2"
    ? result.derivatives.families.flatMap(item =>
      item.status === "NOT_CONFIGURED" ? [] : [item.status])
    : [];
  const status = deriveAccountObservationStatus([
    ...components.map(component => component.status),
    ...derivativeStatuses,
  ]);
  if (result.collectionStartedAtMs > result.collectionCompletedAtMs || status !== result.status ||
    components.some(c => c.readStartedAtMs < result.collectionStartedAtMs ||
      c.readCompletedAtMs > result.collectionCompletedAtMs) ||
    new Set(result.trades.map(t => t.symbol)).size !== result.trades.length ||
    result.trades.some(t => t.component.values?.some(v => v.symbol !== t.symbol)) ||
    JSON.stringify(result.holdings) !== JSON.stringify(result.balances.status === "COMPLETE" ? result.balances.values : null)) {
    throw new Error("ACCOUNT_OBSERVATION_INVALID_PAYLOAD");
  }
  if (result.schemaVersion === "account-observation/v2") validateDerivativesProjection(
    result.derivatives.families, result.collectionStartedAtMs, result.collectionCompletedAtMs,
  );
  return result as AccountObservation;
}

function validateDerivativesProjection(
  families: readonly DerivativesAccountFamilyObservation[], collectionStartedAtMs: number,
  collectionCompletedAtMs: number,
): void {
  const byFamily = new Map(families.map(item => [item.family, item]));
  const valid = byFamily.size === HTX_DERIVATIVES_ACCOUNT_FAMILIES.length &&
    HTX_DERIVATIVES_ACCOUNT_FAMILIES.every(family => byFamily.has(family));
  if (!valid) throw new Error("ACCOUNT_OBSERVATION_INVALID_PAYLOAD");
  for (const item of families) {
    const notConfigured = item.status === "NOT_CONFIGURED";
    if (notConfigured) {
      if (item.accounts !== null || item.readStartedAtMs !== null || item.readCompletedAtMs !== null ||
        item.responseGeneratedAtMs !== null || item.error !== null) {
        throw new Error("ACCOUNT_OBSERVATION_INVALID_PAYLOAD");
      }
      continue;
    }
    if (item.readStartedAtMs === null || item.readCompletedAtMs === null ||
      item.readStartedAtMs > item.readCompletedAtMs ||
      item.readStartedAtMs < collectionStartedAtMs || item.readCompletedAtMs > collectionCompletedAtMs ||
      (item.responseGeneratedAtMs !== null && item.responseGeneratedAtMs > item.readCompletedAtMs) ||
      (item.status === "ERROR" ? item.accounts !== null || item.error === null :
        item.accounts === null || item.error !== null)) {
      throw new Error("ACCOUNT_OBSERVATION_INVALID_PAYLOAD");
    }
    const rows = item.accounts ?? [];
    const missingRequiredBalance = item.status === "COMPLETE" && rows.some(row =>
      row.marginBalance === null || (item.family === "usdt_cross_shared"
        ? row.withdrawAvailable == null
        : row.marginAvailable === null));
    if (missingRequiredBalance || new Set(rows.map(row => row.accountCode)).size !== rows.length || rows.some(row => {
      if (item.family === "usdt_cross_shared") {
        return row.accountCode !== "USDT" || row.collateralAsset !== "USDT" ||
          (row.marginMode !== null && row.marginMode !== "cross");
      }
      if (item.family === "usdt_isolated_perpetual") {
        return row.collateralAsset !== "USDT" || !row.accountCode.endsWith("-USDT") ||
          (row.marginMode !== null && row.marginMode !== "isolated");
      }
      if (item.family === "coin_perpetual") {
        return !row.accountCode.endsWith("-USD") || !row.collateralAsset ||
          !row.accountCode.startsWith(`${row.collateralAsset}-`);
      }
      return !row.collateralAsset || row.accountCode !== row.collateralAsset;
    })) throw new Error("ACCOUNT_OBSERVATION_INVALID_PAYLOAD");
  }
}
