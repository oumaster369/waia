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

export type HtxObservationCoverage = Readonly<z.infer<typeof htxObservationCoverageSchema>>;
