import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import {
  buildRuntimeAuthorityAssessmentV2,
  type RuntimeAuthorityAssessmentV2,
  type RuntimeAuthorityAssessmentV2Draft,
} from "./runtime-authority-assessment-v2";
import {
  commitRuntimeAuthorityStartupAssessmentV2,
  type RuntimeAuthorityStartupWriterV2,
} from "./runtime-authority-startup-service-v2";

export type RuntimeAuthorityStartupEvidenceInputV2 = Omit<RuntimeAuthorityAssessmentV2Draft, "organizationId">;

/** Builds the deterministic posture from exact evidence and persists only through the fenced writer. */
export async function adjudicateRuntimeAuthorityStartupV2(
  writer: RuntimeAuthorityStartupWriterV2,
  context: OrgContext,
  input: RuntimeAuthorityStartupEvidenceInputV2,
): Promise<RuntimeAuthorityAssessmentV2> {
  const assessment = buildRuntimeAuthorityAssessmentV2({ ...input, organizationId: context.organizationId });
  return commitRuntimeAuthorityStartupAssessmentV2(writer, context, assessment);
}
