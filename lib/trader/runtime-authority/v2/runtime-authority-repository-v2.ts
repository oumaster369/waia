import type { OrgContext } from "@/lib/waia-core/scope/org-context";

import {
  serializeRuntimeAuthorityAssessmentV2,
  type RuntimeAuthorityAssessmentV2,
} from "./runtime-authority-assessment-v2";

export class RuntimeAuthorityPersistenceConflictV2 extends Error {
  constructor() {
    super("RUNTIME_AUTHORITY_PERSISTENCE_CONFLICT");
  }
}

export interface RuntimeAuthorityAssessmentRepositoryV2 {
  append(
    context: OrgContext,
    assessment: RuntimeAuthorityAssessmentV2,
  ): Promise<RuntimeAuthorityAssessmentV2>;
  getById(context: OrgContext, assessmentId: string): Promise<RuntimeAuthorityAssessmentV2 | null>;
  listByRuntime(context: OrgContext, runtimeInstanceId: string): Promise<readonly RuntimeAuthorityAssessmentV2[]>;
  listByOrganization(context: OrgContext): Promise<readonly RuntimeAuthorityAssessmentV2[]>;
}

export function createInMemoryRuntimeAuthorityAssessmentRepositoryV2(): RuntimeAuthorityAssessmentRepositoryV2 {
  const rows = new Map<string, RuntimeAuthorityAssessmentV2>();
  return {
    async append(context, assessment) {
      if (assessment.organizationId !== context.organizationId) {
        throw new Error("RUNTIME_AUTHORITY_TENANT_MISMATCH");
      }
      const key = `${context.organizationId}:${assessment.assessmentId}`;
      const existing = rows.get(key);
      if (existing && serializeRuntimeAuthorityAssessmentV2(existing) !== serializeRuntimeAuthorityAssessmentV2(assessment)) {
        throw new RuntimeAuthorityPersistenceConflictV2();
      }
      rows.set(key, existing ?? assessment);
      return rows.get(key)!;
    },
    async getById(context, assessmentId) {
      return rows.get(`${context.organizationId}:${assessmentId}`) ?? null;
    },
    async listByRuntime(context, runtimeInstanceId) {
      return [...rows.values()]
        .filter((row) => row.organizationId === context.organizationId && row.runtimeInstanceId === runtimeInstanceId)
        .sort((left, right) => left.assessmentId.localeCompare(right.assessmentId));
    },
    async listByOrganization(context) {
      return [...rows.values()].filter((row) => row.organizationId === context.organizationId);
    },
  };
}

export type RuntimeControlLeaseClaimV2 = Readonly<{
  organizationId: string;
  runtimeInstanceId: string;
  leaseEpoch: number;
  leaseContentDigest: string;
  validUntilUtc: string;
  adjudicatedAtUtc: string;
  expectedPreviousDigest: string | null;
}>;

export function validateRuntimeControlLeaseClaimV2(value: RuntimeControlLeaseClaimV2): void {
  const now = Date.parse(value.adjudicatedAtUtc);
  const expiry = Date.parse(value.validUntilUtc);
  if (!Number.isFinite(now) || !Number.isFinite(expiry) || expiry <= now) {
    throw new Error("RUNTIME_CONTROL_LEASE_INVALID_TIME");
  }
  if (!Number.isSafeInteger(value.leaseEpoch) || value.leaseEpoch < 1) {
    throw new Error("RUNTIME_CONTROL_LEASE_INVALID_EPOCH");
  }
}

export interface RuntimeControlLeaseRepositoryV2 {
  claimExclusive(value: RuntimeControlLeaseClaimV2): Promise<"CLAIMED" | "CONFLICT">;
  current(organizationId: string): Promise<RuntimeControlLeaseClaimV2 | null>;
  assertCurrentHolder(value: Pick<RuntimeControlLeaseClaimV2, "organizationId" | "runtimeInstanceId" | "leaseEpoch" | "leaseContentDigest" | "adjudicatedAtUtc">): Promise<void>;
}

export function createInMemoryRuntimeControlLeaseRepositoryV2(): RuntimeControlLeaseRepositoryV2 {
  const claims = new Map<string, RuntimeControlLeaseClaimV2>();
  return {
    async claimExclusive(value) {
      const current = claims.get(value.organizationId);
      validateRuntimeControlLeaseClaimV2(value);
      const now = Date.parse(value.adjudicatedAtUtc);
      if (!current) {
        if (value.leaseEpoch !== 1 || value.expectedPreviousDigest !== null) return "CONFLICT";
      } else {
        const currentExpiry = Date.parse(current.validUntilUtc);
        if (
          now <= currentExpiry ||
          value.leaseEpoch !== current.leaseEpoch + 1 ||
          value.expectedPreviousDigest !== current.leaseContentDigest
        ) return "CONFLICT";
      }
      claims.set(value.organizationId, Object.freeze({ ...value }));
      return "CLAIMED";
    },
    async current(organizationId) {
      return claims.get(organizationId) ?? null;
    },
    async assertCurrentHolder(value) {
      const current = claims.get(value.organizationId);
      const now = Date.parse(value.adjudicatedAtUtc);
      if (
        !current ||
        current.runtimeInstanceId !== value.runtimeInstanceId ||
        current.leaseEpoch !== value.leaseEpoch ||
        current.leaseContentDigest !== value.leaseContentDigest ||
        !Number.isFinite(now) ||
        now > Date.parse(current.validUntilUtc)
      ) throw new Error("RUNTIME_CONTROL_LEASE_STALE_HOLDER");
    },
  };
}
