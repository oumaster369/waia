import { createHash, randomUUID } from "node:crypto";

import type postgres from "postgres";

import { orgScopedPostgresPredicate } from "@/lib/waia-core/scope/org-context";

/**
 * DEE-531 / WP-RESEARCH-HARNESS — preregistered trial registration persistence.
 *
 * The pure admission harness (`research-harness-admission-orchestrator-v1.ts`) never
 * touches Postgres. Consumers that want an append-only, tenant-scoped preregistration
 * record call `registerResearchTrialV1(sql, ...)` explicitly after running the harness.
 */

export const RESEARCH_TRIAL_REGISTRATION_SCHEMA_VERSION = "research-trial-registration/v1" as const;
export const RESEARCH_TRIAL_REGISTRATION_AUTHORITY_STATUS = "RESEARCH_ONLY" as const;

const HEX64 = /^[0-9a-f]{64}$/;

function assertHex64(value: string, field: string): void {
  if (!HEX64.test(value)) {
    throw new Error(
      `[research-trial-registration] ${field} must be a 64-char lowercase hex digest, got: ${value}`,
    );
  }
}

export type ResearchTrialRegistrationInput = {
  organizationId: string;
  trialIdentityDigestHex: string;
  modelTransformVersion: string;
  comparisonFamilyId: string;
  symbol: string;
  primaryHorizonMinutes: number;
  partitionReceiptDigestHex: string;
};

export type ResearchTrialRegistrationRecord = {
  id: string;
  organizationId: string;
  trialIdentityDigest: string;
  modelTransformVersion: string;
  comparisonFamilyId: string;
  symbol: string;
  primaryHorizonMinutes: number;
  partitionReceiptDigest: string;
  authorityStatus: typeof RESEARCH_TRIAL_REGISTRATION_AUTHORITY_STATUS;
  registrationDigest: string;
  contentDigest: string;
  schemaVersion: typeof RESEARCH_TRIAL_REGISTRATION_SCHEMA_VERSION;
};

function computeRegistrationDigest(input: ResearchTrialRegistrationInput): string {
  const body = JSON.stringify({
    schema: RESEARCH_TRIAL_REGISTRATION_SCHEMA_VERSION,
    organizationId: input.organizationId,
    trialIdentityDigest: input.trialIdentityDigestHex,
    modelTransformVersion: input.modelTransformVersion,
    comparisonFamilyId: input.comparisonFamilyId,
    symbol: input.symbol,
    primaryHorizonMinutes: input.primaryHorizonMinutes,
    partitionReceiptDigest: input.partitionReceiptDigestHex,
    authorityStatus: RESEARCH_TRIAL_REGISTRATION_AUTHORITY_STATUS,
  });
  return createHash("sha256").update(body, "utf8").digest("hex");
}

function computeContentDigest(registrationDigest: string): string {
  return createHash("sha256")
    .update(`${RESEARCH_TRIAL_REGISTRATION_SCHEMA_VERSION}\n${registrationDigest}\n`, "utf8")
    .digest("hex");
}

/** Deterministic build: identical input always yields identical digests (idempotency key material). */
export function buildResearchTrialRegistrationRecord(
  input: ResearchTrialRegistrationInput,
): ResearchTrialRegistrationRecord {
  assertHex64(input.trialIdentityDigestHex, "trialIdentityDigestHex");
  assertHex64(input.partitionReceiptDigestHex, "partitionReceiptDigestHex");

  const registrationDigest = computeRegistrationDigest(input);
  const contentDigest = computeContentDigest(registrationDigest);

  return {
    id: randomUUID(),
    organizationId: input.organizationId,
    trialIdentityDigest: input.trialIdentityDigestHex,
    modelTransformVersion: input.modelTransformVersion,
    comparisonFamilyId: input.comparisonFamilyId,
    symbol: input.symbol,
    primaryHorizonMinutes: input.primaryHorizonMinutes,
    partitionReceiptDigest: input.partitionReceiptDigestHex,
    authorityStatus: RESEARCH_TRIAL_REGISTRATION_AUTHORITY_STATUS,
    registrationDigest,
    contentDigest,
    schemaVersion: RESEARCH_TRIAL_REGISTRATION_SCHEMA_VERSION,
  };
}

export class ResearchTrialRegistrationConflictError extends Error {
  readonly code = "RESEARCH_TRIAL_REGISTRATION_CONFLICT" as const;

  constructor(message: string) {
    super(message);
    this.name = "ResearchTrialRegistrationConflictError";
  }
}

async function loadExistingRegistration(
  sql: postgres.Sql,
  organizationId: string,
  trialIdentityDigestHex: string,
): Promise<{ id: string; contentDigest: string } | null> {
  const rows = await sql<{ id: string; content_digest: string }[]>`
    SELECT id::text AS id, content_digest
    FROM trader_research_trial_registration_v1
    WHERE ${orgScopedPostgresPredicate(sql, organizationId)}
      AND trial_identity_digest = ${trialIdentityDigestHex}
  `;
  const row = rows[0];
  return row ? { id: row.id, contentDigest: row.content_digest } : null;
}

