import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";

export const PUBLIC_TREASURY_ORGANIZATION_ENV =
  "WAIA_PUBLIC_TREASURY_ORGANIZATION_ID" as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class PublicTreasuryBindingError extends Error {
  readonly code = "PUBLIC_TREASURY_ORGANIZATION_NOT_CONFIGURED" as const;

  constructor() {
    super("Public Treasury organization binding is missing or invalid");
    this.name = "PublicTreasuryBindingError";
  }
}
export function resolvePublicTreasuryOrganization(
  env: Readonly<Record<string, string | undefined>> = process.env,
): OrgContext {
  const value = env[PUBLIC_TREASURY_ORGANIZATION_ENV]?.trim().toLowerCase() ?? "";
  if (!UUID_RE.test(value)) throw new PublicTreasuryBindingError();
  return requireOrgContext(value);
}
