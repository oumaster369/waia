import { randomUUID } from "node:crypto";

import type postgres from "postgres";

import { orgScopedPostgresPredicate } from "@/lib/waia-core/scope/org-context";
import { assertHtxVolumeAuthorityQualified } from "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";
import type { HtxVolumeQualificationReceiptV1 } from "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";
import { loadQualifiedHtxVolumeAuthorityForOrganization } from "@/lib/trader/market-data/volume-qualification/htx-volume-qualification-receipt-service";

import {
  buildScientificAdmissionReceiptV1,
  SCIENTIFIC_ADMISSION_RECEIPT_VERSION,
  type KmConvergenceReceipt,
} from "./km-convergence-gate-v1";

/**
 * DEE-532 / WP-EXECOPP-QUAL — scientific admission receipt persistence.
 *
 * This receipt proves epistemic KM-convergence qualification only (H-series scientific
 * admission). It NEVER emits `FROZEN_SELECTED_PACKAGE_READY` and NEVER authorizes capital
 * deployment on its own — H3 (economic admission via decision-economics-v2) remains a
 * separate, unmet gate. BLOCKED HTX volume authority (DEE-526) fails closed here: neither
 * build nor persist is reachable without a QUALIFIED volume receipt.
 */

export { SCIENTIFIC_ADMISSION_RECEIPT_VERSION };

export type ScientificAdmissionWfPartition = "WF_PREDICTIVE";

export type BuildScientificAdmissionReceiptRecordInput = {
  organizationId: string;
  kmConvergenceReceipt: KmConvergenceReceipt;
  wfPartition: ScientificAdmissionWfPartition;
  /** Capital gate (DEE-526): must be verdict=HTX_VOLUME_AUTHORITY_QUALIFIED or this throws. */
  htxVolumeQualificationReceipt: HtxVolumeQualificationReceiptV1;
};

export type ScientificAdmissionReceiptRecord = {
  id: string;
  organizationId: string;
  receiptKind: string;
  kmGlobalAnchorSetDigest: string;
  replicaRootFamilyIdentityDigest: string;
  selectedKConfigDec: number | null;
  selectedMConfigDec: number | null;
  alphaEpiConfigScale8: string;
  selectedPackageGenerationIdentityDigest: string | null;
  selectedPackageContentDigest: string | null;
  evidenceSemanticDigest: string;
  receiptJson: string;
  contentDigest: string;
  schemaVersion: typeof SCIENTIFIC_ADMISSION_RECEIPT_VERSION;
  /**
   * Bound HTX volume qualification receipt digest (DEE-526).
   * Persist re-asserts QUALIFIED via org-scoped durable load — never trusts caller alone.
   */
  htxVolumeQualificationReceiptDigest: string;
};

/**
 * Build the immutable scientific-admission-receipt record. Fails closed on:
 *  - HTX volume authority not QUALIFIED (`assertHtxVolumeAuthorityQualified`, DEE-526)
 *  - KM convergence receipt terminal status not QUALIFIED (`buildScientificAdmissionReceiptV1`)
 */
export function buildScientificAdmissionReceiptRecordV1(
  input: BuildScientificAdmissionReceiptRecordInput,
): ScientificAdmissionReceiptRecord {
  assertHtxVolumeAuthorityQualified(input.htxVolumeQualificationReceipt);

  const { contentDigest, receiptJson } = buildScientificAdmissionReceiptV1({
    organizationId: input.organizationId,
    kmConvergenceReceipt: input.kmConvergenceReceipt,
    wfPartition: input.wfPartition,
  });

  const receipt = input.kmConvergenceReceipt;

  return {
    id: randomUUID(),
    organizationId: input.organizationId,
    receiptKind: input.wfPartition,
    kmGlobalAnchorSetDigest: receipt.kmGlobalAnchorSetDigestHex,
    replicaRootFamilyIdentityDigest: receipt.replicaRootFamilyIdentityDigestHex,
    selectedKConfigDec: receipt.selectedK,
    selectedMConfigDec: receipt.selectedM,
    alphaEpiConfigScale8: receipt.alphaEpiConfigScale8,
    selectedPackageGenerationIdentityDigest: receipt.selectedPackageGenerationIdentityDigestHex,
    selectedPackageContentDigest: receipt.selectedPackageContentDigestHex,
    evidenceSemanticDigest: receipt.evidenceSemanticDigestHex,
    receiptJson,
    contentDigest,
    schemaVersion: SCIENTIFIC_ADMISSION_RECEIPT_VERSION,
    htxVolumeQualificationReceiptDigest:
      input.htxVolumeQualificationReceipt.qualificationReceiptDigest,
  };
}

