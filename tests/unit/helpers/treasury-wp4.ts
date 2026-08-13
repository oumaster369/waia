import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import type { AuditLogInput } from "@/lib/waia-core/types";
import type { TreasuryAdminHandlerDeps } from "@/lib/waia-core/treasury/admin/handlers";
import { createMemoryTreasuryAdminServices } from "@/lib/waia-core/treasury/admin/services";
import type { TreasuryAdminServices } from "@/lib/waia-core/treasury/admin/services";
import { USER_A } from "@/tests/unit/helpers/treasury-wp2";

export { ORG_A, ORG_B, USER_A, ctxA, usdtAmount } from "@/tests/unit/helpers/treasury-wp2";

export const ADMIN_USER = USER_A;
export const HUGE_MICROS = "9007199254740993";

export function errorCode(result: { body: unknown }): string | undefined {
  const body = result.body as { error?: { code?: string } };
  return body.error?.code;
}

export function jsonRequest(url: string, body: unknown, method = "POST"): Request {
  const href = url.startsWith("http") ? url : `http://localhost${url}`;
  return new Request(href, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function getRequest(path: string): Request {
  return new Request(`http://localhost${path}`);
}

export function createWp4Bundle() {
  const audits: AuditLogInput[] = [];
  const services = createMemoryTreasuryAdminServices(async (input) => {
    audits.push(input);
    return `audit-${audits.length}`;
  });
  return { services, audits };
}

export function createWp4Deps(input: {
  userId?: string | null;
  permissions?: readonly string[] | "all" | "none";
  services?: TreasuryAdminServices;
  runtimeKind?: "sqlite" | "postgres";
  authorizedOrgs?: string[];
}): TreasuryAdminHandlerDeps & { authorizedOrgsSeen: string[] } {
  const authorizedOrgsSeen: string[] = [];
  const permissions = input.permissions ?? "all";
  const runtimeKind = input.runtimeKind ?? "postgres";
  return {
    authorizedOrgsSeen,
    getUserId: async () => (input.userId === undefined ? ADMIN_USER : input.userId),
    getRuntimeDb: async () => ({ kind: runtimeKind, db: {} }) as unknown as WaiaRuntimeDb,
    disposeRuntimeDb: async () => undefined,
    openTreasuryServices: input.services
      ? async () => input.services as TreasuryAdminServices
      : undefined,
    testPermissionGate: ({ organizationId, permission }) => {
      authorizedOrgsSeen.push(organizationId);
      if (input.authorizedOrgs && !input.authorizedOrgs.includes(organizationId)) {
        return false;
      }
      if (permissions === "all") return true;
      if (permissions === "none") return false;
      return permissions.includes(permission);
    },
  };
}

export async function seedAdminEvidence(
  services: TreasuryAdminServices,
  organizationId: string,
  id = "ev-1",
) {
  await services.catalogRepo.insertEvidenceObject({
    id,
    organizationId,
    storageBackend: "UNCONFIGURED",
    objectKey: `fixture/${id}`,
    mediaType: "application/pdf",
    byteSize: 12n,
    sha256: "abc",
    kind: "DOCUMENT",
    visibility: "ADMIN_ONLY",
    source: "fixture",
    uploadedByUserId: null,
    observedAt: new Date("2026-08-01T00:00:00.000Z"),
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
  });
}
