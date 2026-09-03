import { randomUUID } from "node:crypto";

import type postgres from "postgres";

import { orgScopedPostgresPredicate } from "@/lib/waia-core/scope/org-context";

import {
  INTERNAL_buildScientificAdmissionFourSurfaceV2,
  INTERNAL_requireScientificAdmissionFourSurfaceV2,
  SCIENTIFIC_ADMISSION_FOUR_SURFACE_RECEIPT_KIND_V2,
  SCIENTIFIC_ADMISSION_FOUR_SURFACE_V2,
  type INTERNAL_ClosedKmFourSurfaceProductionAuthorityV2,
  type ScientificAdmissionFourSurfaceExpectedV2,
  type ScientificAdmissionFourSurfaceReceiptV2 as ContractScientificAdmissionFourSurfaceReceiptV2,
} from "./scientific-admission-four-surface-v2";

/** Safe durable-replay result type; this does not re-export structural build authority. */
export type ScientificAdmissionFourSurfaceReceiptV2 =
  ContractScientificAdmissionFourSurfaceReceiptV2;

type ScientificAdmissionFourSurfaceRecordV2 = Readonly<{
  id: string;
  organizationId: string;
  receiptKind: typeof SCIENTIFIC_ADMISSION_FOUR_SURFACE_RECEIPT_KIND_V2;
  kmGlobalAnchorSetDigest: string;
  aggregateFamilySetDigest: string;
  selectedKConfigDec: null;
  selectedMConfigDec: null;
  alphaEpiConfigScale8: string;
  selectedPackageGenerationIdentityDigest: null;
  selectedPackageContentDigest: null;
  evidenceSemanticDigest: string;
  receiptJson: string;
  contentDigest: string;
  schemaVersion: typeof SCIENTIFIC_ADMISSION_FOUR_SURFACE_V2;
}>;

type DurableRow = Readonly<{
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
}>;

export class ScientificAdmissionFourSurfaceConflictError extends Error {
  readonly code = "SCIENTIFIC_ADMISSION_FOUR_SURFACE_CONFLICT" as const;

  constructor(message: string) {
    super(message);
    this.name = "ScientificAdmissionFourSurfaceConflictError";
  }
}

function buildScientificAdmissionFourSurfaceRecordV2(
  authority: INTERNAL_ClosedKmFourSurfaceProductionAuthorityV2,
): ScientificAdmissionFourSurfaceRecordV2 {
  const receipt = INTERNAL_buildScientificAdmissionFourSurfaceV2(authority);
  return Object.freeze({
    id: randomUUID(),
    organizationId: receipt.organizationId,
    receiptKind: SCIENTIFIC_ADMISSION_FOUR_SURFACE_RECEIPT_KIND_V2,
    kmGlobalAnchorSetDigest: receipt.kmGlobalAnchorSetDigestHex,
    aggregateFamilySetDigest: receipt.aggregateFamilySetDigestHex,
    selectedKConfigDec: null,
    selectedMConfigDec: null,
    alphaEpiConfigScale8: receipt.alphaEpiConfigScale8,
    selectedPackageGenerationIdentityDigest: null,
    selectedPackageContentDigest: null,
    evidenceSemanticDigest: receipt.evidenceSemanticDigestHex,
    receiptJson: JSON.stringify(receipt),
    contentDigest: receipt.contentDigestHex,
    schemaVersion: SCIENTIFIC_ADMISSION_FOUR_SURFACE_V2,
  });
}

function rebuildRecord(record: ScientificAdmissionFourSurfaceRecordV2):
ScientificAdmissionFourSurfaceRecordV2 {
  let parsed: ScientificAdmissionFourSurfaceReceiptV2;
  try {
    parsed = JSON.parse(record.receiptJson) as ScientificAdmissionFourSurfaceReceiptV2;
  } catch {
    throw new Error("SCIENTIFIC_ADMISSION_FOUR_SURFACE_RECORD_JSON");
  }
  const rebuilt = INTERNAL_buildScientificAdmissionFourSurfaceV2(parsed.sourceAuthority);
  const expected = buildScientificAdmissionFourSurfaceRecordV2(parsed.sourceAuthority);
  const comparable = { ...expected, id: record.id };
  if (JSON.stringify(rebuilt) !== record.receiptJson || JSON.stringify(comparable) !== JSON.stringify(record)) {
    throw new Error("SCIENTIFIC_ADMISSION_FOUR_SURFACE_RECORD_CONTENT_MISMATCH");
  }
  return record;
}

function isExpectedUniqueConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const pg = error as { code?: unknown; constraint_name?: unknown };
  return pg.code === "23505" && pg.constraint_name === "tsar_v1_org_evidence_digest_uq";
}

function rowMatchesRecord(row: DurableRow, record: ScientificAdmissionFourSurfaceRecordV2): boolean {
  return (
    row.organization_id === record.organizationId &&
    row.receipt_kind === record.receiptKind &&
    row.km_global_anchor_set_digest === record.kmGlobalAnchorSetDigest &&
    row.replica_root_family_identity_digest === record.aggregateFamilySetDigest &&
    row.selected_k_config_dec === null && row.selected_m_config_dec === null &&
    row.alpha_epi_config_scale8 === record.alphaEpiConfigScale8 &&
    row.selected_package_generation_identity_digest === null &&
    row.selected_package_content_digest === null &&
    row.evidence_semantic_digest === record.evidenceSemanticDigest &&
    row.receipt_json === record.receiptJson &&
    row.content_digest === record.contentDigest &&
    row.schema_version === record.schemaVersion
  );
}

