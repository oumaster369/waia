import { z } from "zod";
import { computeStableJsonDigest } from "./digest";
import { deepFreezeInquiry } from "@/lib/trader/intelligence/information-inquiry/contracts-v1";
import { resolveFhvCanonicalPartitionInterval } from "@/lib/trader/market-data/fhv-partition-boundaries";
import { RESEARCH_DEVELOPMENT_SOURCE_ORG_V1, RESEARCH_DEVELOPMENT_SOURCE_LIMITS_V1 } from "./research-development-source-contract-v1";

const end = "(?![\\s\\S])";
const sha = z.string().regex(new RegExp("^[a-f0-9]{64}" + end));
const release = z.string().regex(new RegExp("^[a-f0-9]{40}" + end));
const index = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const range = z.object({
  firstRecordIndex: index,
  barCount: z.number().int().positive().max(RESEARCH_DEVELOPMENT_SOURCE_LIMITS_V1.maxCycles),
}).strict().refine(value => Number.isSafeInteger(value.firstRecordIndex + value.barCount),
  "safe absolute record extent required");
const requestSchema = z.object({
  organizationId: z.literal(RESEARCH_DEVELOPMENT_SOURCE_ORG_V1),
  commandId: z.string().regex(new RegExp("^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}" + end)),
  trainingSourceRunId: z.string().regex(new RegExp("^research-source-v1:[a-f0-9]{64}" + end)),
  trainingSourceIssuanceDigest: sha,
  symbol: z.enum(["BTCUSDT", "ETHUSDT"]),
  validation: range,
  walkForward: z.array(range).min(1).max(1024),
}).strict().superRefine((value, ctx) => {
  for (const [i, window] of value.walkForward.entries()) {
    if (window.firstRecordIndex < value.validation.firstRecordIndex ||
        window.firstRecordIndex + window.barCount > value.validation.firstRecordIndex + value.validation.barCount ||
        (i > 0 && value.walkForward[i - 1]!.firstRecordIndex + value.walkForward[i - 1]!.barCount > window.firstRecordIndex)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "ordered disjoint validation slices required" });
    }
  }
});

export type ResearchDevelopmentEvaluationSourceRequestV1 = Readonly<z.infer<typeof requestSchema>>;
export function captureResearchDevelopmentEvaluationSourceRequestV1(supplied: unknown) {
  return deepFreezeInquiry(requestSchema.parse(supplied));
}

/** Stable selection identity only; not a committed source or permission to disclose it. */
export function researchDevelopmentEvaluationSourceIdV1(request: ResearchDevelopmentEvaluationSourceRequestV1) {
  return `research-evaluation-source-v1:${computeStableJsonDigest({
    organizationId: request.organizationId, commandId: request.commandId,
  })}`;
}

const observedRange = z.object({
  firstRecordIndex: index, barCount: z.number().int().positive().max(RESEARCH_DEVELOPMENT_SOURCE_LIMITS_V1.maxCycles),
  firstOpenMs: index, lastCloseMs: index, contentSha256: sha,
}).strict().superRefine((value, ctx) => {
  const development = resolveFhvCanonicalPartitionInterval("development");
  if (!Number.isSafeInteger(value.firstRecordIndex + value.barCount) ||
      value.firstOpenMs % 60_000 !== 0 || value.lastCloseMs % 60_000 !== 0 ||
      value.lastCloseMs - value.firstOpenMs !== value.barCount * 60_000 ||
      value.firstOpenMs < Date.parse(development.startUtc) || value.lastCloseMs > Date.parse(development.endUtc)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "contiguous DEVELOPMENT minute extent required" });
  }
});
const fields = z.object({
  schemaVersion: z.literal("waia.research.development-evaluation-source-metadata.v1"),
  authority: z.literal("PREPARATION_METADATA_ONLY"),
  request: requestSchema,
  evaluationSourceId: z.string().regex(new RegExp("^research-evaluation-source-v1:[a-f0-9]{64}" + end)),
  releaseSha: release, sourceReleaseSha: release,
  qualificationReceiptDigest: sha, runtimeRequalificationDigest: sha.nullable(),
  partitionRawSha256: sha, partitionSemanticDigest: sha, volumeQualificationDigest: sha,
  sourceCycleSetSha256: sha,
  validation: observedRange, walkForward: z.array(observedRange).min(1).max(1024),
  sourceAvailability: z.literal("PIT_SOURCE_AVAILABILITY_NOT_ESTABLISHED"),
  scientificQualified: z.literal(false), capitalEligible: z.literal(false),
}).strict();
const bodySchema = fields.superRefine((value, ctx) => {
  const expected = value.request;
  if (value.evaluationSourceId !== researchDevelopmentEvaluationSourceIdV1(expected) ||
      (value.sourceReleaseSha === value.releaseSha) !== (value.runtimeRequalificationDigest === null) ||
      value.validation.firstRecordIndex !== expected.validation.firstRecordIndex ||
      value.validation.barCount !== expected.validation.barCount || value.walkForward.length !== expected.walkForward.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "evaluation source selection identity mismatch" });
  }
  for (const [i, window] of value.walkForward.entries()) {
    const selected = expected.walkForward[i];
    if (!selected || window.firstRecordIndex !== selected.firstRecordIndex || window.barCount !== selected.barCount ||
        window.firstOpenMs < value.validation.firstOpenMs || window.lastCloseMs > value.validation.lastCloseMs ||
        // The full validation interval has already been checked as contiguous.
        // This validates metadata consistency; it does not discover source offsets.
        window.firstOpenMs - value.validation.firstOpenMs !==
          (window.firstRecordIndex - value.validation.firstRecordIndex) * 60_000) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "evaluation window identity mismatch" });
    }
  }
});
export type ResearchDevelopmentEvaluationSourceBodyV1 = z.infer<typeof bodySchema>;
export type ResearchDevelopmentEvaluationSourceMetadataV1 = Readonly<ResearchDevelopmentEvaluationSourceBodyV1 & { contentDigest: string }>;

/** Self-digest integrity only. No DB issuer, committed registration or consume is established here. */
export function parseResearchDevelopmentEvaluationSourceMetadataV1(supplied: unknown) {
  const { contentDigest, ...body } = fields.extend({ contentDigest: sha }).parse(supplied);
  bodySchema.parse(body);
  if (contentDigest !== computeStableJsonDigest(body)) throw new Error("RESEARCH_EVALUATION_SOURCE_METADATA_DIGEST_MISMATCH");
  return deepFreezeInquiry({ ...body, contentDigest });
}

export function sealResearchDevelopmentEvaluationSourceMetadataV1(supplied: ResearchDevelopmentEvaluationSourceBodyV1) {
  const body = bodySchema.parse(supplied);
  return parseResearchDevelopmentEvaluationSourceMetadataV1({ ...body, contentDigest: computeStableJsonDigest(body) });
}
