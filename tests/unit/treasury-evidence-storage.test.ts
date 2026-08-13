import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { handleAdminOrganizationsList } from "@/lib/waia-core/permissions/admin-route-handler";
import { loadWatcherConfig } from "@/lib/waia-core/payment-watcher/watcher-config";
import { TreasuryValidationError } from "@/lib/waia-core/treasury/errors";
import {
  TREASURY_EVIDENCE_ALLOWED_CUSTOM_METADATA_KEYS,
  TREASURY_EVIDENCE_R2_BINDING_NAME,
  TREASURY_EVIDENCE_SCHEMA_VERSION,
  TREASURY_EVIDENCE_STORAGE_BACKEND,
  createMemoryTreasuryEvidenceR2Bucket,
  createR2TreasuryEvidenceStorage,
  resolveTreasuryEvidenceStorage,
  sha256HexFromBytes,
  treasuryEvidenceObjectKey,
  uploadTreasuryEvidenceObject,
} from "@/lib/waia-core/treasury/evidence";
import { loadTreasuryWatcherConfig } from "@/lib/waia-core/treasury/watcher";
import { ABC_BYTES, ABC_SHA256, ABD_BYTES, ORG_A } from "@/tests/unit/helpers/treasury-wp5";

const ROOT = path.resolve(__dirname, "../..");

describe("DEE-606 WP-5 evidence storage adapter isolation", () => {
  it("1-9 adapter import and missing R2 do not couple other modules", async () => {
    const adapter = await import("@/lib/waia-core/treasury/evidence/r2-adapter");
    expect(typeof adapter.createR2TreasuryEvidenceStorage).toBe("function");
    expect(resolveTreasuryEvidenceStorage()).toBeNull();
    expect(TREASURY_EVIDENCE_R2_BINDING_NAME).toBe("TREASURY_EVIDENCE_R2");

    await import("@/lib/waia-core/treasury");
    await import("@/db/waia-runtime-db");
    expect(typeof handleAdminOrganizationsList).toBe("function");
    expect(loadTreasuryWatcherConfig({}).enabled).toBe(false);
    expect(loadWatcherConfig({}).enabled).toBe(false);
    expect(
      loadWatcherConfig({ TREASURY_EVIDENCE_R2: "present", AWS_ACCESS_KEY_ID: "x" }).enabled,
    ).toBe(false);

    const wrangler = readFileSync(path.join(ROOT, "wrangler.jsonc"), "utf8");
    expect(wrangler).not.toMatch(/r2_buckets/);
    expect(wrangler).not.toMatch(/TREASURY_EVIDENCE_R2/);
    const worker = readFileSync(path.join(ROOT, "custom-worker.ts"), "utf8");
    expect(worker).not.toMatch(/TREASURY_EVIDENCE_R2/);
    expect(worker).not.toMatch(/treasuryEvidence/);
  });
});

