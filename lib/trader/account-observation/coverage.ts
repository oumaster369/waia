import { z } from "zod";

/** Transport coverage is part of persisted configuration identity, not venue authority. */
export const htxObservationReaderLimitsSchema = z.object({
  pageSize: z.number().int().min(1).max(500),
  maxPages: z.number().int().min(1).max(10),
  maxRecords: z.number().int().min(1).max(1000),
  maxResponseBytes: z.number().int().min(1).max(1048576),
  tradeWindowMs: z.number().int().min(1).max(172800000),
}).strict();

export const htxObservationCoverageSchema = htxObservationReaderLimitsSchema.extend({
  host: z.enum(["api.huobi.pro", "api-aws.huobi.pro"]),
}).strict();

export const htxV5FinancialHistoryScopeSchema = z.object({
  enabled: z.literal(true), scopeId: z.string().uuid(),
  windowStartMs: z.number().int().nonnegative().max(8.64e15),
  windowEndMs: z.number().int().positive().max(8.64e15),
  validFromMs: z.number().int().nonnegative().max(8.64e15),
  validUntilMs: z.number().int().positive().max(8.64e15),
}).strict().refine(s => s.windowStartMs < s.windowEndMs && s.windowEndMs - s.windowStartMs <= 172800000 &&
  s.windowEndMs <= s.validFromMs && s.validFromMs < s.validUntilMs && s.validUntilMs - s.validFromMs <= 600000);

// Reserve the existing one-page bills read inside the unchanged V5 request budget.
// Seven fill contracts use at most 30 reads with bills; eight without bills use 31.
export const htxV5ObservationConfigurationSchema = z.object({
  enabled: z.boolean(),
  fillContracts: z.array(z.string().regex(/^[A-Z0-9]+-USDT(?:-\d{6})?$/)).min(1).max(8).optional(),
  expectedHtxUid: z.string().regex(/^[1-9]\d{0,38}$/).optional(),
  financialHistory: htxV5FinancialHistoryScopeSchema.optional(),
}).strict().refine(c => !c.financialHistory || c.enabled && !!c.expectedHtxUid && (c.fillContracts?.length ?? 0) <= 7);

export type HtxObservationCoverage = Readonly<z.infer<typeof htxObservationCoverageSchema>>;
