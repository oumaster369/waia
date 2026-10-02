import { z } from "zod";
import { RESEARCH_DEVELOPMENT_SOURCE_ORG_V1 } from "./research-development-source-contract-v1";

export const RESEARCH_ISSUED_TRAINING_DIAGNOSTIC_V2 = "waia.research.issued-training-diagnostic.v2" as const;
const request = z.object({
  organizationId: z.string().uuid().transform(value => value.toLowerCase())
    .refine(value => value === RESEARCH_DEVELOPMENT_SOURCE_ORG_V1),
  attemptId: z.string().uuid().transform(value => value.toLowerCase()),
  trialIndex: z.number().int().min(0).max(31),
  limits: z.object({ maxBars: z.number().int().min(1).max(4096),
    maxBytes: z.number().int().min(1).max(32 * 1024 * 1024) }).strict(),
}).strict();

/** Operational budgets, not statistical sample floors or research authority. */
export function captureResearchIssuedTrainingRequestV2(value: unknown) {
  const parsed = request.parse(value);
  return Object.freeze({ ...parsed, limits: Object.freeze(parsed.limits) });
}

export type ResearchIssuedTrainingRequestV2 = ReturnType<typeof captureResearchIssuedTrainingRequestV2>;
