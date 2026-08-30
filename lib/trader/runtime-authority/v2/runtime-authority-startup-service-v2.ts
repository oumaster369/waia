import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import type { RuntimeAuthorityAssessmentV2 } from "./runtime-authority-assessment-v2";

/** Sole write boundary for startup authority. Backends must check the lease in the write transaction. */
export interface RuntimeAuthorityStartupWriterV2 {
  commitAssessment(
    context: OrgContext,
    assessment: RuntimeAuthorityAssessmentV2,
  ): Promise<RuntimeAuthorityAssessmentV2>;
}

export async function commitRuntimeAuthorityStartupAssessmentV2(
  writer: RuntimeAuthorityStartupWriterV2,
  context: OrgContext,
  assessment: RuntimeAuthorityAssessmentV2,
): Promise<RuntimeAuthorityAssessmentV2> {
  if (assessment.organizationId !== context.organizationId) {
    throw new Error("RUNTIME_AUTHORITY_TENANT_MISMATCH");
  }
  return writer.commitAssessment(context, assessment);
}
