/** Persisted collector evidence only. This contract never calculates financial results. */
import { z } from "zod";
import { observationBindingSchema, sameObservationBinding, v5Bill } from "./validation";
import { HTX_V5_BILL_CATEGORIES } from "./derivatives/htx-v5-bill-groups";

export const FINANCIAL_HISTORY_LIMITS = Object.freeze({
  pageSize: 100,
  responseBytes: 1024 * 1024,
  cursorBytes: 3072,
});
const time = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const financialHistoryUidSchema = z.string().regex(/^[1-9]\d{0,38}$/);
export const financialHistoryFiltersSchema = z
  .object({
    windowStartMs: time.nullable(),
    windowEndMs: time.nullable(),
  })
  .strict()
  .refine(
    (x) => x.windowStartMs === null || x.windowEndMs === null || x.windowStartMs < x.windowEndMs,
  );
export const financialHistoryRequestSchema = z
  .object({
    binding: observationBindingSchema,
    pageSize: z.number().int().min(1).max(FINANCIAL_HISTORY_LIMITS.pageSize),
    filters: financialHistoryFiltersSchema,
    cursor: z
      .string()
      .min(1)
      .max(FINANCIAL_HISTORY_LIMITS.cursorBytes)
      .regex(/^[A-Za-z0-9_-]+\.[0-9a-f]{64}$/)
      .nullable(),
  })
  .strict();
const provenance = z
  .object({
    binding: observationBindingSchema,
    observationId: z.string().uuid(),
    scopeId: z.string().uuid(),
    windowStartMs: time,
    windowEndMs: time,
    validFromMs: time,
    validUntilMs: time,
    collectionCompletedAtMs: time,
  })
  .strict()
  .refine((x) => x.windowStartMs < x.windowEndMs && x.validFromMs < x.validUntilMs);
export const financialHistoryRecordSchema = z
  .object({
    htxUid: financialHistoryUidSchema,
    bill: v5Bill.refine(
      (b) =>
        b.category ===
        (HTX_V5_BILL_CATEGORIES[b.type as keyof typeof HTX_V5_BILL_CATEGORIES] ?? "UNKNOWN"),
    ),
    provenance,
  })
  .strict()
  .refine(
    (x) =>
      x.bill.createdTimeMs >= x.provenance.windowStartMs &&
      x.bill.createdTimeMs < x.provenance.windowEndMs,
  );
export const financialHistoryCoverageSchema = z
  .object({
    htxUid: financialHistoryUidSchema.nullable(),
    provenance,
    status: z.enum(["PARTIAL", "ERROR", "UNAVAILABLE"]),
    readStartedAtMs: time.nullable(),
    responseReceivedAtMs: time.nullable(),
    readCompletedAtMs: time.nullable(),
    responseGeneratedAtMs: time.nullable(),
    pageSize: z.literal(100),
    pagesRead: z.literal(1).nullable(),
    nextFrom: z
      .string()
      .regex(/^(?:0|[1-9]\d{0,18})$/)
      .nullable(),
    observedRowCount: z.number().int().min(0).max(100).nullable(),
    completeness: z.literal("UNKNOWN"),
    windowConvention: z.literal("START_INCLUSIVE_END_EXCLUSIVE"),
    error: z
      .enum([
        "TIMEOUT",
        "RATE_LIMITED",
        "PERMISSION_DENIED",
        "READ_FAILED",
        "INVALID_RESPONSE",
        "IDENTITY_MISMATCH",
      ])
      .nullable(),
    unavailableReason: z.enum(["SCOPE_EXPIRED", "SCOPE_NOT_YET_VALID"]).nullable(),
  })
  .strict()
  .refine((x) =>
    x.status === "PARTIAL"
      ? x.htxUid !== null &&
        x.pagesRead === 1 &&
        x.observedRowCount !== null &&
        x.error === null &&
        x.unavailableReason === null
      : x.pagesRead === null &&
        x.observedRowCount === null &&
        x.nextFrom === null &&
        (x.status === "ERROR"
          ? x.error !== null && x.unavailableReason === null
          : x.error === null && x.unavailableReason !== null),
  );
export const financialHistoryResponseSchema = z
  .object({
    binding: observationBindingSchema,
    htxUid: financialHistoryUidSchema,
    currentFinancialStatus: z.enum(["NOT_CONFIGURED", "PARTIAL", "ERROR", "UNAVAILABLE"]),
    records: z.array(financialHistoryRecordSchema).max(100),
    coverage: z.array(financialHistoryCoverageSchema).max(100),
    nextCursor: financialHistoryRequestSchema.shape.cursor,
    source: z.literal("PERSISTED_COLLECTOR_RECORDS_ONLY"),
    providerRequests: z.literal(0),
    completeness: z.literal("UNKNOWN"),
  })
  .strict()
  .superRefine((x, ctx) => {
    for (const row of [...x.records, ...x.coverage]) {
      const b = row.provenance.binding;
      if (
        row.htxUid !== x.htxUid ||
        b.organizationId !== x.binding.organizationId ||
        b.credentialId !== x.binding.credentialId ||
        b.exchangeAccountId !== x.binding.exchangeAccountId
      ) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "FINANCIAL_HISTORY_LINEAGE" });
      }
    }
  });
export type FinancialHistoryRequest = z.infer<typeof financialHistoryRequestSchema>;
export type FinancialHistoryResponse = z.infer<typeof financialHistoryResponseSchema>;
export type FinancialHistoryRecord = z.infer<typeof financialHistoryRecordSchema>;
export type FinancialHistoryCoverage = z.infer<typeof financialHistoryCoverageSchema>;

export function assertFinancialHistoryResponse(
  request: FinancialHistoryRequest,
  value: FinancialHistoryResponse,
): void {
  if (
    !sameObservationBinding(request.binding, value.binding) ||
    value.records.length > request.pageSize ||
    value.coverage.length > request.pageSize
  )
    throw new Error("FINANCIAL_HISTORY_RESPONSE_BINDING");
  for (let i = 1; i < value.records.length; i++) {
    const previous = value.records[i - 1].bill,
      current = value.records[i].bill;
    if (
      previous.createdTimeMs > current.createdTimeMs ||
      (previous.createdTimeMs === current.createdTimeMs && previous.id >= current.id)
    )
      throw new Error("FINANCIAL_HISTORY_RESPONSE_ORDER");
  }
  for (let i = 1; i < value.coverage.length; i++) {
    const previous = value.coverage[i - 1].provenance,
      current = value.coverage[i].provenance;
    if (
      previous.collectionCompletedAtMs > current.collectionCompletedAtMs ||
      (previous.collectionCompletedAtMs === current.collectionCompletedAtMs &&
        previous.observationId >= current.observationId)
    )
      throw new Error("FINANCIAL_HISTORY_RESPONSE_ORDER");
  }
  const { windowStartMs: start, windowEndMs: end } = request.filters;
  for (const { bill } of value.records) {
    if (
      (start !== null && bill.createdTimeMs < start) ||
      (end !== null && bill.createdTimeMs >= end)
    )
      throw new Error("FINANCIAL_HISTORY_RESPONSE_FILTER");
  }
  for (const { provenance: p } of value.coverage) {
    if ((start !== null && p.windowEndMs <= start) || (end !== null && p.windowStartMs >= end))
      throw new Error("FINANCIAL_HISTORY_RESPONSE_FILTER");
  }
}
