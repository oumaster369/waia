/** @vitest-environment node */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { jsonFromAdminResult } from "@/lib/waia-core/permissions/admin-http-run";
import { TreasuryValidationError } from "@/lib/waia-core/treasury/errors";
import {
  handleTreasuryCommitmentsPost,
  handleTreasuryEvidenceContentGet,
  handleTreasuryEvidenceGet,
  handleTreasuryEvidenceLinksPost,
  handleTreasuryEvidencePost,
  handleTreasuryTransactionsGet,
  handleTreasuryTransactionsPost,
} from "@/lib/waia-core/treasury/admin/handlers";
import {
  TREASURY_EVIDENCE_MAX_UPLOAD_BYTES,
  TREASURY_EVIDENCE_STORAGE_BACKEND,
  sha256HexFromBytes,
  treasuryEvidenceObjectKey,
} from "@/lib/waia-core/treasury/evidence";
import { loadTreasuryWatcherConfig } from "@/lib/waia-core/treasury/watcher";
import {
  createWp4Bundle,
  HUGE_MICROS,
  jsonRequest,
  seedAdminEvidence,
} from "@/tests/unit/helpers/treasury-wp4";
import {
  ABC_BYTES,
  ABC_SHA256,
  ABD_BYTES,
  ADMIN_USER,
  ORG_A,
  ORG_B,
  contentRequest,
  createWp5Bundle,
  evidenceFile,
  errorCode,
  getRequest,
  multipartEvidenceRequest,
  validUploadFields,
  wp5Deps,
} from "@/tests/unit/helpers/treasury-wp5";

const ROOT = path.resolve(__dirname, "../..");
const MUTATE = ["admin.treasury.read", "admin.treasury.mutate"] as const;

function evidenceBody(result: { body: unknown }) {
  return (result.body as { evidence: Record<string, unknown> }).evidence;
}

describe("DEE-606 WP-5 HTTP isolation without R2", () => {
  it("2-6, 63 missing storage fails closed and does not break other admin routes", async () => {
    const { services } = createWp4Bundle();
    const deps = wp5Deps(services);
    const upload = await handleTreasuryEvidencePost(
      multipartEvidenceRequest(validUploadFields(), evidenceFile(ABC_BYTES)),
      deps,
    );
    expect(upload.status).toBe(503);
    expect(errorCode(upload)).toBe("EVIDENCE_STORAGE_NOT_CONFIGURED");

    await seedAdminEvidence(services, ORG_A, "ev-stored");
    const content = await handleTreasuryEvidenceContentGet(
      contentRequest("ev-stored"),
      deps,
      "ev-stored",
    );
    expect(content.status).toBe(503);
    expect(errorCode(content)).toBe("EVIDENCE_STORAGE_NOT_CONFIGURED");

    const jsonCreate = await handleTreasuryEvidencePost(
      jsonRequest("/api/admin/treasury/evidence", {
        organization_id: ORG_A,
        filename: "receipt.pdf",
      }),
      deps,
    );
    expect(jsonCreate.status).toBe(503);
    expect(errorCode(jsonCreate)).toBe("EVIDENCE_STORAGE_NOT_CONFIGURED");

    const tx = await handleTreasuryTransactionsPost(
      jsonRequest("/api/admin/treasury/transactions", {
        organization_id: ORG_A,
        direction: "INFLOW",
        native_amount_atomic: "10",
        native_asset: "USDT",
        occurred_at: "2026-08-01T00:00:00.000Z",
        reason: "no-r2",
      }),
      deps,
    );
    expect(tx.status).toBe(200);
    const commitment = await handleTreasuryCommitmentsPost(
      jsonRequest("/api/admin/treasury/commitments", {
        organization_id: ORG_A,
        amount_micros: HUGE_MICROS,
        purpose: "ops",
        reason: "no-r2",
      }),
      deps,
    );
    expect(commitment.status).toBe(200);
    expect(loadTreasuryWatcherConfig({}).enabled).toBe(false);
  });
});

