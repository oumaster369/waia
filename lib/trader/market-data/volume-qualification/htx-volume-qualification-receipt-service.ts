import { randomUUID } from "node:crypto";

import type postgres from "postgres";

import { orgScopedPostgresPredicate } from "@/lib/waia-core/scope/org-context";

import type { HtxVolumeQualificationReceiptV1 } from "./htx-volume-qualification";
import { readHtxVolumeQualificationReceipt } from "./htx-volume-qualification";
import { HtxVolumeCapitalAuthorityError } from "./htx-volume-authority-capital-v1";

export type PersistHtxVolumeQualificationReceiptInput = {
  organizationId: string;
  receipt: HtxVolumeQualificationReceiptV1;
};

export type HtxVolumeQualificationReceiptRecord = {
  id: string;
  organizationId: string;
  symbol: string;
  interval: string;
  verdict: HtxVolumeQualificationReceiptV1["verdict"];
  authorityField: string | null;
  sampleCount: number;
  divergenceCount: number;
  qualificationReceiptDigest: string;
  receiptJson: HtxVolumeQualificationReceiptV1;
  qualifiedAt: string;
};

export class HtxVolumeQualificationPersistConflictError extends Error {
  readonly code = "HTX_VOLUME_QUALIFICATION_CONFLICT" as const;

  constructor(message: string) {
    super(message);
    this.name = "HtxVolumeQualificationPersistConflictError";
  }
}

export async function persistHtxVolumeQualificationReceipt(
  sql: postgres.Sql,
  input: PersistHtxVolumeQualificationReceiptInput,
): Promise<{ record: HtxVolumeQualificationReceiptRecord; inserted: boolean }> {
  const receipt = readHtxVolumeQualificationReceipt(input.receipt);
  const id = randomUUID();

  const existing = await sql<
    {
      id: string;
      organization_id: string;
      symbol: string;
      interval: string;
      verdict: HtxVolumeQualificationReceiptV1["verdict"];
      authority_field: string | null;
      sample_count: number;
      divergence_count: number;
      qualification_receipt_digest: string;
      receipt_json: HtxVolumeQualificationReceiptV1;
      qualified_at: string;
    }[]
  >`
    SELECT
      id,
      organization_id,
      symbol,
      interval,
      verdict,
      authority_field,
      sample_count,
      divergence_count,
      qualification_receipt_digest,
      receipt_json,
      qualified_at::text
    FROM trader_htx_volume_qualification_receipt_v1
    WHERE ${orgScopedPostgresPredicate(sql, input.organizationId)}
      AND symbol = ${receipt.symbol}
      AND interval = ${receipt.interval}
      AND qualification_receipt_digest = ${receipt.qualificationReceiptDigest}
  `;

  if (existing[0]) {
    const row = existing[0];
    const prior = row.receipt_json;
    if (JSON.stringify(prior) !== JSON.stringify(receipt)) {
      throw new HtxVolumeQualificationPersistConflictError(
        "conflicting HTX volume qualification receipt for identical digest key",
      );
    }
    return {
      inserted: false,
      record: {
        id: row.id,
        organizationId: row.organization_id,
        symbol: row.symbol,
        interval: row.interval,
        verdict: row.verdict,
        authorityField: row.authority_field,
        sampleCount: row.sample_count,
        divergenceCount: row.divergence_count,
        qualificationReceiptDigest: row.qualification_receipt_digest,
        receiptJson: prior,
        qualifiedAt: row.qualified_at,
      },
    };
  }

  await sql`
    INSERT INTO trader_htx_volume_qualification_receipt_v1 (
      id,
      organization_id,
      symbol,
      interval,
      verdict,
      authority_field,
      sample_count,
      divergence_count,
      qualification_receipt_digest,
      receipt_json,
      qualified_at
    ) VALUES (
      ${id}::uuid,
      ${input.organizationId}::uuid,
      ${receipt.symbol},
      ${receipt.interval},
      ${receipt.verdict},
      ${receipt.authorityField},
      ${receipt.sampleCount},
      ${receipt.divergenceCount},
      ${receipt.qualificationReceiptDigest},
      ${sql.json(receipt as never)},
      ${receipt.qualifiedAtUtc}::timestamptz
    )
  `;

  return {
    inserted: true,
    record: {
      id,
      organizationId: input.organizationId,
      symbol: receipt.symbol,
      interval: receipt.interval,
      verdict: receipt.verdict,
      authorityField: receipt.authorityField,
      sampleCount: receipt.sampleCount,
      divergenceCount: receipt.divergenceCount,
      qualificationReceiptDigest: receipt.qualificationReceiptDigest,
      receiptJson: receipt,
      qualifiedAt: receipt.qualifiedAtUtc,
    },
  };
}

