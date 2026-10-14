import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  financialHistoryRequestSchema,
  financialHistoryUidSchema,
  type FinancialHistoryRequest,
} from "./financial-history";
import { sameObservationBinding } from "./validation";
const point = z
  .object({
    time: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    id: z.string().min(1).max(64),
  })
  .strict()
  .nullable();
const schema = z
  .object({
    version: z.literal(1),
    binding: financialHistoryRequestSchema.shape.binding,
    filters: financialHistoryRequestSchema.shape.filters,
    pageSize: financialHistoryRequestSchema.shape.pageSize,
    snapshot: z
      .string()
      .min(4)
      .max(1024)
      .regex(/^\d+:\d+:(?:\d+(?:,\d+)*)?$/),
    htxUid: financialHistoryUidSchema,
    asOfMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    bills: point,
    coverage: point,
    billsDone: z.boolean(),
    coverageDone: z.boolean(),
  })
  .strict();
export type FinancialHistoryCursor = z.infer<typeof schema>;
const mac = (body: string, key: Uint8Array) =>
  createHmac("sha256", key).update("waia-financial-history-cursor-v1\n").update(body).digest();
export function encodeFinancialHistoryCursor(
  input: FinancialHistoryCursor,
  key: Uint8Array,
): string {
  if (key.byteLength !== 32) throw new Error("FINANCIAL_HISTORY_CURSOR_KEY");
  const body = Buffer.from(JSON.stringify(schema.parse(input))).toString("base64url");
  return financialHistoryRequestSchema.shape.cursor
    .unwrap()
    .parse(`${body}.${mac(body, key).toString("hex")}`);
}
export function decodeFinancialHistoryCursor(
  request: FinancialHistoryRequest,
  uid: string,
  now: number,
  key: Uint8Array,
  snapshot = "0:0:",
): FinancialHistoryCursor {
  if (!request.cursor)
    return {
      version: 1,
      binding: request.binding,
      filters: request.filters,
      pageSize: request.pageSize,
      htxUid: uid,
      snapshot: schema.shape.snapshot.parse(snapshot),
      asOfMs: now,
      bills: null,
      coverage: null,
      billsDone: false,
      coverageDone: false,
    };
  if (key.byteLength !== 32) throw new Error("FINANCIAL_HISTORY_CURSOR_KEY");
  const raw = financialHistoryRequestSchema.shape.cursor.unwrap().parse(request.cursor);
  const [body, signature] = raw.split(".");
  if (!timingSafeEqual(mac(body, key), Buffer.from(signature, "hex")))
    throw new Error("FINANCIAL_HISTORY_CURSOR_MAC");
  const c = schema.parse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
  if (
    !sameObservationBinding(c.binding, request.binding) ||
    c.htxUid !== uid ||
    c.pageSize !== request.pageSize ||
    c.filters.windowStartMs !== request.filters.windowStartMs ||
    c.filters.windowEndMs !== request.filters.windowEndMs ||
    c.asOfMs > now ||
    now - c.asOfMs > 3_600_000
  )
    throw new Error("FINANCIAL_HISTORY_CURSOR_CONTEXT");
  return c;
}
