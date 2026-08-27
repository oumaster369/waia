import { randomUUID } from "node:crypto";

import type postgres from "postgres";

import { assertHtxVolumeAuthorityQualified } from "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";
import type { HtxVolumeQualificationReceiptV1 } from "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";
import { loadQualifiedHtxVolumeAuthorityForOrganization } from "@/lib/trader/market-data/volume-qualification/htx-volume-qualification-receipt-service";
import { orgScopedPostgresPredicate } from "@/lib/waia-core/scope/org-context";

import {
  buildScientificAdmissionReceiptV2,
  computeScientificAdmissionEvidenceSemanticDigestV2,
  requireScientificAdmissionV2,
  SCIENTIFIC_ADMISSION_RECEIPT_V2_VERSION,
  type EpistemicParameterRatificationReceiptV1,
  type PredictiveTerminalReceiptV1,
  type ScientificAdmissionExpectedBindingsV2,
  type ScientificAdmissionReceiptV2,
} from "./scientific-admission-v2";
import type { KmConvergenceReceipt } from "./km-convergence-gate-v1";

export type ScientificAdmissionReceiptRecordV2 = {
  id: string;
  organizationId: string;
  receiptKind: "WF_PREDICTIVE";
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
  schemaVersion: typeof SCIENTIFIC_ADMISSION_RECEIPT_V2_VERSION;
  htxVolumeQualificationReceiptDigest: string;
};

export class ScientificAdmissionReceiptV2ConflictError extends Error {
  readonly code = "SCIENTIFIC_ADMISSION_RECEIPT_V2_CONFLICT" as const;

  constructor(message: string) {
    super(message);
    this.name = "ScientificAdmissionReceiptV2ConflictError";
  }
}

export function buildScientificAdmissionReceiptRecordV2(input: {
  organizationId: string;
  predictiveTerminalReceipt: PredictiveTerminalReceiptV1;
  kmConvergenceReceipt: KmConvergenceReceipt;
  epistemicParameterRatificationReceipt: EpistemicParameterRatificationReceiptV1;
  htxVolumeQualificationReceipt: HtxVolumeQualificationReceiptV1;
}): ScientificAdmissionReceiptRecordV2 {
  assertHtxVolumeAuthorityQualified(input.htxVolumeQualificationReceipt);
  const receipt = buildScientificAdmissionReceiptV2(input);
  return {
    id: randomUUID(),
    organizationId: input.organizationId,
    receiptKind: "WF_PREDICTIVE",
    kmGlobalAnchorSetDigest: input.kmConvergenceReceipt.kmGlobalAnchorSetDigestHex,
    replicaRootFamilyIdentityDigest:
      input.kmConvergenceReceipt.replicaRootFamilyIdentityDigestHex,
    selectedKConfigDec: input.kmConvergenceReceipt.selectedK,
    selectedMConfigDec: input.kmConvergenceReceipt.selectedM,
    alphaEpiConfigScale8: input.kmConvergenceReceipt.alphaEpiConfigScale8,
    selectedPackageGenerationIdentityDigest:
      input.kmConvergenceReceipt.selectedPackageGenerationIdentityDigestHex,
    selectedPackageContentDigest: input.kmConvergenceReceipt.selectedPackageContentDigestHex,
    evidenceSemanticDigest: receipt.evidenceSemanticDigestHex,
    receiptJson: JSON.stringify(receipt),
    contentDigest: receipt.contentDigestHex,
    schemaVersion: SCIENTIFIC_ADMISSION_RECEIPT_V2_VERSION,
    htxVolumeQualificationReceiptDigest:
      input.htxVolumeQualificationReceipt.qualificationReceiptDigest,
  };
}

