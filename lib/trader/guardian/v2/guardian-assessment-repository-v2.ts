import type { OrgContext } from "@/lib/waia-core/scope/org-context";

import { assertGuardianAssessmentV2, type GuardianAssessmentV2 } from "./guardian-assessment-v2";

export interface GuardianAssessmentRepositoryV2 {
  append(context: OrgContext, assessment: GuardianAssessmentV2): Promise<GuardianAssessmentV2>;
  getById(context: OrgContext, assessmentId: string): Promise<GuardianAssessmentV2 | null>;
  listByLot(context: OrgContext, lotId: string): Promise<readonly GuardianAssessmentV2[]>;
}

export class GuardianAssessmentPersistenceConflictV2 extends Error {
  constructor() {
    super("GUARDIAN_ASSESSMENT_PERSISTENCE_CONFLICT");
    this.name = "GuardianAssessmentPersistenceConflictV2";
  }
}

export class InMemoryGuardianAssessmentRepositoryV2
  implements GuardianAssessmentRepositoryV2 {
  private readonly rows = new Map<string, GuardianAssessmentV2>();

  async append(
    context: OrgContext,
    assessment: GuardianAssessmentV2,
  ): Promise<GuardianAssessmentV2> {
    assertGuardianAssessmentV2(assessment);
    if (assessment.organizationId !== context.organizationId) {
      throw new Error("GUARDIAN_ASSESSMENT_TENANT_MISMATCH");
    }
    const existing = this.rows.get(assessment.assessmentId);
    if (existing) {
      if (existing.contentDigest !== assessment.contentDigest) {
        throw new GuardianAssessmentPersistenceConflictV2();
      }
      return existing;
    }
    const stored = Object.freeze({ ...assessment, reasonCodes: Object.freeze([...assessment.reasonCodes]) });
    this.rows.set(stored.assessmentId, stored);
    return stored;
  }

  async getById(context: OrgContext, assessmentId: string): Promise<GuardianAssessmentV2 | null> {
    const row = this.rows.get(assessmentId);
    return row?.organizationId === context.organizationId ? row : null;
  }

  async listByLot(
    context: OrgContext,
    lotId: string,
  ): Promise<readonly GuardianAssessmentV2[]> {
    return [...this.rows.values()]
      .filter((row) => row.organizationId === context.organizationId && row.lotId === lotId)
      .sort((left, right) => left.assessmentId.localeCompare(right.assessmentId));
  }
}

