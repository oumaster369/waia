import type { AuditLogInput } from "@/lib/waia-core/types";
import { createMemoryTreasuryAdminServices } from "@/lib/waia-core/treasury/admin/services";
import {
  createMemoryTreasuryEvidenceR2Bucket,
  createR2TreasuryEvidenceStorage,
} from "@/lib/waia-core/treasury/evidence";
import { createWp4Deps } from "@/tests/unit/helpers/treasury-wp4";
import { ORG_A } from "@/tests/unit/helpers/treasury-wp2";

export {
  ORG_A,
  ORG_B,
  USER_A,
  ADMIN_USER,
  createWp4Deps,
  errorCode,
  getRequest,
} from "@/tests/unit/helpers/treasury-wp4";

export const ABC_BYTES = new TextEncoder().encode("abc");
export const ABC_SHA256 = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
export const ABD_BYTES = new TextEncoder().encode("abd");

export function createWp5Bundle() {
  const bucket = createMemoryTreasuryEvidenceR2Bucket();
  const storage = createR2TreasuryEvidenceStorage(bucket);
  const audits: AuditLogInput[] = [];
  const services = createMemoryTreasuryAdminServices(
    async (input) => {
      audits.push(input);
      return `audit-${audits.length}`;
    },
    { evidenceStorage: storage },
  );
  return { services, audits, bucket, storage };
}

export function evidenceFile(
  bytes: Uint8Array,
  name = "secret-invoice.pdf",
  type = "application/pdf",
): File {
  const copy = new Uint8Array(bytes);
  return new File([copy], name, { type });
}

export function multipartEvidenceRequest(fields: Record<string, string>, file: File): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value);
  }
  const nativeGet = form.get.bind(form);
  form.get = (name: string) => (name === "file" ? file : nativeGet(name));
  const request = new Request("http://localhost/api/admin/treasury/evidence", {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=----treasury-evidence" },
  });
  Object.defineProperty(request, "formData", {
    value: async () => form,
  });
  return request;
}

export function validUploadFields(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    organization_id: ORG_A,
    kind: "INVOICE",
    reason: "upload-receipt",
    ...overrides,
  };
}

export function contentRequest(evidenceId: string, organizationId = ORG_A): Request {
  return new Request(
    `http://localhost/api/admin/treasury/evidence/${evidenceId}/content?organization_id=${organizationId}`,
  );
}

export function wp5Deps(
  services: ReturnType<typeof createMemoryTreasuryAdminServices>,
  options: Parameters<typeof createWp4Deps>[0] = {},
) {
  return createWp4Deps({ services, ...options });
}
