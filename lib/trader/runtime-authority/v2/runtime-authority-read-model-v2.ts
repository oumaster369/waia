import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import type { RuntimePostureV2 } from "./runtime-authority-assessment-v2";
import type { RuntimeAuthorityAssessmentRepositoryV2 } from "./runtime-authority-repository-v2";

export type RuntimeAuthorityReadModelV2 = Readonly<{
  availability: "AVAILABLE" | "UNAVAILABLE";
  organizationId: string;
  runtimeInstanceId: string;
  posture: RuntimePostureV2 | null;
  reasonCodes: readonly string[];
  assessmentId: string | null;
  adjudicatedAtUtc: string | null;
}>;

function unavailable(organizationId: string, runtimeInstanceId: string): RuntimeAuthorityReadModelV2 {
  return Object.freeze({ availability: "UNAVAILABLE", organizationId, runtimeInstanceId,
    posture: null, reasonCodes: Object.freeze(["RUNTIME_AUTHORITY_UNAVAILABLE"]), assessmentId: null,
    adjudicatedAtUtc: null });
}

export async function readTenantRuntimeAuthorityV2(
  repository: RuntimeAuthorityAssessmentRepositoryV2,
  context: OrgContext,
  runtimeInstanceId: string,
): Promise<RuntimeAuthorityReadModelV2> {
  const rows = await repository.listByRuntime(context, runtimeInstanceId);
  const latest = [...rows].sort((a, b) => b.adjudicatedAtUtc.localeCompare(a.adjudicatedAtUtc) ||
    b.assessmentId.localeCompare(a.assessmentId))[0];
  if (!latest) return unavailable(context.organizationId, runtimeInstanceId);
  return Object.freeze({ availability: "AVAILABLE", organizationId: context.organizationId, runtimeInstanceId,
    posture: latest.posture, reasonCodes: latest.reasonCodes, assessmentId: latest.assessmentId,
    adjudicatedAtUtc: latest.adjudicatedAtUtc });
}

/** Operator projection is deliberately explicit and cannot infer or widen tenant scope. */
export async function readAdminRuntimeAuthoritiesV2(
  repository: RuntimeAuthorityAssessmentRepositoryV2,
  authorizedOrganizationIds: readonly string[],
  runtimeInstanceIdByOrganization: Readonly<Record<string, string>>,
): Promise<readonly RuntimeAuthorityReadModelV2[]> {
  const unique = [...new Set(authorizedOrganizationIds)].sort();
  return Promise.all(unique.map((organizationId) => {
    const runtimeInstanceId = runtimeInstanceIdByOrganization[organizationId];
    if (!runtimeInstanceId) return unavailable(organizationId, "UNSPECIFIED");
    return readTenantRuntimeAuthorityV2(repository, { organizationId }, runtimeInstanceId);
  }));
}