export async function readHtxVolumeQualificationReceiptByDigest(
  sql: postgres.Sql,
  input: { organizationId: string; qualificationReceiptDigest: string },
): Promise<HtxVolumeQualificationReceiptRecord | null> {
  const rows = await sql<
    {
      id: string;
      organization_id: string;
      symbol: string;
      interval: string;
      verdict: HtxVolumeQualificationReceiptV1["verdict"];
      authority_field: string | null;
      sample_count: number;
      divergence_count: number;
      qualification_receipt_digest: string;
      receipt_json: HtxVolumeQualificationReceiptV1;
      qualified_at: string;
    }[]
  >`
    SELECT
      id,
      organization_id,
      symbol,
      interval,
      verdict,
      authority_field,
      sample_count,
      divergence_count,
      qualification_receipt_digest,
      receipt_json,
      qualified_at::text
    FROM trader_htx_volume_qualification_receipt_v1
    WHERE ${orgScopedPostgresPredicate(sql, input.organizationId)}
      AND qualification_receipt_digest = ${input.qualificationReceiptDigest}
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    symbol: row.symbol,
    interval: row.interval,
    verdict: row.verdict,
    authorityField: row.authority_field,
    sampleCount: row.sample_count,
    divergenceCount: row.divergence_count,
    qualificationReceiptDigest: row.qualification_receipt_digest,
    receiptJson: row.receipt_json,
    qualifiedAt: row.qualified_at,
  };
}

/**
 * Organization-scoped capital authority load (ADR-0007).
 * ORG_A cannot satisfy volume authority using ORG_B's persisted QUALIFIED receipt.
 * Missing/wrong-org digest fails closed — never "missing but acceptable."
 *
 * Verdict is taken from the persisted column (write-time validated). Do not re-digest
 * jsonb round-trips as the sole authority gate — key order can change under JSONB.
 */
export async function loadQualifiedHtxVolumeAuthorityForOrganization(
  sql: postgres.Sql,
  input: { organizationId: string; qualificationReceiptDigest: string },
): Promise<HtxVolumeQualificationReceiptV1> {
  const record = await readHtxVolumeQualificationReceiptByDigest(sql, input);
  if (!record) {
    throw new HtxVolumeCapitalAuthorityError(
      "HTX_VOLUME_AUTHORITY_MISSING",
      `HTX volume qualification receipt not found for organization=${input.organizationId}`,
    );
  }
  if (record.organizationId !== input.organizationId) {
    throw new HtxVolumeCapitalAuthorityError(
      "HTX_VOLUME_AUTHORITY_TENANT_MISMATCH",
      "HTX volume qualification receipt organization mismatch",
    );
  }
  if (record.qualificationReceiptDigest !== input.qualificationReceiptDigest) {
    throw new HtxVolumeCapitalAuthorityError(
      "HTX_VOLUME_AUTHORITY_DIGEST_MISMATCH",
      "HTX volume qualification receipt digest mismatch",
    );
  }
  if (record.verdict !== "HTX_VOLUME_AUTHORITY_QUALIFIED") {
    throw new HtxVolumeCapitalAuthorityError(
      record.verdict,
      `HTX volume authority blocked: ${record.verdict}`,
    );
  }
  return record.receiptJson;
}