export class ScientificAdmissionReceiptConflictError extends Error {
  readonly code = "SCIENTIFIC_ADMISSION_RECEIPT_CONFLICT" as const;

  constructor(message: string) {
    super(message);
    this.name = "ScientificAdmissionReceiptConflictError";
  }
}

async function loadExistingReceipt(
  sql: postgres.Sql,
  organizationId: string,
  evidenceSemanticDigest: string,
): Promise<{ id: string; contentDigest: string } | null> {
  const rows = await sql<{ id: string; content_digest: string }[]>`
    SELECT id::text AS id, content_digest
    FROM trader_scientific_admission_receipt_v1
    WHERE ${orgScopedPostgresPredicate(sql, organizationId)}
      AND evidence_semantic_digest = ${evidenceSemanticDigest}
  `;
  const row = rows[0];
  return row ? { id: row.id, contentDigest: row.content_digest } : null;
}

export type PersistScientificAdmissionReceiptResult = { id: string; insertedNew: boolean };

/**
 * Append-only persist, natural-idempotent on (organization_id, evidence_semantic_digest).
 * Fails closed on any conflicting content for the same natural identity
 * (`tsar_v1_org_evidence_digest_uq`).
 *
 * DEE-526: re-asserts org-bound HTX_VOLUME_AUTHORITY_QUALIFIED from durable storage
 * before INSERT. Hand-built records cannot bypass volume authority.
 */
export async function persistScientificAdmissionReceiptV1(
  sql: postgres.Sql,
  record: ScientificAdmissionReceiptRecord,
): Promise<PersistScientificAdmissionReceiptResult> {
  if (!record.htxVolumeQualificationReceiptDigest?.trim()) {
    throw new Error(
      "[scientific-admission-receipt] HTX volume qualification receipt digest required for persist",
    );
  }
  // Durable org-scoped QUALIFIED re-assert — never trust caller-supplied "qualified".
  await loadQualifiedHtxVolumeAuthorityForOrganization(sql, {
    organizationId: record.organizationId,
    qualificationReceiptDigest: record.htxVolumeQualificationReceiptDigest,
  });

  const existing = await loadExistingReceipt(
    sql,
    record.organizationId,
    record.evidenceSemanticDigest,
  );
  if (existing) {
    if (existing.contentDigest !== record.contentDigest) {
      throw new ScientificAdmissionReceiptConflictError(
        "[scientific-admission-receipt] natural-idempotent conflict: same evidence semantic digest, different content",
      );
    }
    return { id: existing.id, insertedNew: false };
  }

  try {
    await sql`
      INSERT INTO trader_scientific_admission_receipt_v1 (
        id,
        organization_id,
        receipt_kind,
        km_global_anchor_set_digest,
        replica_root_family_identity_digest,
        selected_k_config_dec,
        selected_m_config_dec,
        alpha_epi_config_scale8,
        selected_package_generation_identity_digest,
        selected_package_content_digest,
        evidence_semantic_digest,
        receipt_json,
        content_digest,
        schema_version
      ) VALUES (
        ${record.id}::uuid,
        ${record.organizationId}::uuid,
        ${record.receiptKind},
        ${record.kmGlobalAnchorSetDigest},
        ${record.replicaRootFamilyIdentityDigest},
        ${record.selectedKConfigDec},
        ${record.selectedMConfigDec},
        ${record.alphaEpiConfigScale8},
        ${record.selectedPackageGenerationIdentityDigest},
        ${record.selectedPackageContentDigest},
        ${record.evidenceSemanticDigest},
        ${record.receiptJson},
        ${record.contentDigest},
        ${record.schemaVersion}
      )
    `;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("tsar_v1_org_evidence_digest_uq")) {
      const raced = await loadExistingReceipt(
        sql,
        record.organizationId,
        record.evidenceSemanticDigest,
      );
      if (raced) {
        if (raced.contentDigest !== record.contentDigest) {
          throw new ScientificAdmissionReceiptConflictError(
            "[scientific-admission-receipt] natural-idempotent conflict: same evidence semantic digest, different content",
          );
        }
        return { id: raced.id, insertedNew: false };
      }
    }
    throw error;
  }

  return { id: record.id, insertedNew: true };
}

