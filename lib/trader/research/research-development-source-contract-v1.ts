import { z } from "zod";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";

export const RESEARCH_DEVELOPMENT_SOURCE_SCHEMA_V1 =
  "waia.research.development-source-issuance.v1" as const;
export const RESEARCH_DEVELOPMENT_SOURCE_ORG_V1 =
  "3c50b4e9-1138-43a5-a29f-e65088124cfc" as const;
export const RESEARCH_DEVELOPMENT_SOURCE_ROLE_V1 = "waia_research_source_writer" as const;
export const RESEARCH_DEVELOPMENT_SOURCE_LOGIN_V1 = "waia_research_source_writer_login" as const;

// Operational materialization limits, not scientific sample or admission rules.
export const RESEARCH_DEVELOPMENT_SOURCE_LIMITS_V1 = Object.freeze({
  maxCycles: 10_000, maxSourceBytes: 512 * 1024 * 1024,
  maxReceiptBytes: 2 * 1024 * 1024, deadlineMs: 60_000,
});
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const index = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const count = z.number().int().positive().max(RESEARCH_DEVELOPMENT_SOURCE_LIMITS_V1.maxCycles);
const commandId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}(?![\s\S])/);
const organizationId = z.string().uuid().transform(value => value.toLowerCase())
  .refine(value => value === RESEARCH_DEVELOPMENT_SOURCE_ORG_V1, "internal research organization required");

const preparationSchema = z.object({
  organizationId, commandId, symbol: z.enum(["BTCUSDT", "ETHUSDT"]),
  initialRecordIndex: index, observationBarCount: count,
  // At least one gap bar follows the existing strict observation cutoff < train
  // first-open rule. This is not qualification of a statistical embargo.
  gapBarCount: count, trainingBarCount: count,
}).strict().superRefine((value, ctx) => {
  const total = value.observationBarCount + value.gapBarCount + value.trainingBarCount;
  if (total > RESEARCH_DEVELOPMENT_SOURCE_LIMITS_V1.maxCycles ||
      !Number.isSafeInteger(value.initialRecordIndex + total)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "bounded source range required" });
  }
});
export type ResearchDevelopmentSourceRequestV1 = Readonly<z.infer<typeof preparationSchema>>;

export function captureResearchDevelopmentSourceRequestV1(value: unknown) {
  return Object.freeze(preparationSchema.parse(value));
}

export function researchDevelopmentSourceRunIdV1(request: ResearchDevelopmentSourceRequestV1): string {
  return `research-source-v1:${computeStableJsonDigest({
    organizationId: request.organizationId, commandId: request.commandId,
  })}`;
}

const partitionSchema = z.object({
  firstRecordIndex: index, barCount: count, firstOpenMs: index, lastCloseMs: index,
  contentSha256: sha,
}).strict().refine(value => value.firstOpenMs < value.lastCloseMs &&
  value.lastCloseMs - value.firstOpenMs === value.barCount * 60_000, "contiguous one-minute range required");

const bodyFieldsSchema = z.object({
  schemaVersion: z.literal(RESEARCH_DEVELOPMENT_SOURCE_SCHEMA_V1),
  authority: z.literal("RESTRICTED_DEVELOPMENT_SOURCE_WRITER_V1"),
  request: preparationSchema,
  sourceRunId: z.string().regex(/^research-source-v1:[a-f0-9]{64}$/),
  releaseSha: z.string().regex(/^[a-f0-9]{40}$/),
  sourceReleaseSha: z.string().regex(/^[a-f0-9]{40}$/),
  qualificationReceiptDigest: sha,
  runtimeRequalificationDigest: sha.nullable(),
  partitionRawSha256: sha, partitionSemanticDigest: sha,
  volumeQualificationDigest: sha,
  rowSetSha256: sha,
  observation: partitionSchema, training: partitionSchema,
  pitRule: z.literal("CLOSED_BAR_AND_ABSOLUTE_RECORD_INDEX_ONLY"),
  sourceAvailability: z.literal("PIT_SOURCE_AVAILABILITY_NOT_ESTABLISHED"),
  scientificallyQualified: z.literal(false), capitalEligible: z.literal(false),
  issuerRole: z.literal(RESEARCH_DEVELOPMENT_SOURCE_ROLE_V1),
  issuedAt: z.string().datetime().refine(value => new Date(value).toISOString() === value,
    "canonical UTC timestamp required"),
}).strict();
const bodySchema = bodyFieldsSchema.superRefine((value, ctx) => {
  const request = value.request;
  if (value.sourceRunId !== researchDevelopmentSourceRunIdV1(request) ||
      value.observation.firstRecordIndex !== request.initialRecordIndex ||
      value.observation.barCount !== request.observationBarCount ||
      value.training.firstRecordIndex !== request.initialRecordIndex +
        request.observationBarCount + request.gapBarCount ||
      value.training.barCount !== request.trainingBarCount ||
      value.training.firstOpenMs - value.observation.lastCloseMs !== request.gapBarCount * 60_000 ||
      (value.sourceReleaseSha === value.releaseSha) !== (value.runtimeRequalificationDigest === null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "observed source identity mismatch" });
  }
});
export type ResearchDevelopmentSourceBodyV1 = z.infer<typeof bodySchema>;
export type ResearchDevelopmentSourceIssuanceV1 = Readonly<ResearchDevelopmentSourceBodyV1 & {
  contentDigest: string;
}>;

/** Parsing/self-digest verification is integrity only; trusted issuance requires
 * the exact immutable row written by the constrained source owner. */
export function parseResearchDevelopmentSourceIssuanceV1(value: unknown): ResearchDevelopmentSourceIssuanceV1 {
  const record = bodyFieldsSchema.extend({ contentDigest: sha }).parse(value);
  const { contentDigest, ...body } = record;
  bodySchema.parse(body);
  if (computeStableJsonDigest(body) !== contentDigest) {
    throw new Error("RESEARCH_DEVELOPMENT_SOURCE_ISSUANCE_DIGEST_MISMATCH");
  }
  return Object.freeze({ ...record, request: Object.freeze(record.request),
    observation: Object.freeze(record.observation), training: Object.freeze(record.training) });
}

export function sealResearchDevelopmentSourceIssuanceV1(value: ResearchDevelopmentSourceBodyV1) {
  const body = bodySchema.parse(value);
  return parseResearchDevelopmentSourceIssuanceV1({ ...body, contentDigest: computeStableJsonDigest(body) });
}