export type RegisterResearchTrialResult = { id: string; insertedNew: boolean };

/**
 * Append-only registration keyed by natural identity (organization_id, trial_identity_digest).
 * Idempotent on exact-duplicate content; fails closed on any conflicting content for the
 * same natural identity (`trtr_v1_org_trial_identity_uq`).
 */
export async function registerResearchTrialV1(
  sql: postgres.Sql,
  record: ResearchTrialRegistrationRecord,
): Promise<RegisterResearchTrialResult> {
  const existing = await loadExistingRegistration(
    sql,
    record.organizationId,
    record.trialIdentityDigest,
  );
  if (existing) {
    if (existing.contentDigest !== record.contentDigest) {
      throw new ResearchTrialRegistrationConflictError(
        "[research-trial-registration] natural-idempotent conflict: same trial identity, different content",
      );
    }
    return { id: existing.id, insertedNew: false };
  }

  try {
    await sql`
      INSERT INTO trader_research_trial_registration_v1 (
        id,
        organization_id,
        trial_identity_digest,
        model_transform_version,
        comparison_family_id,
        symbol,
        primary_horizon_minutes,
        partition_receipt_digest,
        authority_status,
        registration_digest,
        content_digest,
        schema_version
      ) VALUES (
        ${record.id}::uuid,
        ${record.organizationId}::uuid,
        ${record.trialIdentityDigest},
        ${record.modelTransformVersion},
        ${record.comparisonFamilyId},
        ${record.symbol},
        ${record.primaryHorizonMinutes},
        ${record.partitionReceiptDigest},
        ${record.authorityStatus},
        ${record.registrationDigest},
        ${record.contentDigest},
        ${record.schemaVersion}
      )
    `;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("trtr_v1_org_trial_identity_uq")) {
      const raced = await loadExistingRegistration(
        sql,
        record.organizationId,
        record.trialIdentityDigest,
      );
      if (raced) {
        if (raced.contentDigest !== record.contentDigest) {
          throw new ResearchTrialRegistrationConflictError(
            "[research-trial-registration] natural-idempotent conflict: same trial identity, different content",
          );
        }
        return { id: raced.id, insertedNew: false };
      }
    }
    throw error;
  }

  return { id: record.id, insertedNew: true };
}

export async function readResearchTrialRegistrationV1(
  sql: postgres.Sql,
  input: { organizationId: string; trialIdentityDigestHex: string },
): Promise<ResearchTrialRegistrationRecord | null> {
  const rows = await sql<
    {
      id: string;
      organization_id: string;
      trial_identity_digest: string;
      model_transform_version: string;
      comparison_family_id: string;
      symbol: string;
      primary_horizon_minutes: number;
      partition_receipt_digest: string;
      authority_status: string;
      registration_digest: string;
      content_digest: string;
      schema_version: string;
    }[]
  >`
    SELECT
      id::text AS id,
      organization_id::text AS organization_id,
      trial_identity_digest,
      model_transform_version,
      comparison_family_id,
      symbol,
      primary_horizon_minutes,
      partition_receipt_digest,
      authority_status,
      registration_digest,
      content_digest,
      schema_version
    FROM trader_research_trial_registration_v1
    WHERE ${orgScopedPostgresPredicate(sql, input.organizationId)}
      AND trial_identity_digest = ${input.trialIdentityDigestHex}
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    trialIdentityDigest: row.trial_identity_digest,
    modelTransformVersion: row.model_transform_version,
    comparisonFamilyId: row.comparison_family_id,
    symbol: row.symbol,
    primaryHorizonMinutes: row.primary_horizon_minutes,
    partitionReceiptDigest: row.partition_receipt_digest,
    authorityStatus: row.authority_status as typeof RESEARCH_TRIAL_REGISTRATION_AUTHORITY_STATUS,
    registrationDigest: row.registration_digest,
    contentDigest: row.content_digest,
    schemaVersion: row.schema_version as typeof RESEARCH_TRIAL_REGISTRATION_SCHEMA_VERSION,
  };
}

/**
 * Registration is RESEARCH_ONLY preregistration evidence. It never authorizes capital
 * deployment on its own — economic admission (decision-economics-v2 EV gates) and the
 * KM-convergence scientific-admission receipt are separate, independently-required gates.
 */
export function assertResearchTrialRegistrationNonCapitalAuthority(input: {
  authorityStatus: string;
  claimsCapitalAuthority?: boolean;
}): void {
  if (input.authorityStatus !== RESEARCH_TRIAL_REGISTRATION_AUTHORITY_STATUS) {
    throw new Error(
      `[research-trial-registration] capital authority forbidden: authority_status must be RESEARCH_ONLY, got ${input.authorityStatus}`,
    );
  }
  if (input.claimsCapitalAuthority) {
    throw new Error(
      "[research-trial-registration] trial registration cannot claim capital authority on its own",
    );
  }
}