export async function persistScientificAdmissionReceiptV2(
  sql: postgres.Sql,
  record: ScientificAdmissionReceiptRecordV2,
): Promise<{ id: string; insertedNew: boolean }> {
  if (!record.htxVolumeQualificationReceiptDigest.trim()) {
    throw new Error("SCIENTIFIC_ADMISSION_V2_VOLUME_RECEIPT_REQUIRED");
  }
  await loadQualifiedHtxVolumeAuthorityForOrganization(sql, {
    organizationId: record.organizationId,
    qualificationReceiptDigest: record.htxVolumeQualificationReceiptDigest,
  });
  const parsed = JSON.parse(record.receiptJson) as ScientificAdmissionReceiptV2;
  const rebuilt = buildScientificAdmissionReceiptV2({
    organizationId: parsed.organizationId,
    predictiveTerminalReceipt: parsed.predictiveTerminalReceipt,
    kmConvergenceReceipt: parsed.kmConvergenceReceipt,
    epistemicParameterRatificationReceipt: parsed.epistemicParameterRatificationReceipt,
  });
  if (
    JSON.stringify(rebuilt) !== record.receiptJson ||
    rebuilt.organizationId !== record.organizationId ||
    rebuilt.contentDigestHex !== record.contentDigest ||
    rebuilt.evidenceSemanticDigestHex !== record.evidenceSemanticDigest ||
    rebuilt.kmConvergenceReceipt.kmGlobalAnchorSetDigestHex !== record.kmGlobalAnchorSetDigest ||
    rebuilt.kmConvergenceReceipt.replicaRootFamilyIdentityDigestHex !==
      record.replicaRootFamilyIdentityDigest ||
    rebuilt.kmConvergenceReceipt.selectedK !== record.selectedKConfigDec ||
    rebuilt.kmConvergenceReceipt.selectedM !== record.selectedMConfigDec ||
    rebuilt.kmConvergenceReceipt.alphaEpiConfigScale8 !== record.alphaEpiConfigScale8 ||
    rebuilt.kmConvergenceReceipt.selectedPackageGenerationIdentityDigestHex !==
      record.selectedPackageGenerationIdentityDigest ||
    rebuilt.kmConvergenceReceipt.selectedPackageContentDigestHex !==
      record.selectedPackageContentDigest
  ) {
    throw new Error("SCIENTIFIC_ADMISSION_V2_RECORD_CONTENT_MISMATCH");
  }
  const existing = await sql<{ id: string; content_digest: string }[]>`
    SELECT id::text AS id, content_digest
    FROM trader_scientific_admission_receipt_v1
    WHERE ${orgScopedPostgresPredicate(sql, record.organizationId)}
      AND evidence_semantic_digest = ${record.evidenceSemanticDigest}
  `;
  if (existing[0]) {
    if (existing[0].content_digest !== record.contentDigest) {
      throw new ScientificAdmissionReceiptV2ConflictError(
        "SCIENTIFIC_ADMISSION_V2_NATURAL_IDENTITY_CONFLICT",
      );
    }
    return { id: existing[0].id, insertedNew: false };
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
        ${record.kmGlobalAnchorSetDigest}, ${record.replicaRootFamilyIdentityDigest},
        ${record.selectedKConfigDec}, ${record.selectedMConfigDec}, ${record.alphaEpiConfigScale8},
        ${record.selectedPackageGenerationIdentityDigest}, ${record.selectedPackageContentDigest},
        ${record.evidenceSemanticDigest}, ${record.receiptJson}, ${record.contentDigest},
        ${record.schemaVersion}
      )
    `;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("tsar_v1_org_evidence_digest_uq")) {
      const raced = await sql<{ id: string; content_digest: string }[]>`
        SELECT id::text AS id, content_digest
        FROM trader_scientific_admission_receipt_v1
        WHERE ${orgScopedPostgresPredicate(sql, record.organizationId)}
          AND evidence_semantic_digest = ${record.evidenceSemanticDigest}
      `;
      if (raced[0]?.content_digest === record.contentDigest) {
        return { id: raced[0].id, insertedNew: false };
      }
      if (raced[0]) {
        throw new ScientificAdmissionReceiptV2ConflictError(
          "SCIENTIFIC_ADMISSION_V2_NATURAL_IDENTITY_CONFLICT",
        );
      }
    }
    throw error;
  }
  return { id: record.id, insertedNew: true };
}

export async function requireScientificAdmissionReceiptV2ForOrganization(
  sql: postgres.Sql,
  expected: ScientificAdmissionExpectedBindingsV2,
): Promise<ScientificAdmissionReceiptV2> {
  const evidenceSemanticDigest = computeScientificAdmissionEvidenceSemanticDigestV2({
    organizationId: expected.organizationId,
    predictiveTerminalReceiptDigestHex: expected.predictiveTerminalReceiptContentDigestHex,
    kmConvergenceEvidenceSemanticDigestHex: expected.kmConvergenceEvidenceSemanticDigestHex,
    epistemicParameterRatificationReceiptDigestHex:
      expected.epistemicParameterRatificationReceiptDigestHex,
  });
  const rows = await sql<{ receipt_json: string; content_digest: string }[]>`
    SELECT receipt_json, content_digest
    FROM trader_scientific_admission_receipt_v1
    WHERE ${orgScopedPostgresPredicate(sql, expected.organizationId)}
      AND schema_version = ${SCIENTIFIC_ADMISSION_RECEIPT_V2_VERSION}
      AND evidence_semantic_digest = ${evidenceSemanticDigest}
      AND selected_package_content_digest = ${expected.predictivePackageContentDigestHex}
  `;
  if (rows.length > 1) throw new Error("SCIENTIFIC_ADMISSION_V2_DURABLE_IDENTITY_AMBIGUOUS");
  const row = rows[0];
  if (!row) throw new Error("SCIENTIFIC_ADMISSION_V2_NOT_FOUND_FOR_ORGANIZATION");
  const receipt = JSON.parse(row.receipt_json) as ScientificAdmissionReceiptV2;
  if (receipt.contentDigestHex !== row.content_digest) {
    throw new Error("SCIENTIFIC_ADMISSION_V2_DURABLE_CONTENT_MISMATCH");
  }
  return requireScientificAdmissionV2(receipt, expected);
}
