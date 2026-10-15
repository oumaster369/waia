import { z } from "zod";
import { deepFreezeInquiry } from "@/lib/trader/intelligence/information-inquiry/contracts-v1";
import { RESEARCH_DEVELOPMENT_SOURCE_ORG_V1 } from "./research-development-source-contract-v1";

export const RESEARCH_DEVELOPMENT_EVALUATION_CLAIM_V1 = "waia.research.development-evaluation-claim.v1" as const;
const request = z.object({
  organizationId: z.literal(RESEARCH_DEVELOPMENT_SOURCE_ORG_V1),
  attemptId: z.string().uuid().transform(value => value.toLowerCase()),
  evaluationSourceId: z.string().regex(/^research-evaluation-source-v1:[a-f0-9]{64}(?![\s\S])/),
  commandId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}(?![\s\S])/),
  limits: z.object({ maxBars: z.number().int().min(1).max(4096),
    maxBytes: z.number().int().min(1).max(32 * 1024 * 1024),
    maxTraceBytes: z.number().int().min(1).max(32 * 1024 * 1024) }).strict(),
}).strict();

/** IDs and operational limits only. Parsing grants no use or disclosure authority. */
export function captureResearchDevelopmentEvaluationClaimRequestV1(supplied: unknown) {
  return deepFreezeInquiry(request.parse(supplied));
}
export type ResearchDevelopmentEvaluationClaimRequestV1 = ReturnType<typeof captureResearchDevelopmentEvaluationClaimRequestV1>;
