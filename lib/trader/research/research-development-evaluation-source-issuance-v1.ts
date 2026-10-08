import { z } from "zod";
import { computeStableJsonDigest } from "./digest";
import { deepFreezeInquiry } from "@/lib/trader/intelligence/information-inquiry/contracts-v1";
import { parseResearchDevelopmentEvaluationSourceMetadataV1 } from "./research-development-evaluation-source-contract-v1";

export const RESEARCH_EVALUATION_SOURCE_ROLE_V1 = "waia_research_eval_source_writer";
export const RESEARCH_EVALUATION_SOURCE_LOGIN_V1 = "waia_research_eval_source_writer_login";
const sha = z.string().regex(/^[a-f0-9]{64}(?![\s\S])/);
const fields = z.object({
  schemaVersion: z.literal("waia.research.development-evaluation-source-issuance.v1"),
  authority: z.literal("RESTRICTED_EVALUATION_SOURCE_WRITER_V1"),
  metadata: z.unknown().transform(parseResearchDevelopmentEvaluationSourceMetadataV1),
  rowSetSha256: sha,
  issuerRole: z.literal(RESEARCH_EVALUATION_SOURCE_ROLE_V1),
  issuedAt: z.string().datetime({ precision: 3 }).refine(value => new Date(value).toISOString() === value),
}).strict();
export type ResearchEvaluationSourceIssuanceBodyV1 = z.infer<typeof fields>;
export type ResearchEvaluationSourceIssuanceV1 = Readonly<ResearchEvaluationSourceIssuanceBodyV1 & { contentDigest: string }>;

/** Integrity only: the restricted owner must verify the committed row and every source row. */
export function parseResearchEvaluationSourceIssuanceV1(supplied: unknown): ResearchEvaluationSourceIssuanceV1 {
  const { contentDigest, ...body } = fields.extend({ contentDigest: sha }).parse(supplied);
  if (contentDigest !== computeStableJsonDigest(body)) throw new Error("RESEARCH_EVALUATION_SOURCE_ISSUANCE_DIGEST_MISMATCH");
  return deepFreezeInquiry({ ...body, contentDigest });
}
export function sealResearchEvaluationSourceIssuanceV1(input: ResearchEvaluationSourceIssuanceBodyV1) {
  const body = fields.parse(input);
  return parseResearchEvaluationSourceIssuanceV1({ ...body, contentDigest: computeStableJsonDigest(body) });
}
