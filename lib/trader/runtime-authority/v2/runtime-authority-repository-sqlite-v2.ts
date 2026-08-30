import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, eq } from "drizzle-orm";
import type Database from "better-sqlite3";

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
  validateRuntimeControlLeaseClaimV2,
  type RuntimeControlLeaseClaimV2,
  type RuntimeControlLeaseRepositoryV2,
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

type LeaseHeadRow = {
  organization_id: string;
  runtime_instance_id: string;
  lease_epoch: number;
  content_digest: string;
  valid_until_utc: string;
};

function mapLeaseHead(row: LeaseHeadRow): RuntimeControlLeaseClaimV2 {
  return Object.freeze({
    organizationId: row.organization_id,
    runtimeInstanceId: row.runtime_instance_id,
    leaseEpoch: row.lease_epoch,
    leaseContentDigest: row.content_digest,
    validUntilUtc: row.valid_until_utc,
    adjudicatedAtUtc: "",
    expectedPreviousDigest: null,
  });
}

/** Uses the native handle because Drizzle's SQLite transaction starts deferred, not IMMEDIATE. */
export function createSqliteRuntimeControlLeaseRepositoryV2(
  sqlite: Database.Database,
  testing?: { afterHistoryInsert?: () => void },
): RuntimeControlLeaseRepositoryV2 {
  const selectHead = sqlite.prepare("SELECT organization_id, runtime_instance_id, lease_epoch, content_digest, valid_until_utc FROM trader_runtime_control_lease_heads_v2 WHERE organization_id = ?");
  const insertHistory = sqlite.prepare("INSERT INTO trader_runtime_control_lease_epoch_history_v2 (content_digest, organization_id, runtime_instance_id, lease_epoch, prior_content_digest, valid_until_utc, adjudicated_at_utc, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const insertHead = sqlite.prepare("INSERT INTO trader_runtime_control_lease_heads_v2 (organization_id, runtime_instance_id, lease_epoch, content_digest, valid_until_utc, updated_at) VALUES (?, ?, ?, ?, ?, ?)");
  const updateHead = sqlite.prepare("UPDATE trader_runtime_control_lease_heads_v2 SET runtime_instance_id = ?, lease_epoch = ?, content_digest = ?, valid_until_utc = ?, updated_at = ? WHERE organization_id = ? AND lease_epoch = ? AND content_digest = ?");

  return {
    async claimExclusive(value) {
      validateRuntimeControlLeaseClaimV2(value);
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const head = selectHead.get(value.organizationId) as LeaseHeadRow | undefined;
        const admissible = head
          ? Date.parse(value.adjudicatedAtUtc) > Date.parse(head.valid_until_utc) &&
            value.leaseEpoch === head.lease_epoch + 1 &&
            value.expectedPreviousDigest === head.content_digest
          : value.leaseEpoch === 1 && value.expectedPreviousDigest === null;
        if (!admissible) {
          sqlite.exec("ROLLBACK");
          return "CONFLICT";
        }
        const nowMs = Date.parse(value.adjudicatedAtUtc);
        insertHistory.run(value.leaseContentDigest, value.organizationId, value.runtimeInstanceId,
          value.leaseEpoch, value.expectedPreviousDigest, value.validUntilUtc, value.adjudicatedAtUtc, nowMs);
        testing?.afterHistoryInsert?.();
        if (head) {
          const changed = updateHead.run(value.runtimeInstanceId, value.leaseEpoch, value.leaseContentDigest,
            value.validUntilUtc, nowMs, value.organizationId, head.lease_epoch, head.content_digest).changes;
          if (changed !== 1) throw new Error("RUNTIME_CONTROL_LEASE_CAS_LOST");
        } else {
          insertHead.run(value.organizationId, value.runtimeInstanceId, value.leaseEpoch,
            value.leaseContentDigest, value.validUntilUtc, nowMs);
        }
        sqlite.exec("COMMIT");
        return "CLAIMED";
      } catch (error) {
        if (sqlite.inTransaction) sqlite.exec("ROLLBACK");
        const code = (error as { code?: string }).code;
        if (code?.startsWith("SQLITE_CONSTRAINT")) return "CONFLICT";
        throw error;
      }
    },
    async current(organizationId) {
      const row = selectHead.get(organizationId) as LeaseHeadRow | undefined;
      return row ? mapLeaseHead(row) : null;
    },
    async assertCurrentHolder(value) {
      const row = selectHead.get(value.organizationId) as LeaseHeadRow | undefined;
      const trustedNow = Date.parse(value.adjudicatedAtUtc);
      if (!row || row.runtime_instance_id !== value.runtimeInstanceId || row.lease_epoch !== value.leaseEpoch ||
        row.content_digest !== value.leaseContentDigest || !Number.isFinite(trustedNow) || trustedNow > Date.parse(row.valid_until_utc)) {
        throw new Error("RUNTIME_CONTROL_LEASE_STALE_HOLDER");
      }
    },
  };
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