export async function readScientificAdmissionReceiptV1(
  sql: postgres.Sql,
  input: { organizationId: string; evidenceSemanticDigestHex: string },
): Promise<ScientificAdmissionReceiptRecord | null> {
  const rows = await sql<
    {
      id: string;
      organization_id: string;
      receipt_kind: string;
      km_global_anchor_set_digest: string;
      replica_root_family_identity_digest: string;
      selected_k_config_dec: number | null;
      selected_m_config_dec: number | null;
      alpha_epi_config_scale8: string;
      selected_package_generation_identity_digest: string | null;
      selected_package_content_digest: string | null;
      evidence_semantic_digest: string;
      receipt_json: string;
      content_digest: string;
      schema_version: string;
    }[]
  >`
    SELECT
      id::text AS id,
      organization_id::text AS organization_id,
      receipt_kind,
      km_global_anchor_set_digest,
      replica_root_family_identity_digest,
      selected_k_config_dec,
      selected_m_config_dec,
      alpha_epi_config_scale8,
      selected_package_generation_identity_digest,
      selected_package_content_digest,
      evidence_semantic_digest,
      receipt_json,
      content_digest,
      schema_version
    FROM trader_scientific_admission_receipt_v1
    WHERE ${orgScopedPostgresPredicate(sql, input.organizationId)}
      AND evidence_semantic_digest = ${input.evidenceSemanticDigestHex}
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    receiptKind: row.receipt_kind,
    kmGlobalAnchorSetDigest: row.km_global_anchor_set_digest,
    replicaRootFamilyIdentityDigest: row.replica_root_family_identity_digest,
    selectedKConfigDec: row.selected_k_config_dec,
    selectedMConfigDec: row.selected_m_config_dec,
    alphaEpiConfigScale8: row.alpha_epi_config_scale8,
    selectedPackageGenerationIdentityDigest: row.selected_package_generation_identity_digest,
    selectedPackageContentDigest: row.selected_package_content_digest,
    evidenceSemanticDigest: row.evidence_semantic_digest,
    receiptJson: row.receipt_json,
    contentDigest: row.content_digest,
    schemaVersion: row.schema_version as typeof SCIENTIFIC_ADMISSION_RECEIPT_VERSION,
    // Volume digest is not a durable admission-table column; persist requires it on write.
    htxVolumeQualificationReceiptDigest: "",
  };
}

/**
 * Scientific admission (KM-convergence + Holm-qualified challenger) is epistemic evidence
 * only. It never emits FROZEN_SELECTED_PACKAGE_READY and never authorizes capital
 * deployment by itself — H3 (economic admission) remains a separate, unmet gate.
 */
export function assertScientificAdmissionDoesNotAuthorizeCapital(input: {
  schemaVersion: string;
  claimsCapitalAuthority?: boolean;
  emitsFrozenSelectedPackageReady?: boolean;
}): void {
  if (input.schemaVersion !== SCIENTIFIC_ADMISSION_RECEIPT_VERSION) {
    throw new Error(
      `[scientific-admission-receipt] unexpected schema_version=${input.schemaVersion}`,
    );
  }
  if (input.claimsCapitalAuthority) {
    throw new Error(
      "[scientific-admission-receipt] scientific admission cannot claim capital authority on its own",
    );
  }
  if (input.emitsFrozenSelectedPackageReady) {
    throw new Error(
      "[scientific-admission-receipt] this path never emits FROZEN_SELECTED_PACKAGE_READY (H3 unmet)",
    );
  }
}

export class ScientificAdmissionReceiptTenantIsolationError extends Error {
  readonly code = "SCIENTIFIC_ADMISSION_TENANT_ISOLATION" as const;

  constructor(message: string) {
    super(message);
    this.name = "ScientificAdmissionReceiptTenantIsolationError";
  }
}

/**
 * Organization-scoped authority load. Wrong-org digest fails closed — never treated as
 * "missing but acceptable" for V2 capital/admission consumption.
 */
export async function requireScientificAdmissionReceiptForOrganization(
  sql: postgres.Sql,
  input: { organizationId: string; evidenceSemanticDigestHex: string },
): Promise<ScientificAdmissionReceiptRecord> {
  const record = await readScientificAdmissionReceiptV1(sql, input);
  if (!record) {
    throw new ScientificAdmissionReceiptTenantIsolationError(
      `[scientific-admission-receipt] receipt not found for organization=${input.organizationId}`,
    );
  }
  if (record.organizationId !== input.organizationId) {
    throw new ScientificAdmissionReceiptTenantIsolationError(
      "[scientific-admission-receipt] organization mismatch on receipt load",
    );
  }
  return record;
}
