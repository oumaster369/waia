import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, eq } from "drizzle-orm";

import { traderRuntimeAuthorityAssessmentsV2 } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

import {
  parseRuntimeAuthorityAssessmentV2,
  serializeRuntimeAuthorityAssessmentV2,
  type RuntimeAuthorityAssessmentV2,
} from "./runtime-authority-assessment-v2";
import {
  RuntimeAuthorityPersistenceConflictV2,
  type RuntimeAuthorityAssessmentRepositoryV2,
} from "./runtime-authority-repository-v2";

function mapRow(row: typeof traderRuntimeAuthorityAssessmentsV2.$inferSelect): RuntimeAuthorityAssessmentV2 {
  const value = parseRuntimeAuthorityAssessmentV2(row.canonicalJson);
  if (
    value.assessmentId !== row.assessmentId ||
    value.organizationId !== row.organizationId ||
    value.runtimeInstanceId !== row.runtimeInstanceId ||
    value.posture !== row.posture ||
    value.contentDigest !== row.contentDigest
  ) {
    throw new RuntimeAuthorityPersistenceConflictV2();
  }
  return value;
}

export function createSqliteRuntimeAuthorityAssessmentRepositoryV2(
  db: WaiaDb,
): RuntimeAuthorityAssessmentRepositoryV2 {
  return {
    async append(context, assessment) {
      const scoped = requireOrgContext(context.organizationId);
      if (assessment.organizationId !== scoped.organizationId) {
        throw new Error("RUNTIME_AUTHORITY_TENANT_MISMATCH");
      }
      const canonicalJson = serializeRuntimeAuthorityAssessmentV2(assessment);
      await db.insert(traderRuntimeAuthorityAssessmentsV2).values({
        assessmentId: assessment.assessmentId,
        organizationId: scoped.organizationId,
        runtimeInstanceId: assessment.runtimeInstanceId,
        posture: assessment.posture,
        contentDigest: assessment.contentDigest,
        canonicalJson,
        adjudicatedAtUtc: assessment.adjudicatedAtUtc,
      }).onConflictDoNothing();
      const stored = await this.getById(scoped, assessment.assessmentId);
      if (!stored || serializeRuntimeAuthorityAssessmentV2(stored) !== canonicalJson) {
        throw new RuntimeAuthorityPersistenceConflictV2();
      }
      return stored;
    },
    async getById(context, assessmentId) {
      const scoped = requireOrgContext(context.organizationId);
      const rows = await db.select().from(traderRuntimeAuthorityAssessmentsV2).where(and(
        eq(traderRuntimeAuthorityAssessmentsV2.organizationId, scoped.organizationId),
        eq(traderRuntimeAuthorityAssessmentsV2.assessmentId, assessmentId),
      )).limit(1);
      return rows[0] ? mapRow(rows[0]) : null;
    },
    async listByRuntime(context, runtimeInstanceId) {
      const scoped = requireOrgContext(context.organizationId);
      const rows = await db.select().from(traderRuntimeAuthorityAssessmentsV2).where(and(
        eq(traderRuntimeAuthorityAssessmentsV2.organizationId, scoped.organizationId),
        eq(traderRuntimeAuthorityAssessmentsV2.runtimeInstanceId, runtimeInstanceId),
      ));
      return rows.map(mapRow).sort((left, right) => left.assessmentId.localeCompare(right.assessmentId));
    },
  };
}