describe("DEE-606 WP-5 object key, immutability, and hash", () => {
  it("10-17 opaque key, no overwrite, no committed delete API", async () => {
    const org = ORG_A;
    const id = "dddddddd-dddd-4ddd-8ddd-ddddddddddd4";
    const key = treasuryEvidenceObjectKey(org, id);
    expect(key).toBe(`treasury-evidence/v1/${org}/${id}`);
    expect(key).not.toMatch(/invoice|pdf|secret|email|@|counterparty/i);

    const bucket = createMemoryTreasuryEvidenceR2Bucket();
    const storage = createR2TreasuryEvidenceStorage(bucket);
    const put = {
      key,
      body: ABC_BYTES,
      contentType: "application/pdf",
      sha256Hex: ABC_SHA256,
      customMetadata: {
        schemaVersion: TREASURY_EVIDENCE_SCHEMA_VERSION,
        organizationId: org,
        evidenceObjectId: id,
        sha256: ABC_SHA256,
      },
    };
    await storage.putImmutable(put);
    await expect(storage.putImmutable(put)).rejects.toMatchObject({
      reasonCode: "EVIDENCE_OBJECT_EXISTS",
    });
    const [first, second] = await Promise.allSettled([
      storage.putImmutable({ ...put, key: `${key}-b` }),
      storage.putImmutable({ ...put, key: `${key}-b` }),
    ]);
    const fulfilled = [first, second].filter((row) => row.status === "fulfilled");
    const rejected = [first, second].filter((row) => row.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(TreasuryValidationError);

    const contentRoute = readFileSync(
      path.join(ROOT, "app/api/admin/treasury/evidence/[id]/content/route.ts"),
      "utf8",
    );
    expect(contentRoute).not.toMatch(/export async function DELETE/);
    expect(contentRoute).not.toMatch(/presign|r2\.dev|getSignedUrl/i);
  });

  it("18-25 SHA-256 is computed from actual bytes and passed as R2 integrity", async () => {
    expect(sha256HexFromBytes(ABC_BYTES)).toBe(ABC_SHA256);
    expect(sha256HexFromBytes(ABC_BYTES)).toBe(ABC_SHA256.toLowerCase());
    expect(sha256HexFromBytes(ABD_BYTES)).not.toBe(ABC_SHA256);

    const bucket = createMemoryTreasuryEvidenceR2Bucket();
    const storage = createR2TreasuryEvidenceStorage(bucket);
    const id = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5";
    const key = treasuryEvidenceObjectKey(ORG_A, id);
    await storage.putImmutable({
      key,
      body: ABC_BYTES,
      contentType: "application/pdf",
      sha256Hex: ABC_SHA256,
      customMetadata: {
        schemaVersion: TREASURY_EVIDENCE_SCHEMA_VERSION,
        organizationId: ORG_A,
        evidenceObjectId: id,
        sha256: ABC_SHA256,
      },
    });
    expect(bucket.lastPutOptions?.sha256).toBe(ABC_SHA256);
    expect(bucket.lastPutOptions?.onlyIf).toEqual({ etagDoesNotMatch: "*" });
    expect(Object.keys(bucket.lastPutOptions?.customMetadata ?? {}).sort()).toEqual(
      [...TREASURY_EVIDENCE_ALLOWED_CUSTOM_METADATA_KEYS].sort(),
    );
    expect(JSON.stringify(bucket.lastPutOptions?.customMetadata)).not.toMatch(
      /email|filename|counterparty|purpose|notes|session/i,
    );

    const stored = await storage.get(key);
    expect(stored?.byteSize).toBe(ABC_BYTES.byteLength);
    expect(stored?.sha256Hex).toBe(ABC_SHA256);
  });

  it("46-49 PUT failure leaves no DB row; compensation deletes only the uncommitted object", async () => {
    const bucket = createMemoryTreasuryEvidenceR2Bucket();
    const storage = createR2TreasuryEvidenceStorage(bucket);
    const rows = new Map<string, { id: string }>();
    const failingPut = createR2TreasuryEvidenceStorage({
      put: async () => {
        throw new Error("r2 unavailable");
      },
      get: async () => null,
      head: async () => null,
      delete: async () => undefined,
    });

    await expect(
      uploadTreasuryEvidenceObject({
        storage: failingPut,
        register: async (record) => {
          rows.set(record.id, record);
        },
        lookup: async (id) => (rows.get(id) as never) ?? null,
        payload: {
          organizationId: ORG_A,
          bytes: ABC_BYTES,
          mediaType: "application/pdf",
          kind: "INVOICE",
          visibility: "ADMIN_ONLY",
          source: "admin-upload",
          observedAt: new Date("2026-08-13T00:00:00.000Z"),
          uploadedByUserId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
        },
      }),
    ).rejects.toMatchObject({ reasonCode: "EVIDENCE_STORAGE_PUT_FAILED" });
    expect(rows.size).toBe(0);

    const preexistingId = "ffffffff-ffff-4fff-8fff-fffffffffff6";
    const preexistingKey = treasuryEvidenceObjectKey(ORG_A, preexistingId);
    await storage.putImmutable({
      key: preexistingKey,
      body: ABD_BYTES,
      contentType: "application/pdf",
      sha256Hex: sha256HexFromBytes(ABD_BYTES),
      customMetadata: {
        schemaVersion: TREASURY_EVIDENCE_SCHEMA_VERSION,
        organizationId: ORG_A,
        evidenceObjectId: preexistingId,
        sha256: sha256HexFromBytes(ABD_BYTES),
      },
    });

    const newId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee7";
    await expect(
      uploadTreasuryEvidenceObject({
        storage,
        register: async () => {
          throw new TreasuryValidationError("DB_FAIL", "registration failed");
        },
        lookup: async () => null,
        newId: () => newId,
        payload: {
          organizationId: ORG_A,
          bytes: ABC_BYTES,
          mediaType: "application/pdf",
          kind: "INVOICE",
          visibility: "ADMIN_ONLY",
          source: "admin-upload",
          observedAt: new Date("2026-08-13T00:00:00.000Z"),
          uploadedByUserId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
        },
      }),
    ).rejects.toMatchObject({ reasonCode: "DB_FAIL" });
    expect(bucket.has(treasuryEvidenceObjectKey(ORG_A, newId))).toBe(false);
    expect(bucket.has(preexistingKey)).toBe(true);

    const committedId = "bbbbbbbb-cccc-4ddd-8eee-fffffffffff8";
    const committed = new Map<string, { id: string }>();
    await uploadTreasuryEvidenceObject({
      storage,
      register: async (record) => {
        committed.set(record.id, record);
        throw new TreasuryValidationError("AUDIT_FAIL", "audit failed after insert");
      },
      lookup: async (id) => (committed.get(id) as never) ?? null,
      newId: () => committedId,
      payload: {
        organizationId: ORG_A,
        bytes: ABC_BYTES,
        mediaType: "application/pdf",
        kind: "DOCUMENT",
        visibility: "ADMIN_ONLY",
        source: "admin-upload",
        observedAt: new Date("2026-08-13T00:00:00.000Z"),
        uploadedByUserId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
      },
    }).catch((err: TreasuryValidationError) => {
      expect(err.reasonCode).toBe("AUDIT_FAIL");
    });
    expect(bucket.has(treasuryEvidenceObjectKey(ORG_A, committedId))).toBe(true);
    expect(bucket.has(preexistingKey)).toBe(true);
    expect(TREASURY_EVIDENCE_STORAGE_BACKEND).toBe("cloudflare-r2");
  });
});