describe("DEE-606 WP-5 auth, privacy, and publication non-equivalence", () => {
  it("26-35, 43-44 permission split, no public URL, ADMIN_ONLY default", async () => {
    const { services, bucket } = createWp5Bundle();
    const all = wp5Deps(services);
    const unsigned = await handleTreasuryEvidencePost(
      multipartEvidenceRequest(validUploadFields(), evidenceFile(ABC_BYTES)),
      wp5Deps(services, { userId: null }),
    );
    expect(unsigned.status).toBe(401);
    const forbidden = await handleTreasuryEvidencePost(
      multipartEvidenceRequest(validUploadFields(), evidenceFile(ABC_BYTES)),
      wp5Deps(services, { permissions: "none" }),
    );
    expect(forbidden.status).toBe(403);

    const mutateOnly = wp5Deps(services, { permissions: MUTATE });
    const publicDenied = await handleTreasuryEvidencePost(
      multipartEvidenceRequest(
        validUploadFields({ visibility: "PUBLIC" }),
        evidenceFile(ABC_BYTES),
      ),
      mutateOnly,
    );
    expect(publicDenied.status).toBe(403);

    const created = await handleTreasuryEvidencePost(
      multipartEvidenceRequest(
        validUploadFields({ kind: "RECEIPT" }),
        evidenceFile(ABC_BYTES, "secret-invoice.pdf"),
      ),
      mutateOnly,
    );
    expect(created.status).toBe(200);
    const evidence = evidenceBody(created);
    expect(evidence.visibility).toBe("ADMIN_ONLY");
    expect(evidence.kind).toBe("RECEIPT");
    expect(evidence.storageBackend).toBe(TREASURY_EVIDENCE_STORAGE_BACKEND);
    expect(evidence.url).toBeUndefined();
    expect(evidence.publicUrl).toBeUndefined();
    expect(JSON.stringify(evidence)).not.toMatch(/r2\.dev|https:\/\//);
    expect(String(evidence.objectKey)).not.toMatch(/secret-invoice|pdf/i);
    expect(bucket.lastPutOptions?.customMetadata).not.toMatchObject({
      filename: expect.anything(),
    });

    const publicUpload = await handleTreasuryEvidencePost(
      multipartEvidenceRequest(
        validUploadFields({ visibility: "PUBLIC", kind: "DOCUMENT" }),
        evidenceFile(ABC_BYTES),
      ),
      all,
    );
    expect(publicUpload.status).toBe(200);
    const publicEvidence = evidenceBody(publicUpload);
    expect(publicEvidence.visibility).toBe("PUBLIC");
    expect(publicEvidence.url).toBeUndefined();
    expect(JSON.stringify(publicEvidence)).not.toMatch(/r2\.dev/);

    const tx = await handleTreasuryTransactionsPost(
      jsonRequest("/api/admin/treasury/transactions", {
        organization_id: ORG_A,
        direction: "INFLOW",
        native_amount_atomic: "5",
        native_asset: "USDT",
        occurred_at: "2026-08-01T00:00:00.000Z",
        reason: "pub",
      }),
      all,
    );
    const txId = (tx.body as { transaction: { id: string; detailPublication: string } }).transaction
      .id;
    expect(
      (tx.body as { transaction: { detailPublication: string } }).transaction.detailPublication,
    ).toBe("PRIVATE");
    await handleTreasuryEvidenceLinksPost(
      jsonRequest("/api/admin/treasury/evidence/links", {
        organization_id: ORG_A,
        command: "link",
        transaction_id: txId,
        evidence_object_id: publicEvidence.id,
        reason: "link-public-evidence",
      }),
      all,
    );
    const stillPrivate = await services.domain.repository.getTransaction(
      { organizationId: ORG_A },
      txId,
    );
    expect(stillPrivate?.detailPublication).toBe("PRIVATE");

    const readDenied = await handleTreasuryEvidenceContentGet(
      contentRequest(String(evidence.id)),
      wp5Deps(services, { permissions: "none" }),
      String(evidence.id),
    );
    expect(readDenied.status).toBe(403);

    const otherOrg = await handleTreasuryEvidenceContentGet(
      contentRequest(String(evidence.id), ORG_B),
      wp5Deps(services, { authorizedOrgs: [ORG_B] }),
      String(evidence.id),
    );
    expect(otherOrg.status).toBe(404);

    expect(existsSync(path.join(ROOT, "app/api/public/treasury"))).toBe(false);
    expect(existsSync(path.join(ROOT, "app/api/treasury"))).toBe(false);
    const contentRoute = readFileSync(
      path.join(ROOT, "app/api/admin/treasury/evidence/[id]/content/route.ts"),
      "utf8",
    );
    expect(contentRoute).not.toMatch(/anonymous|public download|presign/i);
  });
});

describe("DEE-606 WP-5 upload workflow", () => {
  it("10-13, 18-24, 36-45 valid upload stores R2 + metadata from actual bytes", async () => {
    const { services, audits, bucket } = createWp5Bundle();
    const deps = wp5Deps(services);
    const rejectedKey = await handleTreasuryEvidencePost(
      multipartEvidenceRequest(
        validUploadFields({ object_key: "evil/path/secret-invoice.pdf" }),
        evidenceFile(ABC_BYTES, "secret-invoice.pdf"),
      ),
      deps,
    );
    expect(rejectedKey.status).toBe(400);
    expect(errorCode(rejectedKey)).toBe("EVIDENCE_CLIENT_STORAGE_AUTHORITY");

    const mismatch = await handleTreasuryEvidencePost(
      multipartEvidenceRequest(
        validUploadFields({ sha256: sha256HexFromBytes(ABD_BYTES) }),
        evidenceFile(ABC_BYTES),
      ),
      deps,
    );
    expect(mismatch.status).toBe(400);
    expect(errorCode(mismatch)).toBe("EVIDENCE_DIGEST_MISMATCH");

    const matched = await handleTreasuryEvidencePost(
      multipartEvidenceRequest(
        validUploadFields({ expected_sha256: ABC_SHA256, kind: "INVOICE" }),
        evidenceFile(ABC_BYTES, "secret-invoice.pdf", "application/pdf"),
      ),
      deps,
    );
    expect(matched.status).toBe(200);
    const evidence = evidenceBody(matched);
    const id = String(evidence.id);
    const expectedKey = treasuryEvidenceObjectKey(ORG_A, id);
    expect(evidence.objectKey).toBe(expectedKey);
    expect(evidence.sha256).toBe(ABC_SHA256);
    expect(evidence.byteSize).toBe(String(ABC_BYTES.byteLength));
    expect(evidence.storageBackend).toBe("cloudflare-r2");
    expect(evidence.uploadedByUserId).toBe(ADMIN_USER);
    expect(evidence.kind).toBe("INVOICE");
    expect(evidence.visibility).toBe("ADMIN_ONLY");
    expect(String(evidence.objectKey)).not.toContain("secret-invoice");
    expect(bucket.has(expectedKey)).toBe(true);
    expect(bucket.lastPutOptions?.sha256).toBe(ABC_SHA256);
    expect(audits.some((row) => row.action === "treasury.evidence.upload")).toBe(true);

    const dbRow = await services.catalog.getEvidence({ organizationId: ORG_A }, id);
    expect(dbRow?.objectKey).toBe(expectedKey);
    expect(dbRow?.sha256).toBe(ABC_SHA256);
    expect(dbRow?.byteSize).toBe(BigInt(ABC_BYTES.byteLength));
    expect(dbRow?.uploadedByUserId).toBe(ADMIN_USER);
  });

  it("46-50, 64 registration failure compensates only the uncommitted object", async () => {
    const { services, bucket } = createWp5Bundle();
    const deps = wp5Deps(services);
    const first = await handleTreasuryEvidencePost(
      multipartEvidenceRequest(validUploadFields(), evidenceFile(ABC_BYTES)),
      deps,
    );
    const firstId = String(evidenceBody(first).id);
    const firstKey = String(evidenceBody(first).objectKey);

    const original = services.catalog.registerEvidenceObject.bind(services.catalog);
    services.catalog.registerEvidenceObject = async () => {
      throw new TreasuryValidationError("DB_FAIL", "insert failed");
    };
    const failed = await handleTreasuryEvidencePost(
      multipartEvidenceRequest(validUploadFields({ kind: "DOCUMENT" }), evidenceFile(ABD_BYTES)),
      deps,
    );
    expect(failed.status).not.toBe(200);
    expect(errorCode(failed)).toBe("DB_FAIL");
    expect(bucket.has(firstKey)).toBe(true);
    expect(bucket.objectCount()).toBe(1);

    services.catalog.registerEvidenceObject = async (actor, record, reason) => {
      await original(actor, record, reason);
      throw new TreasuryValidationError("AUDIT_FAIL", "audit failed after insert");
    };
    const afterInsert = await handleTreasuryEvidencePost(
      multipartEvidenceRequest(validUploadFields({ kind: "SCREENSHOT" }), evidenceFile(ABC_BYTES)),
      deps,
    );
    expect(afterInsert.status).not.toBe(200);
    expect(bucket.has(firstKey)).toBe(true);
    expect(bucket.objectCount()).toBe(2);

    const enable = await handleTreasuryEvidencePost(
      multipartEvidenceRequest(
        validUploadFields({ TREASURY_WATCHER_ENABLED: "true" }),
        evidenceFile(ABC_BYTES),
      ),
      deps,
    );
    expect(enable.status).toBe(400);
    expect(errorCode(enable)).toBe("WATCHER_ENABLE_FORBIDDEN");
    expect(loadTreasuryWatcherConfig({}).enabled).toBe(false);
    expect(firstId).toBeTruthy();
  });
});

describe("DEE-606 WP-5 download, unlink, and existing contracts", () => {
  it("51-62 content headers, 404 vs storage miss, unlink leaves object", async () => {
    const { services, bucket } = createWp5Bundle();
    const all = wp5Deps(services);
    const uploaded = await handleTreasuryEvidencePost(
      multipartEvidenceRequest(
        validUploadFields({ kind: "INVOICE" }),
        evidenceFile(ABC_BYTES, "ignored.pdf", "application/pdf"),
      ),
      all,
    );
    const id = String(evidenceBody(uploaded).id);
    const key = String(evidenceBody(uploaded).objectKey);

    const missingDb = await handleTreasuryEvidenceContentGet(
      contentRequest("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9"),
      all,
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9",
    );
    expect(missingDb.status).toBe(404);

    const content = await handleTreasuryEvidenceContentGet(contentRequest(id), all, id);
    expect(content.status).toBe(200);
    expect(content.binaryBody).toEqual(ABC_BYTES);
    expect(content.responseHeaders?.["Cache-Control"]).toBe("private, no-store");
    expect(content.responseHeaders?.["X-Content-Type-Options"]).toBe("nosniff");
    expect(content.responseHeaders?.["Content-Disposition"]).toMatch(/^attachment;/);
    expect(content.responseHeaders?.["Content-Disposition"]).not.toMatch(/ignored\.pdf/);
    expect(content.responseHeaders?.["Content-Type"]).toBe("application/pdf");
    expect(JSON.stringify(content.body)).not.toMatch(/https:\/\/|r2\.dev/);

    const http = jsonFromAdminResult(content);
    expect(http.headers.get("Cache-Control")).toBe("private, no-store");
    expect(http.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(http.headers.get("Content-Disposition")).toMatch(/^attachment;/);
    expect(http.headers.get("Content-Type")).toBe("application/pdf");

    await bucket.delete(key);
    const missingObject = await handleTreasuryEvidenceContentGet(contentRequest(id), all, id);
    expect(missingObject.status).toBe(503);
    expect(errorCode(missingObject)).toBe("EVIDENCE_CONTENT_UNAVAILABLE");

    const restored = await handleTreasuryEvidencePost(
      multipartEvidenceRequest(validUploadFields({ kind: "DOCUMENT" }), evidenceFile(ABD_BYTES)),
      all,
    );
    const restoredId = String(evidenceBody(restored).id);
    const restoredKey = String(evidenceBody(restored).objectKey);
    const tx = await handleTreasuryTransactionsPost(
      jsonRequest("/api/admin/treasury/transactions", {
        organization_id: ORG_A,
        direction: "INFLOW",
        native_amount_atomic: "3",
        native_asset: "USDT",
        occurred_at: "2026-08-01T00:00:00.000Z",
        reason: "link",
      }),
      all,
    );
    const txId = (tx.body as { transaction: { id: string } }).transaction.id;
    const linked = await handleTreasuryEvidenceLinksPost(
      jsonRequest("/api/admin/treasury/evidence/links", {
        organization_id: ORG_A,
        command: "link",
        transaction_id: txId,
        evidence_object_id: restoredId,
        reason: "link",
      }),
      all,
    );
    expect(linked.status).toBe(200);
    const linkId = (linked.body as { link: { id: string } }).link.id;
    const unlinked = await handleTreasuryEvidenceLinksPost(
      jsonRequest("/api/admin/treasury/evidence/links", {
        organization_id: ORG_A,
        command: "unlink",
        link_id: linkId,
        reason: "unlink",
      }),
      all,
    );
    expect(unlinked.status).toBe(200);
    expect(bucket.has(restoredKey)).toBe(true);
    const listed = await handleTreasuryEvidenceGet(
      getRequest(`/api/admin/treasury/evidence?organization_id=${ORG_A}&id=${restoredId}`),
      all,
    );
    expect(listed.status).toBe(200);
    expect(loadTreasuryWatcherConfig({}).enabled).toBe(false);
  });

  it("size guard rejects oversized uploads", async () => {
    const { services } = createWp5Bundle();
    const oversized = new Uint8Array(TREASURY_EVIDENCE_MAX_UPLOAD_BYTES + 1);
    const result = await handleTreasuryEvidencePost(
      multipartEvidenceRequest(validUploadFields(), evidenceFile(oversized)),
      wp5Deps(services),
    );
    expect(result.status).toBe(413);
    expect(errorCode(result)).toBe("EVIDENCE_TOO_LARGE");
  });

  it("transaction list still works after evidence upload", async () => {
    const { services } = createWp5Bundle();
    const deps = wp5Deps(services);
    await handleTreasuryEvidencePost(
      multipartEvidenceRequest(validUploadFields(), evidenceFile(ABC_BYTES)),
      deps,
    );
    const listed = await handleTreasuryTransactionsGet(
      getRequest(`/api/admin/treasury/transactions?organization_id=${ORG_A}`),
      deps,
    );
    expect(listed.status).toBe(200);
  });
});