async function loadNaturalIdentity(
  sql: postgres.Sql,
  record: Pick<ScientificAdmissionFourSurfaceRecordV2, "organizationId" | "evidenceSemanticDigest">,
): Promise<DurableRow | null> {
  const rows = await sql<DurableRow[]>`
    SELECT id::text AS id, organization_id::text AS organization_id, receipt_kind,
      km_global_anchor_set_digest, replica_root_family_identity_digest,
      selected_k_config_dec, selected_m_config_dec, alpha_epi_config_scale8,
      selected_package_generation_identity_digest, selected_package_content_digest,
      evidence_semantic_digest, receipt_json, content_digest, schema_version
    FROM trader_scientific_admission_receipt_v1
    WHERE ${orgScopedPostgresPredicate(sql, record.organizationId)}
      AND schema_version = ${SCIENTIFIC_ADMISSION_FOUR_SURFACE_V2}
      AND evidence_semantic_digest = ${record.evidenceSemanticDigest}
  `;
  if (rows.length > 1) {
    throw new Error("SCIENTIFIC_ADMISSION_FOUR_SURFACE_DURABLE_IDENTITY_AMBIGUOUS");
  }
  return rows[0] ?? null;
}

export async function INTERNAL_persistScientificAdmissionFourSurfaceV2(
  sql: postgres.Sql,
  authority: INTERNAL_ClosedKmFourSurfaceProductionAuthorityV2,
): Promise<{ id: string; insertedNew: boolean; receipt: ScientificAdmissionFourSurfaceReceiptV2 }> {
  const record = rebuildRecord(buildScientificAdmissionFourSurfaceRecordV2(authority));
  const existing = await loadNaturalIdentity(sql, record);
  if (existing) {
    if (!rowMatchesRecord(existing, record)) {
      throw new ScientificAdmissionFourSurfaceConflictError(
        "SCIENTIFIC_ADMISSION_FOUR_SURFACE_NATURAL_IDENTITY_CONFLICT",
      );
    }
    return { id: existing.id, insertedNew: false,
      receipt: JSON.parse(record.receiptJson) as ScientificAdmissionFourSurfaceReceiptV2 };
  }
  try {
    await sql`
      INSERT INTO trader_scientific_admission_receipt_v1 (
        id, organization_id, receipt_kind, km_global_anchor_set_digest,
        replica_root_family_identity_digest, selected_k_config_dec, selected_m_config_dec,
        alpha_epi_config_scale8, selected_package_generation_identity_digest,
        selected_package_content_digest, evidence_semantic_digest, receipt_json,
        content_digest, schema_version
      ) VALUES (
        ${record.id}::uuid, ${record.organizationId}::uuid, ${record.receiptKind},
        ${record.kmGlobalAnchorSetDigest}, ${record.aggregateFamilySetDigest}, NULL, NULL,
        ${record.alphaEpiConfigScale8}, NULL, NULL, ${record.evidenceSemanticDigest},
        ${record.receiptJson}, ${record.contentDigest}, ${record.schemaVersion}
      )
    `;
  } catch (error) {
    if (!isExpectedUniqueConflict(error)) throw error;
    const raced = await loadNaturalIdentity(sql, record);
    if (raced && rowMatchesRecord(raced, record)) {
      return { id: raced.id, insertedNew: false,
        receipt: JSON.parse(record.receiptJson) as ScientificAdmissionFourSurfaceReceiptV2 };
    }
    throw new ScientificAdmissionFourSurfaceConflictError(
      "SCIENTIFIC_ADMISSION_FOUR_SURFACE_NATURAL_IDENTITY_CONFLICT",
    );
  }
  return { id: record.id, insertedNew: true,
    receipt: JSON.parse(record.receiptJson) as ScientificAdmissionFourSurfaceReceiptV2 };
}

export async function requireScientificAdmissionFourSurfaceForOrganizationV2(
  sql: postgres.Sql,
  expected: ScientificAdmissionFourSurfaceExpectedV2,
): Promise<ScientificAdmissionFourSurfaceReceiptV2> {
  const row = await loadNaturalIdentity(sql, {
    organizationId: expected.organizationId,
    evidenceSemanticDigest: expected.evidenceSemanticDigestHex,
  });
  if (!row) throw new Error("SCIENTIFIC_ADMISSION_FOUR_SURFACE_NOT_FOUND_FOR_ORGANIZATION");
  let receipt: ScientificAdmissionFourSurfaceReceiptV2;
  try {
    receipt = JSON.parse(row.receipt_json) as ScientificAdmissionFourSurfaceReceiptV2;
  } catch {
    throw new Error("SCIENTIFIC_ADMISSION_FOUR_SURFACE_DURABLE_JSON");
  }
  const rebuiltRecord = buildScientificAdmissionFourSurfaceRecordV2(receipt.sourceAuthority);
  if (!rowMatchesRecord(row, rebuiltRecord)) {
    throw new Error("SCIENTIFIC_ADMISSION_FOUR_SURFACE_DURABLE_CONTENT_MISMATCH");
  }
  return INTERNAL_requireScientificAdmissionFourSurfaceV2(receipt, expected);
}
