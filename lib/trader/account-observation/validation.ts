import { z } from "zod";
import type { AccountObservation, ObservationBinding } from "./types";

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
const observation = z.object({
  schemaVersion: z.literal("account-observation/v1"), observationId: z.string().uuid(),
  binding: observationBindingSchema, collectionStartedAtMs: time, collectionCompletedAtMs: time,
  status: z.enum(["COMPLETE", "PARTIAL", "ERROR"]),
  balances: component(balance), openOrders: component(order),
  trades: z.array(z.object({ symbol: text.regex(/^[A-Z0-9]{2,32}$/), component: component(trade) }).strict()).min(1).max(32),
  holdings: z.array(balance).max(10000).nullable(),
}).strict();
export function sameObservationBinding(a: ObservationBinding, b: ObservationBinding) {
  return a.organizationId === b.organizationId && a.credentialId === b.credentialId &&
    a.exchangeAccountId === b.exchangeAccountId && a.credentialRevision === b.credentialRevision &&
    a.configurationRevision === b.configurationRevision;
}
/** Strict allowlist: stored/read payloads cannot acquire raw responses or credentials. */
export function parseAccountObservation(value: unknown): AccountObservation {
  const result = observation.parse(value);
  const components = [result.balances, result.openOrders, ...result.trades.map(t => t.component)];
  const status = components.every(c => c.status === "COMPLETE") ? "COMPLETE" :
    components.every(c => c.status === "ERROR") ? "ERROR" : "PARTIAL";
  if (result.collectionStartedAtMs > result.collectionCompletedAtMs || status !== result.status ||
    components.some(c => c.readStartedAtMs < result.collectionStartedAtMs ||
      c.readCompletedAtMs > result.collectionCompletedAtMs) ||
    new Set(result.trades.map(t => t.symbol)).size !== result.trades.length ||
    result.trades.some(t => t.component.values?.some(v => v.symbol !== t.symbol)) ||
    JSON.stringify(result.holdings) !== JSON.stringify(result.balances.status === "COMPLETE" ? result.balances.values : null)) {
    throw new Error("ACCOUNT_OBSERVATION_INVALID_PAYLOAD");
  }
  return result as AccountObservation;
}
