import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

import {
  GuardianAssessmentPersistenceConflictV2,
  type GuardianAssessmentRepositoryV2,
} from "./guardian-assessment-repository-v2";
import {
  parseGuardianAssessmentV2,
  serializeGuardianAssessmentV2,
  type GuardianAssessmentV2,
} from "./guardian-assessment-v2";

type Executor = Pick<WaiaPostgresDb, "insert" | "select">;

function mapRow(row: typeof pgSchema.traderGuardianAssessmentsV2.$inferSelect): GuardianAssessmentV2 {
  const value = parseGuardianAssessmentV2(row.canonicalJson);
  if (
    value.assessmentId !== row.assessmentId || value.organizationId !== row.organizationId ||
    value.positionId !== row.positionId || value.lotId !== row.lotId ||
    value.contentDigest !== row.contentDigest
  ) throw new GuardianAssessmentPersistenceConflictV2();
  return value;
}

export function createPostgresGuardianAssessmentRepositoryV2(
  db: Executor,
): GuardianAssessmentRepositoryV2 {
  return {
    async append(context, assessment) {
      const scoped = requireOrgContext(context.organizationId);
      if (assessment.organizationId !== scoped.organizationId) {
        throw new Error("GUARDIAN_ASSESSMENT_TENANT_MISMATCH");
      }
      const canonicalJson = serializeGuardianAssessmentV2(assessment);
      await db.insert(pgSchema.traderGuardianAssessmentsV2).values({
        assessmentId: assessment.assessmentId,
        organizationId: scoped.organizationId,
        positionId: assessment.positionId,
        lotId: assessment.lotId,
        symbol: assessment.symbol,
        openingCausalLineageDigest: assessment.openingCausalLineageDigest,
        realityFrontierId: assessment.realityFrontierId,
        realityContentDigest: assessment.realityContentDigest,
        qualifiedEvidenceBundleId: assessment.qualifiedEvidenceBundleId,
        qualifiedEvidenceContentDigest: assessment.qualifiedEvidenceContentDigest,
        informationSufficiencyProfile: assessment.informationSufficiencyProfile,
        openPositionSufficiency: assessment.openPositionSufficiency,
        newOpportunitySufficiency: assessment.newOpportunitySufficiency,
        recommendation: assessment.recommendation,
        targetReductionBps: assessment.targetReductionBps,
        reasonCodesJson: [...assessment.reasonCodes],
        contentDigest: assessment.contentDigest,
        canonicalJson,
      }).onConflictDoNothing();
      const stored = await this.getById(scoped, assessment.assessmentId);
      if (!stored || serializeGuardianAssessmentV2(stored) !== canonicalJson) {
        throw new GuardianAssessmentPersistenceConflictV2();
      }
      return stored;
    },
    async getById(context, assessmentId) {
      const scoped = requireOrgContext(context.organizationId);
      const rows = await db.select().from(pgSchema.traderGuardianAssessmentsV2).where(and(
        eq(pgSchema.traderGuardianAssessmentsV2.organizationId, scoped.organizationId),
        eq(pgSchema.traderGuardianAssessmentsV2.assessmentId, assessmentId),
      )).limit(1);
      return rows[0] ? mapRow(rows[0]) : null;
    },
    async listByLot(context, lotId) {
      const scoped = requireOrgContext(context.organizationId);
      const rows = await db.select().from(pgSchema.traderGuardianAssessmentsV2).where(and(
        eq(pgSchema.traderGuardianAssessmentsV2.organizationId, scoped.organizationId),
        eq(pgSchema.traderGuardianAssessmentsV2.lotId, lotId),
      ));
      return rows.map(mapRow).sort((left, right) => left.assessmentId.localeCompare(right.assessmentId));
    },
  };
}

